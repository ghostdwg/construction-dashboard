// ──────────────────────────────────────────────────────────────────────────────
//  scripts/__tests__/specbook-legacy-fixture.test.ts
//
//  CLI-level coverage for scripts/specbook-legacy-fixture.ts: dry-run safety,
//  every mutation gate (flag presence, confirm phrase, APP_ENV, Bid identity,
//  double-seed refusal), the --seed write contract, the --cleanup
//  shape-check + narrow-delete contract, and an output-discipline sweep.
//
//  NO REAL DATABASE / STORAGE: @/lib/prisma and @/lib/storage/blobStore's
//  getBlobStore() are both fully mocked (in-memory). classifyStoragePath
//  (from @/lib/services/specbook/storagePath) and safeBlobFileName (from
//  @/lib/storage/blobStore) are left as their REAL implementations — both are
//  pure, I/O-free functions, reused here exactly as the script reuses them.
// ──────────────────────────────────────────────────────────────────────────────

import fs from "fs/promises";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const SYNTHETIC_STORAGE_ROOT = "/synthetic-storage-root";
let previousStorageRoot: string | undefined;
let previousAppEnv: string | undefined;

beforeAll(() => {
  previousStorageRoot = process.env.STORAGE_LOCAL_PATH;
  previousAppEnv = process.env.APP_ENV;
  process.env.STORAGE_LOCAL_PATH = SYNTHETIC_STORAGE_ROOT;
});

afterAll(() => {
  if (previousStorageRoot === undefined) delete process.env.STORAGE_LOCAL_PATH;
  else process.env.STORAGE_LOCAL_PATH = previousStorageRoot;
  if (previousAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previousAppEnv;
});

// ── Prisma mock — in-memory Bid/SpecBook/SpecSection tables ────────────────

type BidRow = { id: number; projectName: string };
type SpecBookRow = { id: number; bidId: number; fileName: string; filePath: string; status: string };
type SpecSectionRow = {
  id: number;
  specBookId: number;
  csiNumber: string;
  csiTitle: string;
  pdfPath: string | null;
  pdfFileName: string | null;
};

const { db } = vi.hoisted(() => ({
  db: {
    bids: new Map<number, BidRow>(),
    specBooks: new Map<number, SpecBookRow>(),
    specBookCounter: 0,
    specSections: new Map<number, SpecSectionRow>(),
    specSectionCounter: 0,
  },
}));

function resetDb() {
  db.bids.clear();
  db.specBooks.clear();
  db.specBookCounter = 0;
  db.specSections.clear();
  db.specSectionCounter = 0;
}

const FIXTURE_BID_ID = 42;
const OTHER_BID_ID = 999;
const FIXTURE_NAME = "FIXTURE PROD-SHAPE — DELETE ME";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) => db.bids.get(where.id) ?? null),
    },
    specBook: {
      count: vi.fn(
        async ({ where }: { where: { bidId: number } }) =>
          [...db.specBooks.values()].filter((r) => r.bidId === where.bidId).length
      ),
      create: vi.fn(async ({ data }: { data: Omit<SpecBookRow, "id"> }) => {
        db.specBookCounter += 1;
        const row: SpecBookRow = { id: db.specBookCounter, ...data };
        db.specBooks.set(row.id, row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { bidId: number } }) => {
        const books = [...db.specBooks.values()].filter((r) => r.bidId === where.bidId);
        return books.map((b) => ({
          ...b,
          sections: [...db.specSections.values()].filter((s) => s.specBookId === b.id),
        }));
      }),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        const row = db.specBooks.get(where.id) ?? null;
        db.specBooks.delete(where.id);
        return row;
      }),
    },
    specSection: {
      create: vi.fn(async ({ data }: { data: Omit<SpecSectionRow, "id"> }) => {
        db.specSectionCounter += 1;
        const row: SpecSectionRow = { id: db.specSectionCounter, ...data };
        db.specSections.set(row.id, row);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        const row = db.specSections.get(where.id) ?? null;
        db.specSections.delete(where.id);
        return row;
      }),
    },
  },
}));

// ── BlobStore mock — real safeBlobFileName preserved via importOriginal ────

const { blobData, blobPutMock, blobDeleteMock, blobExistsMock, blobGetMock, getBlobStoreMock } = vi.hoisted(() => {
  const blobData = new Map<string, Buffer>();
  const blobPutMock = vi.fn(async (key: string, data: Buffer) => {
    blobData.set(key, data);
    return { size: data.length, sha256: "fake-sha", storedAt: "2026-01-01T00:00:00.000Z" };
  });
  const blobDeleteMock = vi.fn(async (key: string) => {
    blobData.delete(key);
  });
  const blobExistsMock = vi.fn(async (key: string) => blobData.has(key));
  const blobGetMock = vi.fn(async (key: string) => blobData.get(key) ?? Buffer.from(""));
  const getBlobStoreMock = vi.fn(() => ({
    put: blobPutMock,
    get: blobGetMock,
    exists: blobExistsMock,
    delete: blobDeleteMock,
    stat: vi.fn(async () => null),
  }));
  return { blobData, blobPutMock, blobDeleteMock, blobExistsMock, blobGetMock, getBlobStoreMock };
});

vi.mock("@/lib/storage/blobStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/blobStore")>();
  return {
    ...actual,
    getBlobStore: getBlobStoreMock,
  };
});

// classifyStoragePath is imported REAL (unmocked) — pure, I/O-free classifier.

import { parseArgv, runMain, CONFIRM_PHRASE, FIXTURE_BID_NAME } from "../specbook-legacy-fixture";
import { prisma } from "@/lib/prisma";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDb();
  blobData.clear();
  vi.clearAllMocks();
  db.bids.set(FIXTURE_BID_ID, { id: FIXTURE_BID_ID, projectName: FIXTURE_NAME });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("constants", () => {
  test("FIXTURE_BID_NAME matches the task's required exact string", () => {
    expect(FIXTURE_BID_NAME).toBe(FIXTURE_NAME);
  });

  test("CONFIRM_PHRASE is distinct from the storage-inventory tool's phrase", () => {
    expect(CONFIRM_PHRASE).not.toBe("I UNDERSTAND THIS WRITES TO THE DATABASE");
    expect(CONFIRM_PHRASE).toMatch(/SPEC BOOK FIXTURE/);
  });
});

describe("parseArgv", () => {
  test("defaults", () => {
    expect(parseArgv([])).toEqual({ seed: false, cleanup: false, dryRun: false, help: false });
  });

  test("parses --seed --bid-id <n> --confirm <phrase>", () => {
    expect(parseArgv(["--seed", "--bid-id", "42", "--confirm", CONFIRM_PHRASE])).toEqual({
      seed: true,
      cleanup: false,
      dryRun: false,
      help: false,
      bidId: 42,
      confirm: CONFIRM_PHRASE,
    });
  });

  test("parses --cleanup", () => {
    expect(parseArgv(["--cleanup", "--bid-id", "7"]).cleanup).toBe(true);
  });

  test("parses --help / -h", () => {
    expect(parseArgv(["--help"]).help).toBe(true);
    expect(parseArgv(["-h"]).help).toBe(true);
  });
});

describe("dry-run (default posture)", () => {
  test("no flags at all: exit 0, zero Prisma calls, zero getBlobStore calls", async () => {
    const code = await runMain([]);
    expect(code).toBe(0);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(prisma.specBook.count).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test("explicit --dry-run: exit 0, zero Prisma/BlobStore calls", async () => {
    const code = await runMain(["--dry-run"]);
    expect(code).toBe(0);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test("--bid-id/--confirm present but no --seed/--cleanup: still dry-run, zero I/O", async () => {
    const code = await runMain(["--bid-id", "42", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(0);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test("explicit --dry-run alongside --seed still refuses to write", async () => {
    const code = await runMain(["--dry-run", "--seed", "--bid-id", "42", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(0);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });
});

describe("gate: confirmation phrase", () => {
  test("missing --confirm refuses before all I/O", async () => {
    const code = await runMain(["--seed", "--bid-id", "42"]);
    expect(code).toBe(1);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test("wrong --confirm phrase refuses before all I/O", async () => {
    const code = await runMain(["--seed", "--bid-id", "42", "--confirm", "close but not exact"]);
    expect(code).toBe(1);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });
});

describe("gate: APP_ENV", () => {
  test("APP_ENV unset refuses before any Prisma/BlobStore call", async () => {
    delete process.env.APP_ENV;
    const code = await runMain(["--seed", "--bid-id", "42", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test('APP_ENV="local" refuses before any Prisma/BlobStore call', async () => {
    process.env.APP_ENV = "local";
    const code = await runMain(["--seed", "--bid-id", "42", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(prisma.bid.findUnique).not.toHaveBeenCalled();
    expect(getBlobStoreMock).not.toHaveBeenCalled();
    process.env.APP_ENV = "staging";
  });
});

describe("gate: Bid identity", () => {
  beforeEach(() => {
    process.env.APP_ENV = "staging";
  });

  test("Bid does not exist: refuses (Bid lookup itself is expected, nothing beyond it)", async () => {
    const code = await runMain(["--seed", "--bid-id", "12345", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(prisma.bid.findUnique).toHaveBeenCalledTimes(1);
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test("close-but-not-exact projectName refuses", async () => {
    db.bids.set(1, { id: 1, projectName: "FIXTURE PROD-SHAPE - DELETE ME" }); // hyphen, not em-dash
    const code = await runMain(["--seed", "--bid-id", "1", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });

  test("whitespace-variant projectName refuses", async () => {
    db.bids.set(2, { id: 2, projectName: `${FIXTURE_NAME} ` });
    const code = await runMain(["--seed", "--bid-id", "2", "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(getBlobStoreMock).not.toHaveBeenCalled();
  });
});

describe("--seed", () => {
  beforeEach(() => {
    process.env.APP_ENV = "staging";
  });

  test("refuses when the target Bid already has a SpecBook row, before any BlobStore write", async () => {
    db.specBookCounter += 1;
    db.specBooks.set(db.specBookCounter, {
      id: db.specBookCounter,
      bidId: FIXTURE_BID_ID,
      fileName: "existing.pdf",
      filePath: "plan-room/jobs/1/spec/original.pdf",
      status: "ready",
    });

    const code = await runMain(["--seed", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(prisma.specBook.count).toHaveBeenCalledTimes(1);
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(prisma.specBook.create).not.toHaveBeenCalled();
  });

  test("fully-gated run creates SpecBook + SpecSection with exact keys and absolute paths", async () => {
    const code = await runMain(["--seed", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(0);

    const originalKey = `uploads/specbooks/${FIXTURE_BID_ID}/fixture-original.pdf`;
    const sectionKey = `uploads/specbooks/${FIXTURE_BID_ID}/sections/fixture-section.pdf`;

    expect(blobPutMock).toHaveBeenCalledWith(originalKey, expect.any(Buffer));
    expect(blobPutMock).toHaveBeenCalledWith(sectionKey, expect.any(Buffer));

    expect(prisma.specBook.create).toHaveBeenCalledWith({
      data: {
        bidId: FIXTURE_BID_ID,
        fileName: "fixture-original.pdf",
        filePath: `${SYNTHETIC_STORAGE_ROOT}/${originalKey}`,
        status: "ready",
      },
    });

    const createdBook = [...db.specBooks.values()][0];
    expect(prisma.specSection.create).toHaveBeenCalledWith({
      data: {
        specBookId: createdBook.id,
        csiNumber: "00 00 00",
        csiTitle: "Fixture Section",
        pdfPath: `${SYNTHETIC_STORAGE_ROOT}/${sectionKey}`,
        pdfFileName: "fixture-section.pdf",
      },
    });
  });
});

describe("--cleanup", () => {
  beforeEach(() => {
    process.env.APP_ENV = "staging";
  });

  async function seedFixture(bidId: number) {
    const code = await runMain(["--seed", "--bid-id", String(bidId), "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(0);
  }

  test("deletes exactly the fixture's own rows/blobs and never touches another Bid's data", async () => {
    await seedFixture(FIXTURE_BID_ID);

    // Unrelated SpecBook fixture row for a DIFFERENT bid — must never be referenced.
    db.bids.set(OTHER_BID_ID, { id: OTHER_BID_ID, projectName: "Some Other Real Job" });
    db.specBookCounter += 1;
    const otherBookId = db.specBookCounter;
    db.specBooks.set(otherBookId, {
      id: otherBookId,
      bidId: OTHER_BID_ID,
      fileName: "real.pdf",
      filePath: `${SYNTHETIC_STORAGE_ROOT}/uploads/specbooks/${OTHER_BID_ID}/real.pdf`,
      status: "ready",
    });
    const otherKey = `uploads/specbooks/${OTHER_BID_ID}/real.pdf`;
    blobData.set(otherKey, Buffer.from("real content"));

    vi.clearAllMocks();

    const code = await runMain(["--cleanup", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(0);

    const originalKey = `uploads/specbooks/${FIXTURE_BID_ID}/fixture-original.pdf`;
    const sectionKey = `uploads/specbooks/${FIXTURE_BID_ID}/sections/fixture-section.pdf`;
    expect(blobDeleteMock).toHaveBeenCalledWith(originalKey);
    expect(blobDeleteMock).toHaveBeenCalledWith(sectionKey);
    expect(blobDeleteMock).not.toHaveBeenCalledWith(otherKey);

    // Fixture rows gone, other bid's row untouched.
    expect(db.specBooks.size).toBe(1);
    expect(db.specBooks.has(otherBookId)).toBe(true);
    expect(db.specSections.size).toBe(0);
    expect(blobData.has(otherKey)).toBe(true);
  });

  test("refuses cleanup when the SpecBook row does not classify as legacy-storage-root (e.g. canonical shape)", async () => {
    db.specBookCounter += 1;
    const bookId = db.specBookCounter;
    db.specBooks.set(bookId, {
      id: bookId,
      bidId: FIXTURE_BID_ID,
      fileName: "canonical.pdf",
      filePath: "plan-room/jobs/1/spec/original.pdf", // canonical relative key, NOT legacy-storage-root
      status: "ready",
    });

    const code = await runMain(["--cleanup", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    expect(code).toBe(1);
    expect(blobDeleteMock).not.toHaveBeenCalled();
    expect(db.specBooks.has(bookId)).toBe(true);
  });
});

describe("no HTTP/sidecar/provider/job path reachable", () => {
  test("the script's own import statements touch nothing under app/api/**, no fetch, no SIDECAR_URL, no job-creation service", async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, "..", "specbook-legacy-fixture.ts"),
      "utf8"
    );
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line));

    // Exactly the four expected imports — Node builtins + the two allowed
    // app-side modules (plus the cleanup-only storagePath classifier).
    expect(importLines).toEqual([
      'import path, { resolve } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'import { prisma } from "@/lib/prisma";',
      'import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";',
      'import { classifyStoragePath } from "@/lib/services/specbook/storagePath";',
    ]);

    expect(importLines.some((line) => line.includes("app/api"))).toBe(false);

    // Belt-and-suspenders: no reachable fetch/sidecar/job-creation call
    // anywhere in the CODE (imports already proved above) — scan only
    // non-comment lines so this doesn't false-positive on doc-comment prose
    // that legitimately discusses what's NOT imported.
    const codeOnly = source
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(codeOnly).not.toMatch(/SIDECAR_URL/);
    expect(codeOnly).not.toMatch(/fetch\(/);
    expect(codeOnly).not.toMatch(/generateBidIntelligence|triggerBriefRefresh|parseSpecSections/);
  });
});

describe("output discipline sweep", () => {
  test("no scenario ever prints the storage root, bid-scoped path segments, or synthetic PDF bytes", async () => {
    const captured: string[] = [];
    logSpy.mockImplementation((...a: unknown[]) => {
      captured.push(a.map(String).join(" "));
    });
    errorSpy.mockImplementation((...a: unknown[]) => {
      captured.push(a.map(String).join(" "));
    });

    // Dry-run.
    await runMain([]);
    // Missing confirm.
    await runMain(["--seed", "--bid-id", String(FIXTURE_BID_ID)]);
    // Wrong APP_ENV.
    process.env.APP_ENV = "local";
    await runMain(["--seed", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    process.env.APP_ENV = "staging";
    // Wrong Bid name.
    db.bids.set(3, { id: 3, projectName: "not it" });
    await runMain(["--seed", "--bid-id", "3", "--confirm", CONFIRM_PHRASE]);
    // Fully-gated seed.
    await runMain(["--seed", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    // Double-seed refusal.
    await runMain(["--seed", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);
    // Fully-gated cleanup.
    await runMain(["--cleanup", "--bid-id", String(FIXTURE_BID_ID), "--confirm", CONFIRM_PHRASE]);

    const all = captured.join("\n");
    expect(all).not.toContain(SYNTHETIC_STORAGE_ROOT);
    expect(all).not.toContain(`uploads/specbooks/${FIXTURE_BID_ID}/`);
    expect(all).not.toContain("%PDF");
    expect(all).not.toContain("FIXTURE SPEC BOOK - SYNTHETIC - DISPOSABLE");
    expect(all).not.toContain("FIXTURE SPEC SECTION - SYNTHETIC - DISPOSABLE");
  });
});
