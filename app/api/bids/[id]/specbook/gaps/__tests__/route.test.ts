// ──────────────────────────────────────────────────────────────────────────────
//  .../specbook/gaps/__tests__/route.test.ts
//
//  GET /api/bids/[id]/specbook/gaps now additionally reports file
//  availability (see lib/services/specbook/fileAvailability.ts) so the UI
//  can show "source file missing — re-upload required" up front instead of
//  after a dead-link click. This exercises the route against a REAL
//  LocalBlobStore backed by a temp directory (not a mock) for the
//  durable-present/missing cases, and mocks only "fs/promises" — the module
//  specifier fileAvailability.ts uses for its legacy-path fs.access check,
//  distinct from BlobStore's own "node:fs" import — so BlobStore's real
//  file I/O is never touched by that mock. Prisma is mocked — no real DB.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({
    ok: true,
    user: { id: "u1", role: "admin" },
  })),
}));

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "specbook-gaps-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

const fsAccessMock = vi.fn(async (_path: string) => undefined);
vi.mock("fs/promises", () => ({
  default: { access: fsAccessMock },
  access: fsAccessMock,
}));

type SectionFixture = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  csiCanonicalTitle: string | null;
  tradeId: number | null;
  trade: { id: number; name: string } | null;
  matchedTradeId: number | null;
  matchedTrade: { id: number; name: string } | null;
  source: string | null;
  aiExtractions: string | null;
  pdfPath: string | null;
  pdfFileName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  pageCount: number | null;
};

const db = {
  specBook: null as {
    id: number;
    bidId: number;
    fileName: string;
    filePath: string;
    status: string;
    uploadedAt: Date;
    sections: SectionFixture[];
  } | null,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: {
      findFirst: vi.fn(async () => db.specBook),
    },
  },
}));

const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "specbooks");

function section(overrides: Partial<SectionFixture> & { id: number; csiNumber: string }): SectionFixture {
  return {
    csiTitle: `Concrete section ${overrides.id}`,
    csiCanonicalTitle: null,
    tradeId: 1,
    trade: { id: 1, name: "Concrete Sub" },
    matchedTradeId: null,
    matchedTrade: null,
    source: "split_pdf",
    aiExtractions: null,
    pdfFileName: `section_${overrides.id}.pdf`,
    pageStart: 1,
    pageEnd: 2,
    pageCount: 2,
    pdfPath: null,
    ...overrides,
  };
}

const routeParams = (bidId: number) => ({ params: Promise.resolve({ id: String(bidId) }) });

describe("GET /api/bids/[id]/specbook/gaps — file availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsAccessMock.mockImplementation(async () => undefined);
    db.specBook = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reports durable-present, legacy-present, missing, invalid, and traversal-like sections distinctly", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const durableKey = "plan-room/jobs/9/spec/sections/03_30_00.pdf";
    await getBlobStore().put(durableKey, Buffer.from("real bytes"));

    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "9", "sections", "legacy.pdf");
    fsAccessMock.mockImplementation(async (p: string) => {
      if (p === legacyPath) return undefined;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    db.specBook = {
      id: 9,
      bidId: 9,
      fileName: "spec.pdf",
      filePath: durableKey, // original source PDF — present
      status: "ready",
      uploadedAt: new Date("2026-01-01"),
      sections: [
        section({ id: 1, csiNumber: "03 30 00", pdfPath: durableKey }),
        section({ id: 2, csiNumber: "03 31 00", pdfPath: legacyPath }),
        section({ id: 3, csiNumber: "03 32 00", pdfPath: "plan-room/jobs/9/spec/sections/never_uploaded.pdf" }),
        section({ id: 4, csiNumber: "03 33 00", pdfPath: "/etc/passwd" }),
        section({ id: 5, csiNumber: "03 34 00", pdfPath: "../../../../etc/passwd" }),
      ],
    };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.specBook.sourceAvailability).toBe("durable-present");

    const byId = new Map(
      (body.covered as Array<{ id: number; pdfAvailability: string; hasPdf: boolean }>).map((s) => [s.id, s])
    );
    expect(byId.get(1)).toMatchObject({ hasPdf: true, pdfAvailability: "durable-present" });
    expect(byId.get(2)).toMatchObject({ hasPdf: true, pdfAvailability: "legacy-present" });
    expect(byId.get(3)).toMatchObject({ hasPdf: true, pdfAvailability: "missing" });
    expect(byId.get(4)).toMatchObject({ hasPdf: true, pdfAvailability: "invalid" });
    expect(byId.get(5)).toMatchObject({ hasPdf: true, pdfAvailability: "invalid" });

    // Additive: pre-existing fields are untouched.
    expect(byId.get(1)!.hasPdf).toBe(true);
  });

  test("a section that hasn't been split yet reports pdfAvailability: null, not missing", async () => {
    db.specBook = {
      id: 10,
      bidId: 10,
      fileName: "spec.pdf",
      filePath: "plan-room/jobs/10/spec/original.pdf",
      status: "ready",
      uploadedAt: new Date("2026-01-01"),
      sections: [section({ id: 20, csiNumber: "03 30 00", pdfPath: null })],
    };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(10));
    const body = await res.json();

    expect(body.covered[0]).toMatchObject({ hasPdf: false, pdfAvailability: null });
  });

  test("no spec book uploaded returns null, unchanged", async () => {
    db.specBook = null;
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(11));
    expect(await res.json()).toBeNull();
  });
});
