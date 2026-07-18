// Module OPS1 (Slice 1) — route coverage for the tracked-item register:
// collection list/create, OAC promote bridge, FSM status route, append-only
// comments, and MIME/size-gated attachment upload. Mocked Prisma/auth/audit/
// BlobStore per the repo idiom — no DB, no network, no provider import
// anywhere on these paths.
import { beforeEach, describe, expect, test, vi } from "vitest";

// Suppress the post-commit stdout audit line — persistence still runs.
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

const h = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown> & { id: number; bidId: number; status: string }>,
  comments: [] as Array<Record<string, unknown> & { id: number; trackedItemId: number }>,
  attachments: [] as Array<Record<string, unknown> & { id: number; trackedItemId: number }>,
  meetingActionItems: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  audits: [] as Array<Record<string, unknown>>,
  bidExists: true,
  nextId: 1,
}));

const putMock = vi.hoisted(() => vi.fn(async () => ({ key: "x" })));
const deleteMock = vi.hoisted(() => vi.fn(async () => undefined));
const accessMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));
vi.mock("@/lib/auth-helpers", () => ({ requireBidAccess: accessMock }));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ put: putMock, delete: deleteMock }),
  safeBlobFileName: (name: string) => {
    const base = name.split("/").pop()!.trim();
    return base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
  },
}));

vi.mock("@/lib/prisma", () => {
  const p: Record<string, unknown> = {
    bid: { findUnique: vi.fn(async () => (h.bidExists ? { id: 1 } : null)) },
    // Spec gap hint count: no specBook in test data → all items get gapHintCount 0.
    specBook: { findFirst: vi.fn(async () => null) },
    // Phase 1B — badge derivation queries this model on every list read.
    consultantDispositionRecord: { findMany: vi.fn(async () => []) },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push({ ...data });
        return { id: h.nextId++ };
      }),
    },
    trackedItem: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.items
          .filter(
            (i) =>
              i.bidId === where.bidId &&
              (where.kind === undefined || i.kind === where.kind) &&
              (where.status === undefined || i.status === where.status)
          )
          .map((i) => ({
            ...i,
            _count: { comments: 0, attachments: 0, supportingObservations: 0 },
          }))
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.items.find(
          (i) =>
            (where.id === undefined || i.id === where.id) &&
            (where.bidId === undefined || i.bidId === where.bidId) &&
            (where.sourceMeetingActionItemId === undefined ||
              i.sourceMeetingActionItemId === where.sourceMeetingActionItemId)
        );
        if (!found) return null;
        return { ...found, comments: h.comments.filter((c) => c.trackedItemId === found.id), attachments: [] };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Mirror real Prisma defaults the service relies on.
        const row = {
          id: h.nextId++,
          status: "OPEN",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          ...data,
        } as unknown as (typeof h.items)[number];
        h.items.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.items.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    trackedItemComment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, createdAt: new Date(0), ...data } as unknown as (typeof h.comments)[number];
        h.comments.push(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async ({ where }: { where: { trackedItemId: number } }) =>
        h.comments.filter((c) => c.trackedItemId === where.trackedItemId)
      ),
    },
    trackedItemAttachment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, createdAt: new Date(0), ...data } as unknown as (typeof h.attachments)[number];
        h.attachments.push(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async ({ where }: { where: { trackedItemId: number } }) =>
        h.attachments.filter((a) => a.trackedItemId === where.trackedItemId)
      ),
    },
    meetingActionItem: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) =>
        h.meetingActionItems.find((m) => m.id === where.id && m.bidId === where.bidId) ?? null
      ),
    },
  };
  // Rollback-capable interactive transaction — mutation + audit are atomic.
  p.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snap = {
      items: h.items.map((r) => ({ ...r })),
      comments: h.comments.map((r) => ({ ...r })),
      attachments: h.attachments.map((r) => ({ ...r })),
      audits: h.audits.map((r) => ({ ...r })),
    };
    try {
      return await fn(p);
    } catch (err) {
      h.items.splice(0, h.items.length, ...snap.items);
      h.comments.splice(0, h.comments.length, ...snap.comments);
      h.attachments.splice(0, h.attachments.length, ...snap.attachments);
      h.audits.splice(0, h.audits.length, ...snap.audits);
      throw err;
    }
  };
  return { prisma: p };
});

import { GET as listGET, POST as createPOST } from "../route";
import { POST as promotePOST } from "../promote/route";
import { POST as statusPOST } from "../[itemId]/status/route";
import { GET as commentsGET, POST as commentsPOST } from "../[itemId]/comments/route";
import { POST as attachmentsPOST } from "../[itemId]/attachments/route";

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pi = (id: string, itemId: string) => ({ params: Promise.resolve({ id, itemId }) });
const jsonReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.items.length = 0;
  h.comments.length = 0;
  h.attachments.length = 0;
  h.meetingActionItems.length = 0;
  h.audits.length = 0;
  h.bidExists = true;
  h.nextId = 1;
  putMock.mockClear();
  deleteMock.mockClear();
  accessMock.mockReset();
  accessMock.mockResolvedValue({ ok: true, user: { id: "user-1" } });
});

describe("tracked-items routes", () => {
  test("authorization denial occurs before body parsing, mutation, and blob writes", async () => {
    accessMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Not found" }, { status: 404 }),
    });
    const request = { formData: vi.fn() } as unknown as Request;
    const response = await attachmentsPOST(request, pi("6", "1"));
    expect(response.status).toBe(404);
    expect(request.formData).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(h.attachments).toHaveLength(0);
  });
  test("POST create: 201 with actor from session; 400 on bad kind; 404 on missing bid", async () => {
    const ok = await createPOST(jsonReq({ kind: "WARRANTY", title: "roof warranty letter" }), p("5"));
    expect(ok.status).toBe(201);
    expect(h.items[0].bidId).toBe(5);

    const bad = await createPOST(jsonReq({ kind: "NOPE", title: "x" }), p("5"));
    expect(bad.status).toBe(400);

    h.bidExists = false;
    const noBid = await createPOST(jsonReq({ kind: "WARRANTY", title: "x" }), p("99"));
    expect(noBid.status).toBe(404);
  });

  test("GET list: bid-scoped with kind/status filters via query", async () => {
    await createPOST(jsonReq({ kind: "WARRANTY", title: "a" }), p("5"));
    await createPOST(jsonReq({ kind: "CLOSEOUT", title: "b" }), p("5"));
    await createPOST(jsonReq({ kind: "WARRANTY", title: "other" }), p("6"));

    const res = await listGET(new Request("http://test/api?kind=WARRANTY"), p("5"));
    const json = await res.json();
    expect(json.items.length).toBe(1);
    expect(json.items[0].title).toBe("a");
  });

  test("promote bridge: 201, evidence carried; 409 on duplicate; 404 wrong bid", async () => {
    h.meetingActionItems.push({
      id: 77,
      bidId: 5,
      meetingId: 12,
      source: "meeting",
      description: "submit curb detail",
      assignedToName: "Josh",
      dueDate: null,
      priority: "HIGH",
      sourceText: "owner asked at 00:41",
      carriedFromDate: null,
      notes: null,
    });
    const ok = await promotePOST(jsonReq({ meetingActionItemId: 77 }), p("5"));
    expect(ok.status).toBe(201);
    expect(h.items[0].sourceMeetingActionItemId).toBe(77);
    expect(h.items[0].evidenceExcerpt).toBe("owner asked at 00:41");

    const dup = await promotePOST(jsonReq({ meetingActionItemId: 77 }), p("5"));
    expect(dup.status).toBe(409);

    const wrongBid = await promotePOST(jsonReq({ meetingActionItemId: 77 }), p("6"));
    expect(wrongBid.status).toBe(404);

    const noId = await promotePOST(jsonReq({}), p("5"));
    expect(noId.status).toBe(400);
  });

  test("status route: FSM enforced — waive without reason 400, close records session actor", async () => {
    await createPOST(jsonReq({ kind: "OAC_ACTION", title: "x" }), p("5"));

    const noReason = await statusPOST(jsonReq({ to: "WAIVED" }), pi("5", "1"));
    expect(noReason.status).toBe(400);

    const closed = await statusPOST(jsonReq({ to: "CLOSED", note: "done on site" }), pi("5", "1"));
    expect(closed.status).toBe(200);
    expect(h.items[0].status).toBe("CLOSED");
    expect(h.items[0].closedBy).toBe("josh@example.test");
    expect(h.comments.length).toBe(1); // closeout note appended

    const wrongBid = await statusPOST(jsonReq({ to: "OPEN" }), pi("6", "1"));
    expect(wrongBid.status).toBe(404);
  });

  test("comments: append + list, bid-scoped 404", async () => {
    await createPOST(jsonReq({ kind: "TRAINING", title: "x" }), p("5"));
    const added = await commentsPOST(jsonReq({ body: "note" }), pi("5", "1"));
    expect(added.status).toBe(201);
    const list = await commentsGET(new Request("http://t"), pi("5", "1"));
    expect((await list.json()).comments.length).toBe(1);
    const wrong = await commentsGET(new Request("http://t"), pi("6", "1"));
    expect(wrong.status).toBe(404);
  });

  test("attachments: MIME allowlist enforced; accepted upload writes blob under canonical key", async () => {
    await createPOST(jsonReq({ kind: "FIELD_ITEM", title: "curb photo" }), p("5"));

    const badForm = new FormData();
    badForm.append("file", new File([new Uint8Array(10)], "x.zip", { type: "application/zip" }));
    const rejected = await attachmentsPOST(
      new Request("http://t", { method: "POST", body: badForm }),
      pi("5", "1")
    );
    expect(rejected.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();

    const okForm = new FormData();
    okForm.append("file", new File([new Uint8Array([1, 2, 3])], "site photo.jpg", { type: "image/jpeg" }));
    okForm.append("caption", "cracked curb");
    const accepted = await attachmentsPOST(
      new Request("http://t", { method: "POST", body: okForm }),
      pi("5", "1")
    );
    expect(accepted.status).toBe(201);
    expect(putMock).toHaveBeenCalledTimes(1);
    const key = (putMock.mock.calls[0] as unknown[])[0] as string;
    // R2 remediation: key carries a unique server-generated token segment, so
    // it is NOT the bare filename path, but keeps the readable name last.
    expect(key.startsWith("plan-room/jobs/5/tracked-items/1/")).toBe(true);
    expect(key.endsWith("/site photo.jpg")).toBe(true);
    expect(key).not.toBe("plan-room/jobs/5/tracked-items/1/site photo.jpg");
    // metadata row points at exactly the bytes we wrote
    expect(h.attachments[0].storageKey).toBe(key);
    expect(h.attachments[0].kind).toBe("photo");
    expect(h.attachments[0].caption).toBe("cracked curb");

    // tenancy: uploading to another bid's item id → 404, no blob write
    putMock.mockClear();
    const wrongForm = new FormData();
    wrongForm.append("file", new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }));
    const wrong = await attachmentsPOST(
      new Request("http://t", { method: "POST", body: wrongForm }),
      pi("6", "1")
    );
    expect(wrong.status).toBe(404);
    expect(putMock).not.toHaveBeenCalled();
  });

  test("attachment ordering: blob-write failure leaves NO metadata row (Codex blocker)", async () => {
    await createPOST(jsonReq({ kind: "FIELD_ITEM", title: "photo item" }), p("5"));
    putMock.mockRejectedValueOnce(new Error("disk full (simulated)"));

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2])], "a.jpg", { type: "image/jpeg" }));
    const res = await attachmentsPOST(
      new Request("http://t", { method: "POST", body: form }),
      pi("5", "1")
    );

    expect(res.status).toBe(500);
    expect(h.attachments.length).toBe(0); // no orphan metadata for missing bytes
    expect(deleteMock).not.toHaveBeenCalled(); // nothing to clean — blob never landed
  });

  test("attachment ordering: metadata failure after blob write cleans up the blob", async () => {
    await createPOST(jsonReq({ kind: "FIELD_ITEM", title: "photo item" }), p("5"));
    const prismaModule = await import("@/lib/prisma");
    const attachCreate = prismaModule.prisma.trackedItemAttachment
      .create as ReturnType<typeof vi.fn>;
    attachCreate.mockRejectedValueOnce(new Error("db write failed (simulated)"));

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2])], "b.jpg", { type: "image/jpeg" }));
    const res = await attachmentsPOST(
      new Request("http://t", { method: "POST", body: form }),
      pi("5", "1")
    );

    expect(res.status).toBe(500);
    expect(putMock).toHaveBeenCalledTimes(1); // blob DID land first...
    expect(deleteMock).toHaveBeenCalledTimes(1); // ...and was cleaned up
    // the cleaned-up blob is exactly the one we wrote (unique token key)
    expect((deleteMock.mock.calls[0] as unknown[])[0]).toBe(
      (putMock.mock.calls[0] as unknown[])[0]
    );
    expect(h.attachments.length).toBe(0); // and no metadata row survived
  });

  test("R2 remediation: same-named uploads never overwrite — distinct keys, both bytes preserved", async () => {
    await createTrackedItem5();

    const upload = async (bytes: number[]) => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" }));
      return attachmentsPOST(
        new Request("http://t", { method: "POST", body: form }),
        pi("5", "1")
      );
    };

    expect((await upload([1, 1, 1])).status).toBe(201);
    expect((await upload([2, 2, 2])).status).toBe(201);

    const key1 = (putMock.mock.calls[0] as unknown[])[0] as string;
    const key2 = (putMock.mock.calls[1] as unknown[])[0] as string;
    // Same sanitized name, but the two blob keys must differ — no overwrite.
    expect(key1).not.toBe(key2);
    expect(key1.endsWith("/photo.jpg")).toBe(true);
    expect(key2.endsWith("/photo.jpg")).toBe(true);
    // Two independent metadata rows, each pointing at its own object.
    expect(h.attachments.length).toBe(2);
    expect(h.attachments[0].storageKey).toBe(key1);
    expect(h.attachments[1].storageKey).toBe(key2);
    expect(h.attachments[0].storageKey).not.toBe(h.attachments[1].storageKey);
  });
});

async function createTrackedItem5() {
  await createPOST(jsonReq({ kind: "FIELD_ITEM", title: "photo item" }), p("5"));
}
