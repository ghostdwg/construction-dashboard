// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/addendums/upload/__tests__/route.test.ts
//
//  Artifact-durability coverage: the route used to write directly to
//  process.cwd()/uploads/addendums/{bidId}/{file.name} — container-ephemeral
//  storage, with no filePath/storageKey column at all. It now persists
//  through BlobStore under a relative key (uploads/addendums/{bidId}/{safe
//  name}), and the new nullable AddendumUpload.storageKey column stores ONLY
//  that relative key.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AddendumRow = {
  id: number;
  bidId: number;
  addendumNumber: number;
  addendumDate: Date | null;
  fileName: string;
  storageKey: string | null;
  status: string;
  extractedText?: string;
};

const db = {
  bidExists: true,
  authStatus: 200,
  rows: new Map<number, AddendumRow>(),
  counter: 0,
  briefUpdateManyArgs: null as unknown,
  transactionFailure: false,
};

function resetDb() {
  db.bidExists = true;
  db.authStatus = 200;
  db.rows.clear();
  db.counter = 0;
  db.briefUpdateManyArgs = null;
  db.transactionFailure = false;
  blobData.clear();
}

vi.mock("@/lib/prisma", () => {
  const client = {
    bid: {
      findUnique: vi.fn(async () => (db.bidExists ? { id: 1 } : null)),
    },
    addendumUpload: {
      findMany: vi.fn(async () =>
        Array.from(db.rows.values()).map(({ bidId, storageKey }) => ({ bidId, storageKey })),
      ),
      create: vi.fn(async ({ data }: { data: Omit<AddendumRow, "id"> }) => {
        db.counter += 1;
        const row: AddendumRow = { id: db.counter, ...data };
        db.rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<AddendumRow> }) => {
        const row = db.rows.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { bidId: number; addendumNumber: number; id: { not: number } } }) => {
        let count = 0;
        for (const [rowId, row] of db.rows) {
          if (row.bidId === where.bidId && row.addendumNumber === where.addendumNumber && rowId !== where.id.not) {
            db.rows.delete(rowId);
            count += 1;
          }
        }
        return { count };
      }),
    },
    bidIntelligenceBrief: {
      updateMany: vi.fn(async (args: unknown) => {
        db.briefUpdateManyArgs = args;
        return { count: 0 };
      }),
    },
  };
  return {
    prisma: {
      ...client,
      $transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => {
        if (db.transactionFailure) throw new Error("synthetic database failure");
        return callback(client);
      }),
    },
  };
});

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => {
    if (db.authStatus === 401) {
      return { ok: false, response: Response.json({ error: "Authentication required" }, { status: 401 }) };
    }
    if (db.authStatus === 403) {
      return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return db.bidExists
      ? { ok: true, user: { id: "u1", role: "admin" } }
      : { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) };
  }),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "Addendum text" }] }),
      }),
    }),
  }),
}));

// ── BlobStore mock — in-memory, so upload persistence is fully hermetic ────

const blobData = new Map<string, Buffer>();
const blobPutMock = vi.fn(async (key: string, data: Buffer) => {
  blobData.set(key, data);
  return { size: data.length, sha256: "fake-sha", storedAt: "2026-01-01T00:00:00.000Z" };
});
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    put: blobPutMock,
    get: vi.fn(async () => Buffer.from("")),
    exists: vi.fn(async (key: string) => blobData.has(key)),
    delete: vi.fn(async (key: string) => blobData.delete(key)),
    stat: vi.fn(async () => null),
  }),
  localPathForKey: vi.fn((key: string) => `/storage/${key}`),
  safeBlobFileName: (fileName: string) => {
    const base = fileName.split("/").pop()!.trim();
    return base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
  },
}));

function uploadRequest(addendumNumber: number, filename = "addendum.pdf") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(Buffer.from("%PDF-1.4 fake"))], filename, { type: "application/pdf" }));
  form.append("addendumNumber", String(addendumNumber));
  return new Request("http://localhost/api/bids/1/addendums/upload", { method: "POST", body: form });
}

const routeParams = { params: Promise.resolve({ id: "1" }) };

describe("POST /api/bids/[id]/addendums/upload", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("anonymous upload is rejected before form parsing, PDF parsing, or BlobStore write", async () => {
    db.authStatus = 401;
    const request = uploadRequest(1);
    const formDataSpy = vi.spyOn(request, "formData");

    const { POST } = await import("../route");
    const res = await POST(request, routeParams);

    expect(res.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.rows.size).toBe(0);
  });

  test("persists through BlobStore under the production-matching relative key, storing ONLY that relative key in storageKey", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(1, "Addendum #2.pdf"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(blobPutMock).toHaveBeenCalledWith(
      expect.stringMatching(/^plan-room\/jobs\/1\/addenda\/[0-9a-f-]{36}\/Addendum _2\.pdf$/),
      expect.any(Buffer),
      { contentType: "application/pdf" },
    );

    const stored = db.rows.get(json.id)!;
    expect(stored.storageKey).toMatch(/^plan-room\/jobs\/1\/addenda\/[0-9a-f-]{36}\/Addendum _2\.pdf$/);
    expect(stored.storageKey!.startsWith("/")).toBe(false);
  });

  test("marks the bid's brief stale after a successful upload", async () => {
    const { POST } = await import("../route");
    await POST(uploadRequest(2), routeParams);
    expect(db.briefUpdateManyArgs).toEqual({ where: { bidId: 1 }, data: { isStale: true } });
  });

  test("same-number upload replaces atomically with a collision-safe key", async () => {
    const { POST } = await import("../route");
    const first = await POST(uploadRequest(2, "same.pdf"), routeParams);
    const firstId = (await first.json()).id as number;
    const firstKey = db.rows.get(firstId)!.storageKey!;
    const second = await POST(uploadRequest(2, "same.pdf"), routeParams);
    const secondId = (await second.json()).id as number;
    const secondKey = db.rows.get(secondId)!.storageKey!;

    expect(second.status).toBe(201);
    expect(secondKey).not.toBe(firstKey);
    expect(db.rows.has(firstId)).toBe(false);
    expect(blobData.has(firstKey)).toBe(false);
  });

  test("database failure preserves the prior record and cleans the new orphan", async () => {
    const oldKey = "uploads/addendums/1/prior.pdf";
    db.counter = 1;
    db.rows.set(1, {
      id: 1,
      bidId: 1,
      addendumNumber: 3,
      addendumDate: null,
      fileName: "prior.pdf",
      storageKey: oldKey,
      status: "ready",
    });
    blobData.set(oldKey, Buffer.from("prior"));
    db.transactionFailure = true;

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(3, "new.pdf"), routeParams);

    expect(res.status).toBe(500);
    expect(db.rows.get(1)?.storageKey).toBe(oldKey);
    expect(blobData.get(oldKey)?.toString()).toBe("prior");
    expect(blobData.size).toBe(1);
  });

  test("replacement preserves a blob referenced by a different addendum record", async () => {
    const sharedKey = "uploads/addendums/1/shared.pdf";
    db.counter = 2;
    db.rows.set(1, {
      id: 1, bidId: 1, addendumNumber: 4, addendumDate: null, fileName: "shared.pdf", storageKey: sharedKey, status: "ready",
    });
    db.rows.set(2, {
      id: 2, bidId: 1, addendumNumber: 5, addendumDate: null, fileName: "shared.pdf", storageKey: sharedKey, status: "ready",
    });
    blobData.set(sharedKey, Buffer.from("shared"));

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(4, "replacement.pdf"), routeParams);

    expect(res.status).toBe(201);
    expect(db.rows.get(2)?.storageKey).toBe(sharedKey);
    expect(blobData.get(sharedKey)?.toString()).toBe("shared");
  });

  test("bid not found returns 404 before any BlobStore write", async () => {
    db.bidExists = false;
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(3), routeParams);
    expect(res.status).toBe(404);
    expect(blobPutMock).not.toHaveBeenCalled();
  });
});
