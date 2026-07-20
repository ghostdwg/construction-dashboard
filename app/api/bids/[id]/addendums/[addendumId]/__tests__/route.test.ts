// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/addendums/[addendumId]/__tests__/route.test.ts
//
//  Artifact-durability coverage: DELETE previously only removed the DB row —
//  there was no filePath/storageKey column at all, so on-disk cleanup was
//  genuinely unaddressable. It now best-effort deletes the durable blob when
//  the new nullable `storageKey` column is present, and safely no-ops
//  (never errors, never guesses a path) for historic rows where it's null.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "addendums-delete-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

type AddendumRow = { id: number; bidId: number; storageKey: string | null };

const db = {
  record: null as AddendumRow | null,
  deletedId: null as number | null,
  briefUpdateManyArgs: null as unknown,
};

// Q03.2b: the persisted Admin "Document AI Enrichment" setting — null =
// no AppSetting row (DB default OFF); a string = the row's stored value.
const h = vi.hoisted(() => ({
  adminAutomation: { value: null as string | null },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(async () =>
        h.adminAutomation.value === null
          ? null
          : { id: 1, key: "documentAutomationEnabled", value: h.adminAutomation.value, updatedAt: new Date(0) }
      ),
    },
    addendumUpload: {
      findFirst: vi.fn(async () => db.record),
      findMany: vi.fn(async () =>
        db.record ? [{ bidId: db.record.bidId, storageKey: db.record.storageKey }] : [],
      ),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        db.deletedId = where.id;
        db.record = null;
        return { id: where.id };
      }),
    },
    bidIntelligenceBrief: {
      updateMany: vi.fn(async (args: unknown) => {
        db.briefUpdateManyArgs = args;
        return { count: 0 };
      }),
    },
  },
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({ ok: true, user: { id: "u1", role: "admin" } })),
}));

const triggerBriefRefreshMock = vi.fn(async () => undefined);
vi.mock("@/lib/services/jobs/briefRefreshAutomation", () => ({
  triggerBriefRefresh: triggerBriefRefreshMock,
}));

const routeParams = (bidId: number, addendumId: number) => ({
  params: Promise.resolve({ id: String(bidId), addendumId: String(addendumId) }),
});

describe("DELETE /api/bids/[id]/addendums/[addendumId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_LOCAL_PATH = storageRoot;
    db.record = null;
    db.deletedId = null;
    db.briefUpdateManyArgs = null;
    // CHANGED (master automation gate, release-hardening fix): this suite
    // predates DOCUMENT_AUTOMATION_ENABLED, whose default is now OFF. This
    // file's tests are about durability/blob-cleanup mechanics, not the
    // master automation gate (that's covered by storageSmoke.test.ts's 1/1b/1c),
    // so the flag is set ON here to preserve every existing test's original
    // meaning without change.
    h.adminAutomation.value = "true"; // Admin setting ON (persisted)
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    h.adminAutomation.value = null; delete process.env.DOCUMENT_AUTOMATION_ENABLED; delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
  });

  test("deletes the durable blob when storageKey is present", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "uploads/addendums/31/addendum.pdf";
    await getBlobStore().put(key, Buffer.from("bytes"));

    db.record = { id: 31, bidId: 31, storageKey: key };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(31, 31));
    const json = await res.json();

    expect(json.deleted).toBe(true);
    expect(db.deletedId).toBe(31);
    expect(await getBlobStore().exists(key)).toBe(false);
  });

  test("historic row with storageKey === null is a safe no-op — no error, no BlobStore call", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const deleteSpy = vi.spyOn(getBlobStore(), "delete");

    db.record = { id: 32, bidId: 32, storageKey: null };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(32, 32));
    const json = await res.json();

    expect(json.deleted).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  test("a production-shaped (legacy-storage-root) storageKey belonging to a DIFFERENT bid is rejected — no BlobStore.delete, blob untouched", async () => {
    // Bid-scoping is only structurally enforced for the absolute
    // legacy-storage-root shape — a bare relative (canonical) key has no
    // bidId segment to check by design (see legacyPathCompat.ts's module
    // doc, mirroring lib/services/specbook/storagePath.ts). This case uses
    // the absolute production-shaped path to exercise that enforcement.
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const deleteSpy = vi.spyOn(getBlobStore(), "delete");
    const otherBidKey = "uploads/addendums/999/addendum.pdf";
    await getBlobStore().put(otherBidKey, Buffer.from("someone else's bid data"));

    db.record = { id: 33, bidId: 33, storageKey: path.join(storageRoot, otherBidKey) };

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(33, 33));

    expect(res.status).toBe(200);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(await getBlobStore().exists(otherBidKey)).toBe(true);
    deleteSpy.mockRestore();
  });

  test("addendum not found under this bid returns the existing 404", async () => {
    db.record = null;
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(34, 34));
    expect(res.status).toBe(404);
  });

  test("marks brief stale and triggers refresh", async () => {
    db.record = { id: 35, bidId: 35, storageKey: null };
    const { DELETE } = await import("../route");
    await DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeParams(35, 35));
    expect(db.briefUpdateManyArgs).toEqual({ where: { bidId: 35 }, data: { isStale: true } });
    expect(triggerBriefRefreshMock).toHaveBeenCalledWith(35, { triggerSource: "upload" });
  });
});
