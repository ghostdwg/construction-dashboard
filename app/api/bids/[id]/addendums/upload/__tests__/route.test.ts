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
  rows: new Map<number, AddendumRow>(),
  counter: 0,
  briefUpdateManyArgs: null as unknown,
};

function resetDb() {
  db.bidExists = true;
  db.rows.clear();
  db.counter = 0;
  db.briefUpdateManyArgs = null;
  blobData.clear();
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: {
      findUnique: vi.fn(async () => (db.bidExists ? { id: 1 } : null)),
    },
    addendumUpload: {
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
    },
    bidIntelligenceBrief: {
      updateMany: vi.fn(async (args: unknown) => {
        db.briefUpdateManyArgs = args;
        return { count: 0 };
      }),
    },
  },
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

  test("persists through BlobStore under the production-matching relative key, storing ONLY that relative key in storageKey", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(1, "Addendum #2.pdf"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(blobPutMock).toHaveBeenCalledWith("uploads/addendums/1/Addendum _2.pdf", expect.any(Buffer));

    const stored = db.rows.get(json.id)!;
    expect(stored.storageKey).toBe("uploads/addendums/1/Addendum _2.pdf");
    expect(stored.storageKey!.startsWith("/")).toBe(false);
  });

  test("marks the bid's brief stale after a successful upload", async () => {
    const { POST } = await import("../route");
    await POST(uploadRequest(2), routeParams);
    expect(db.briefUpdateManyArgs).toEqual({ where: { bidId: 1 }, data: { isStale: true } });
  });

  test("bid not found returns 404 before any BlobStore write", async () => {
    db.bidExists = false;
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(3), routeParams);
    expect(res.status).toBe(404);
    expect(blobPutMock).not.toHaveBeenCalled();
  });
});
