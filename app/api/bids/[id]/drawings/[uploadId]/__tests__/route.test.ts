// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/drawings/[uploadId]/__tests__/route.test.ts
//
//  Delete now removes BlobStore keys instead of raw fs.unlink(absolutePath).
//  Uses a REAL LocalBlobStore against a temp directory so deletion really
//  happens (and traversal-like/cross-bid values are genuinely rejected, not
//  just assumed safe by a mock) — only the legacy-path fs.unlink call is
//  mocked ("fs/promises", a different module specifier than BlobStore's
//  "node:fs", so this never touches BlobStore's own file I/O). Mirrors
//  app/api/bids/[id]/specbook/[uploadId]/__tests__/route.test.ts's
//  conventions exactly.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "drawings-delete-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

type DrawingUploadRow = { id: number; bidId: number; filePath: string };

const db = {
  upload: null as DrawingUploadRow | null,
  deletedId: null as number | null,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drawingUpload: {
      findFirst: vi.fn(async () => db.upload),
      findMany: vi.fn(async () =>
        db.upload ? [{ bidId: db.upload.bidId, filePath: db.upload.filePath }] : [],
      ),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        db.deletedId = where.id;
        db.upload = null;
        return { id: where.id };
      }),
    },
  },
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({ ok: true, user: { id: "u1", role: "admin" } })),
}));

const fsUnlinkMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { unlink: fsUnlinkMock },
  unlink: fsUnlinkMock,
}));

const routeParams = (bidId: number, uploadId: number) => ({
  params: Promise.resolve({ id: String(bidId), uploadId: String(uploadId) }),
});

describe("DELETE /api/bids/[id]/drawings/[uploadId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_LOCAL_PATH = storageRoot;
    db.upload = null;
    db.deletedId = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("deletes a canonical relative-key drawing via BlobStore.delete", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "uploads/drawings/21/plan.pdf";
    await getBlobStore().put(key, Buffer.from("bytes"));

    db.upload = { id: 21, bidId: 21, filePath: key };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(21, 21));

    expect(res.status).toBe(204);
    expect(db.deletedId).toBe(21);
    expect(await getBlobStore().exists(key)).toBe(false);
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });

  test("deletes a production-shaped (legacy-storage-root) absolute filePath via BlobStore.delete against the derived key", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "uploads/drawings/22/plan.pdf";
    await getBlobStore().put(key, Buffer.from("bytes"));

    db.upload = { id: 22, bidId: 22, filePath: path.join(storageRoot, key) };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(22, 22));

    expect(res.status).toBe(204);
    expect(await getBlobStore().exists(key)).toBe(false);
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });

  test("a production-shaped filePath belonging to a DIFFERENT bid is rejected — no BlobStore.delete, no fs.unlink, blob untouched", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const deleteSpy = vi.spyOn(getBlobStore(), "delete");
    const otherBidKey = "uploads/drawings/999/plan.pdf";
    await getBlobStore().put(otherBidKey, Buffer.from("someone else's bid data"));

    db.upload = { id: 23, bidId: 23, filePath: path.join(storageRoot, otherBidKey) };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(23, 23));

    expect(res.status).toBe(204); // best-effort cleanup: DB delete still succeeds
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(fsUnlinkMock).not.toHaveBeenCalled();
    expect(await getBlobStore().exists(otherBidKey)).toBe(true);
    deleteSpy.mockRestore();
  });

  test("legacy cwd-rooted absolute paths are unlinked directly, not through BlobStore", async () => {
    const legacyPath = path.join(process.cwd(), "uploads", "drawings", "24", "plan.pdf");
    db.upload = { id: 24, bidId: 24, filePath: legacyPath };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(24, 24));

    expect(res.status).toBe(204);
    expect(fsUnlinkMock).toHaveBeenCalledWith(legacyPath);
  });

  test("a traversal-like stored filePath is rejected, not unlinked as an arbitrary path", async () => {
    db.upload = { id: 25, bidId: 25, filePath: "../../../../etc/passwd" };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(25, 25));

    expect(res.status).toBe(204);
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });

  test("drawing upload not found under this bid returns the existing 404", async () => {
    db.upload = null;
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(26, 26));
    expect(res.status).toBe(404);
  });
});
