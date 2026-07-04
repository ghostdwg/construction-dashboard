// ──────────────────────────────────────────────────────────────────────────────
//  .../sections/[sectionId]/pdf/__tests__/route.test.ts
//
//  Serve route now reads section PDFs through BlobStore instead of a raw
//  fs.readFile(section.pdfPath). Uses the REAL LocalBlobStore against a temp
//  directory (not a mock) so the traversal/absolute-path rejection in
//  lib/storage/blobStore.ts's assertSafeKey is genuinely exercised — a fake
//  store would only prove the route calls .get(), not that unsafe keys are
//  actually rejected. Only the legacy-path fs.readFile call is mocked (a
//  different module specifier — "fs/promises" vs blobStore's "node:fs" — so
//  mocking it here never touches BlobStore's own file I/O).
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "specbook-serve-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

type SectionRow = {
  id: number;
  pdfPath: string | null;
  pdfFileName: string | null;
  specBook: { bidId: number };
};

const db = { section: null as SectionRow | null };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specSection: {
      findUnique: vi.fn(async () => db.section),
    },
  },
}));

const fsReadFileMock = vi.fn(async () => Buffer.from("legacy pdf bytes"));
vi.mock("fs/promises", () => ({
  default: { readFile: fsReadFileMock },
  readFile: fsReadFileMock,
}));

const routeParams = (bidId: number, sectionId: number) => ({
  params: Promise.resolve({ id: String(bidId), sectionId: String(sectionId) }),
});

describe("GET /api/bids/[id]/specbook/sections/[sectionId]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.section = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("serves BlobStore content for a new-format relative key", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "plan-room/jobs/9/spec/sections/03_30_00_cast_in_place_concrete.pdf";
    await getBlobStore().put(key, Buffer.from("real section pdf bytes"));

    db.section = {
      id: 5,
      pdfPath: key,
      pdfFileName: "03_30_00_cast_in_place_concrete.pdf",
      specBook: { bidId: 9 },
    };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 5));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString()).toBe("real section pdf bytes");
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });

  test("falls back to a direct read for a legacy absolute path", async () => {
    const legacyPath = path.join(process.cwd(), "uploads", "specbooks", "9", "sections", "old.pdf");
    db.section = { id: 6, pdfPath: legacyPath, pdfFileName: "old.pdf", specBook: { bidId: 9 } };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 6));

    expect(res.status).toBe(200);
    expect(fsReadFileMock).toHaveBeenCalledWith(legacyPath);
  });

  test("section not found under this bid returns 404", async () => {
    db.section = { id: 7, pdfPath: "plan-room/jobs/9/spec/sections/x.pdf", pdfFileName: "x.pdf", specBook: { bidId: 999 } };
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 7));
    expect(res.status).toBe(404);
  });

  test("missing pdfPath returns the existing controlled 404", async () => {
    db.section = { id: 8, pdfPath: null, pdfFileName: null, specBook: { bidId: 9 } };
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 8));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toMatch(/run split first/i);
  });

  test("a traversal-like stored key cannot escape the storage root", async () => {
    // Not a realistic DB value under normal operation, but proves the read
    // path can never be tricked into an arbitrary filesystem read even if
    // the stored value were ever corrupted or manipulated.
    db.section = {
      id: 9,
      pdfPath: "../../../../etc/passwd",
      pdfFileName: "x.pdf",
      specBook: { bidId: 9 },
    };
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 9));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("PDF file missing on disk");
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });

  test("a stored absolute path outside both BlobStore and the legacy root is rejected, not read directly", async () => {
    db.section = {
      id: 10,
      pdfPath: "/etc/passwd",
      pdfFileName: "x.pdf",
      specBook: { bidId: 9 },
    };
    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 10));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("PDF file missing on disk");
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });
});
