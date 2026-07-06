// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/estimates/__tests__/route.test.ts
//
//  Artifact-durability coverage: saveEstimateFile() used to write directly to
//  process.cwd()/uploads/estimates/{bidId}/{subcontractorId} — container-
//  ephemeral storage — and the route immediately re-read that absolute path
//  synchronously to parse it. It now persists through BlobStore under a
//  relative key (uploads/estimates/{bidId}/{subcontractorId}/{safe name}),
//  stores ONLY that relative key in EstimateUpload.rawFilePath, and resolves
//  it back to a real local absolute path — via the shared compat layer —
//  immediately before the synchronous parseEstimateFile() call.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type EstimateUploadRow = {
  id: number;
  bidId: number;
  subcontractorId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  rawFilePath: string;
  parseStatus: string;
  pricingData?: string;
  scopeLines?: string;
};

const db = {
  uploads: new Map<number, EstimateUploadRow>(),
  counter: 0,
};

function resetDb() {
  db.uploads.clear();
  db.counter = 0;
  blobData.clear();
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    estimateUpload: {
      upsert: vi.fn(async ({ create }: { create: Omit<EstimateUploadRow, "id">; update: unknown }) => {
        db.counter += 1;
        const row: EstimateUploadRow = { id: db.counter, ...create, pricingData: "", scopeLines: "" };
        db.uploads.set(row.id, row);
        return { ...row, subcontractor: { id: create.subcontractorId, company: "Acme Co" } };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<EstimateUploadRow> }) => {
        const row = db.uploads.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row, subcontractor: { id: row.subcontractorId, company: "Acme Co" } };
      }),
      findMany: vi.fn(async () => []),
    },
  },
}));

const parseEstimateFileMock = vi.fn(async (_filePath: string, _fileType: string) => ({ rawText: "scope text", rows: [] as unknown[] }));
vi.mock("@/lib/services/estimateParsers", () => ({
  parseEstimateFile: parseEstimateFileMock,
}));

vi.mock("@/lib/services/scopePricingSeparator", () => ({
  separateScopeAndPricing: () => ({ scopeLines: ["line 1"], pricingData: [{ amount: 100 }] }),
}));

vi.mock("@/lib/services/redaction/redactEstimate", () => ({
  redactEstimate: () => ({ sanitizedText: "[]", flaggedLines: [], redactionCount: 0 }),
  TOKEN_LABELS: ["SUB-A", "SUB-B"],
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

function uploadRequest(subcontractorId: number, filename = "estimate.pdf") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(Buffer.from("%PDF-1.4 fake"))], filename, { type: "application/pdf" }));
  form.append("subcontractorId", String(subcontractorId));
  return new Request("http://localhost/api/bids/1/estimates", { method: "POST", body: form });
}

const routeParams = { params: Promise.resolve({ id: "1" }) };

describe("POST /api/bids/[id]/estimates", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    parseEstimateFileMock.mockResolvedValue({ rawText: "scope text", rows: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("persists through BlobStore under the production-matching relative key, storing ONLY that relative key in rawFilePath", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(7, "Sub Bid #1.pdf"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(blobPutMock).toHaveBeenCalledWith("uploads/estimates/1/7/Sub Bid _1.pdf", expect.any(Buffer));

    const stored = db.uploads.get(json.id)!;
    expect(stored.rawFilePath).toBe("uploads/estimates/1/7/Sub Bid _1.pdf");
    expect(stored.rawFilePath.startsWith("/")).toBe(false);
  });

  test("resolves the relative key to a real local absolute path before calling parseEstimateFile — never hands it the bare relative key", async () => {
    const { POST } = await import("../route");
    await POST(uploadRequest(8, "bid.pdf"), routeParams);

    expect(parseEstimateFileMock).toHaveBeenCalledTimes(1);
    const [passedPath] = parseEstimateFileMock.mock.calls[0];
    expect(passedPath).toBe("/storage/uploads/estimates/1/8/bid.pdf");
    expect(passedPath).not.toBe("uploads/estimates/1/8/bid.pdf");
  });

  test("never returns pricingData in the response", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(9), routeParams);
    const json = await res.json();
    expect(json.pricingData).toBeUndefined();
  });

  test("subcontractorId missing returns 400 before any BlobStore write", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(Buffer.from("%PDF-1.4 fake"))], "x.pdf", { type: "application/pdf" }));
    const req = new Request("http://localhost/api/bids/1/estimates", { method: "POST", body: form });

    const { POST } = await import("../route");
    const res = await POST(req, routeParams);
    expect(res.status).toBe(400);
    expect(blobPutMock).not.toHaveBeenCalled();
  });
});
