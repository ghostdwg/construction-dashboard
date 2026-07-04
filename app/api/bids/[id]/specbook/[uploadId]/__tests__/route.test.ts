// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/specbook/[uploadId]/__tests__/route.test.ts
//
//  Delete now removes BlobStore keys instead of raw fs.unlink(absolutePath).
//  Uses the REAL LocalBlobStore against a temp directory so deletion really
//  happens (and traversal-like values are genuinely rejected, not just
//  assumed safe by a mock) — only the legacy-path fs.unlink call is mocked
//  ("fs/promises", a different module specifier than BlobStore's "node:fs",
//  so this never touches BlobStore's own file I/O).
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "specbook-delete-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

type SpecBookRow = {
  id: number;
  bidId: number;
  filePath: string;
  sections: Array<{ id: number; pdfPath: string | null }>;
};

const db = {
  specBook: null as SpecBookRow | null,
  deletedSpecBookId: null as number | null,
  submittalUpdateManyArgs: null as unknown,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: {
      findFirst: vi.fn(async () => db.specBook),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        db.deletedSpecBookId = where.id;
        return { id: where.id };
      }),
    },
    submittalItem: {
      updateMany: vi.fn(async (args: unknown) => {
        db.submittalUpdateManyArgs = args;
        return { count: 0 };
      }),
    },
  },
}));

const fsUnlinkMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { unlink: fsUnlinkMock },
  unlink: fsUnlinkMock,
}));

const routeParams = (bidId: number, uploadId: number) => ({
  params: Promise.resolve({ id: String(bidId), uploadId: String(uploadId) }),
});

describe("DELETE /api/bids/[id]/specbook/[uploadId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.specBook = null;
    db.deletedSpecBookId = null;
    db.submittalUpdateManyArgs = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("deletes exactly the known BlobStore keys for this spec book — original + sections", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const originalKey = "plan-room/jobs/11/spec/original.pdf";
    const sectionKey = "plan-room/jobs/11/spec/sections/03_30_00_cast_in_place_concrete.pdf";
    await getBlobStore().put(originalKey, Buffer.from("original"));
    await getBlobStore().put(sectionKey, Buffer.from("section"));

    db.specBook = {
      id: 11,
      bidId: 11,
      filePath: originalKey,
      sections: [{ id: 100, pdfPath: sectionKey }],
    };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(11, 11));

    expect(res.status).toBe(204);
    expect(db.deletedSpecBookId).toBe(11);
    expect(await getBlobStore().exists(originalKey)).toBe(false);
    expect(await getBlobStore().exists(sectionKey)).toBe(false);
    expect(fsUnlinkMock).not.toHaveBeenCalled();

    const updateArgs = db.submittalUpdateManyArgs as { where: { specSectionId: { in: number[] } } };
    expect(updateArgs.where.specSectionId.in).toEqual([100]);
  });

  test("does not touch unrelated keys under the same bid prefix", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const originalKey = "plan-room/jobs/12/spec/original.pdf";
    const unrelatedKey = "plan-room/jobs/12/drawings/original.pdf"; // owned by a different route
    await getBlobStore().put(originalKey, Buffer.from("original"));
    await getBlobStore().put(unrelatedKey, Buffer.from("drawing"));

    db.specBook = { id: 12, bidId: 12, filePath: originalKey, sections: [] };

    const { DELETE } = await import("../route");
    await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(12, 12));

    expect(await getBlobStore().exists(originalKey)).toBe(false);
    expect(await getBlobStore().exists(unrelatedKey)).toBe(true);
  });

  test("legacy absolute paths are unlinked directly, not through BlobStore", async () => {
    const legacyOriginal = path.join(process.cwd(), "uploads", "specbooks", "13", "book.pdf");
    const legacySection = path.join(process.cwd(), "uploads", "specbooks", "13", "sections", "s.pdf");
    db.specBook = {
      id: 13,
      bidId: 13,
      filePath: legacyOriginal,
      sections: [{ id: 200, pdfPath: legacySection }],
    };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(13, 13));

    expect(res.status).toBe(204);
    expect(fsUnlinkMock).toHaveBeenCalledWith(legacyOriginal);
    expect(fsUnlinkMock).toHaveBeenCalledWith(legacySection);
  });

  test("a corrupted/traversal-like stored key is rejected, not unlinked as an arbitrary path", async () => {
    db.specBook = {
      id: 14,
      bidId: 14,
      filePath: "plan-room/jobs/14/spec/original.pdf",
      sections: [{ id: 300, pdfPath: "../../../../etc/passwd" }],
    };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(14, 14));

    // Best-effort cleanup: the DB delete still succeeds; the unsafe key is
    // simply never opened (BlobStore.delete rejects it internally and the
    // route's Promise.allSettled swallows that single failure).
    expect(res.status).toBe(204);
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });

  test("spec book not found under this bid returns the existing 404", async () => {
    db.specBook = null;
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(15, 15));
    expect(res.status).toBe(404);
  });
});
