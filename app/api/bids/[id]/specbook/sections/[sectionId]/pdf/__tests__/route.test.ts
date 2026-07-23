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

const h = vi.hoisted(() => ({ requireBidAccess: vi.fn() }));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: h.requireBidAccess,
}));

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
      findFirst: vi.fn(async ({ where }: { where: { id: number; specBook: { bidId: number } } }) =>
        db.section?.id === where.id && db.section.specBook.bidId === where.specBook.bidId
          ? db.section
          : null,
      ),
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
    h.requireBidAccess.mockResolvedValue({
      ok: true,
      user: { id: "u1", role: "admin" },
    });
    db.section = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("anonymous read is rejected before child lookup or BlobStore access", async () => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    const { prisma } = await import("@/lib/prisma");
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const getSpy = vi.spyOn(getBlobStore(), "get");

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 5));

    expect(res.status).toBe(401);
    expect(prisma.specSection.findFirst).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
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

  test("serves BlobStore content for a production-shaped legacy-storage-root path matching this section's own bid", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const canonicalKey = "uploads/specbooks/9/sections/03_30_00_cast_in_place_concrete.pdf";
    const getSpy = vi.spyOn(getBlobStore(), "get");
    await getBlobStore().put(canonicalKey, Buffer.from("production section pdf bytes"));

    db.section = {
      id: 20,
      pdfPath: path.join(storageRoot, canonicalKey),
      pdfFileName: "03_30_00_cast_in_place_concrete.pdf",
      specBook: { bidId: 9 },
    };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 20));

    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString()).toBe("production section pdf bytes");
    // Resolved through the derived relative key, never the raw absolute path.
    expect(getSpy).toHaveBeenCalledWith(canonicalKey);
    expect(fsReadFileMock).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  test("a production-shaped legacy-storage-root path belonging to a DIFFERENT bid is treated as invalid, not served", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const canonicalKey = "uploads/specbooks/777/sections/other_bid.pdf";
    const getSpy = vi.spyOn(getBlobStore(), "get");
    await getBlobStore().put(canonicalKey, Buffer.from("someone else's bid data"));

    // Section row itself genuinely belongs to bid 9, but its pdfPath value
    // has been corrupted to point at bid 777's artifact.
    db.section = {
      id: 21,
      pdfPath: path.join(storageRoot, canonicalKey),
      pdfFileName: "other_bid.pdf",
      specBook: { bidId: 9 },
    };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 21));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("PDF file missing on disk");
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  test("a supported-looking but unrelated-namespace absolute path under the storage root is rejected, not served", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const getSpy = vi.spyOn(getBlobStore(), "get");
    const unrelatedPath = path.join(storageRoot, "uploads", "unrelated", "file.pdf");

    db.section = {
      id: 22,
      pdfPath: unrelatedPath,
      pdfFileName: "file.pdf",
      specBook: { bidId: 9 },
    };

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(9, 22));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("PDF file missing on disk");
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
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
