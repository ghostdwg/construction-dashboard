// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/drawings/upload/__tests__/route.test.ts
//
//  Artifact-durability coverage: the drawings upload route used to write
//  directly to path.join(process.cwd(), "uploads", "drawings", bidId) via
//  fs.mkdir/fs.writeFile — container-ephemeral storage. It now persists
//  through getBlobStore().put() under a relative key matching production's
//  namespace convention (uploads/drawings/{bidId}/{safe file name}), and
//  DrawingUpload.filePath stores ONLY that relative key — never an absolute
//  path, never a raw filesystem write.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type DrawingUploadRow = {
  id: number;
  bidId: number;
  fileName: string;
  filePath: string;
  status: string;
  discipline: string;
};

const db = {
  bidExists: true,
  uploads: new Map<number, DrawingUploadRow>(),
  uploadCounter: 0,
  sheets: [] as unknown[],
  deletedWhere: null as unknown,
  transactionFailure: false,
};

function resetDb() {
  db.bidExists = true;
  db.uploads.clear();
  db.uploadCounter = 0;
  db.sheets = [];
  db.deletedWhere = null;
  db.transactionFailure = false;
  blobData.clear();
}

vi.mock("@/lib/prisma", () => {
  const client = {
    // Q03.2b: the route consults the persisted Admin automation setting;
    // no row = default OFF, which is what these storage-mechanics tests want
    // (automation side effects are separately covered in storageSmoke.test.ts).
    appSetting: { findUnique: vi.fn(async () => null) },
    bid: {
      findUnique: vi.fn(async () => (db.bidExists ? { id: 1 } : null)),
    },
    trade: {
      findMany: vi.fn(async () => [{ id: 10, name: "Electrical" }]),
    },
    bidTrade: {
      findMany: vi.fn(async () => [{ tradeId: 10 }]),
    },
    drawingUpload: {
      findMany: vi.fn(async () =>
        Array.from(db.uploads.values()).map(({ bidId, filePath }) => ({ bidId, filePath })),
      ),
      deleteMany: vi.fn(async (args: unknown) => {
        db.deletedWhere = args;
        const where = (args as {
          where: { bidId: number; id?: { not: number }; discipline?: { in: string[] } };
        }).where;
        let count = 0;
        for (const [rowId, row] of db.uploads) {
          if (row.bidId !== where.bidId || rowId === where.id?.not) continue;
          if (where.discipline && !where.discipline.in.includes(row.discipline)) continue;
          db.uploads.delete(rowId);
          count += 1;
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: { data: Omit<DrawingUploadRow, "id"> }) => {
        db.uploadCounter += 1;
        const row: DrawingUploadRow = { id: db.uploadCounter, ...data };
        db.uploads.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<DrawingUploadRow> }) => {
        const row = db.uploads.get(where.id);
        if (!row) throw new Error("DrawingUpload not found");
        Object.assign(row, data);
        return row;
      }),
    },
    drawingSheet: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        db.sheets.push(...data);
        return { count: data.length };
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
  requireBidAccess: vi.fn(async () =>
    db.bidExists
      ? { ok: true, user: { id: "u1", role: "admin" } }
      : { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) },
  ),
}));

const generateBidIntelligenceMock = vi.fn(async () => ({ findingCount: 0, coverage: 0 }));
vi.mock("@/app/api/bids/[id]/intelligence/generate/route", () => ({
  generateBidIntelligence: generateBidIntelligenceMock,
}));

const triggerBriefRefreshMock = vi.fn(async () => undefined);
vi.mock("@/lib/services/jobs/briefRefreshAutomation", () => ({
  triggerBriefRefresh: triggerBriefRefreshMock,
}));

// pdfjs-dist mocked outright — this route's storage behavior is what's under
// test here, not sheet-number text extraction (covered by drawingParser's
// own unit tests).
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "E-101 Electrical Plan" }] }),
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

function uploadRequest(buffer: Buffer, filename = "drawing.pdf", discipline?: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], filename, { type: "application/pdf" }));
  const qs = discipline ? `?discipline=${discipline}` : "";
  return new Request(`http://localhost/api/bids/1/drawings/upload${qs}`, { method: "POST", body: form });
}

const routeParams = { params: Promise.resolve({ id: "1" }) };

describe("POST /api/bids/[id]/drawings/upload", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("persists the original PDF through BlobStore under the production-matching relative key, storing ONLY that relative key in filePath", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake"), "Bid Set #1.pdf"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(blobPutMock).toHaveBeenCalledWith(
      expect.stringMatching(/^plan-room\/jobs\/1\/drawings\/[0-9a-f-]{36}\/Bid Set _1\.pdf$/),
      expect.any(Buffer),
      { contentType: "application/pdf" },
    );

    const stored = db.uploads.get(json.id)!;
    expect(stored.filePath).toMatch(/^plan-room\/jobs\/1\/drawings\/[0-9a-f-]{36}\/Bid Set _1\.pdf$/);
    // Never an absolute path.
    expect(stored.filePath.startsWith("/")).toBe(false);
  });

  test("re-uploading a FULLSET replaces prior uploads and still writes only a relative key", async () => {
    const { POST } = await import("../route");
    await POST(uploadRequest(Buffer.from("%PDF-1.4 fake"), "first.pdf"), routeParams);
    const res2 = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake"), "second.pdf"), routeParams);
    const json2 = await res2.json();

    expect(res2.status).toBe(201);
    const stored = db.uploads.get(json2.id)!;
    expect(stored.filePath).toMatch(/^plan-room\/jobs\/1\/drawings\/[0-9a-f-]{36}\/second\.pdf$/);
  });

  test("same-name retries allocate different keys", async () => {
    const { POST } = await import("../route");
    await POST(uploadRequest(Buffer.from("%PDF-1.4 one"), "same.pdf"), routeParams);
    await POST(uploadRequest(Buffer.from("%PDF-1.4 two"), "same.pdf"), routeParams);
    const keys = blobPutMock.mock.calls.map(([key]) => key as string);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test("database failure preserves the prior record and removes only the new orphan", async () => {
    const oldKey = "uploads/drawings/1/prior.pdf";
    db.uploadCounter = 1;
    db.uploads.set(1, {
      id: 1,
      bidId: 1,
      fileName: "prior.pdf",
      filePath: oldKey,
      status: "ready",
      discipline: "FULLSET",
    });
    blobData.set(oldKey, Buffer.from("prior"));
    db.transactionFailure = true;

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 new"), "new.pdf"), routeParams);

    expect(res.status).toBe(500);
    expect(db.uploads.get(1)?.filePath).toBe(oldKey);
    expect(blobData.get(oldKey)?.toString()).toBe("prior");
    expect(blobData.size).toBe(1);
  });

  test("replacement never deletes an old blob still referenced by another drawing row", async () => {
    const sharedKey = "uploads/drawings/1/shared.pdf";
    db.uploadCounter = 2;
    db.uploads.set(1, {
      id: 1, bidId: 1, fileName: "shared.pdf", filePath: sharedKey, status: "ready", discipline: "FULLSET",
    });
    db.uploads.set(2, {
      id: 2, bidId: 1, fileName: "shared.pdf", filePath: sharedKey, status: "ready", discipline: "ELEC",
    });
    blobData.set(sharedKey, Buffer.from("shared"));

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(Buffer.from("%PDF-1.4 replacement"), "replacement.pdf", "ARCH"),
      routeParams,
    );

    expect(res.status).toBe(201);
    expect(db.uploads.get(2)?.filePath).toBe(sharedKey);
    expect(blobData.get(sharedKey)?.toString()).toBe("shared");
  });

  test("bid not found returns 404 before any BlobStore write", async () => {
    db.bidExists = false;
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake")), routeParams);
    expect(res.status).toBe(404);
    expect(blobPutMock).not.toHaveBeenCalled();
  });
});
