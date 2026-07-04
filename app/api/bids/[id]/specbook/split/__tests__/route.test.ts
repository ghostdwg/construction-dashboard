// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/specbook/split/__tests__/route.test.ts
//
//  Coverage for the BlobStore migration: the sidecar split endpoint needs a
//  real filesystem path (it reads/writes PDFs with PyMuPDF), but the DB now
//  stores a relative BlobStore key. This proves the handoff derives a real
//  /storage/... path (never a stale /app/uploads path), that section
//  artifacts are recorded back as relative keys, and that a pre-migration
//  (legacy absolute path) record still works without a data migration.
// ──────────────────────────────────────────────────────────────────────────────

import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type SpecBookRow = { id: number; bidId: number; filePath: string; status: string };

const db = {
  specBook: null as SpecBookRow | null,
  trades: [{ id: 10, csiCode: "03 30 00" }] as Array<{ id: number; csiCode: string | null }>,
  bidTrades: [{ tradeId: 10 }] as Array<{ tradeId: number }>,
  createdSections: [] as Array<Record<string, unknown>>,
  deleteManyCalls: 0,
};

function resetDb() {
  db.specBook = null;
  db.createdSections = [];
  db.deleteManyCalls = 0;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: {
      findFirst: vi.fn(async () => db.specBook),
    },
    trade: {
      findMany: vi.fn(async () => db.trades),
    },
    bidTrade: {
      findMany: vi.fn(async () => db.bidTrades),
    },
    specSection: {
      deleteMany: vi.fn(async () => {
        db.deleteManyCalls += 1;
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        db.createdSections.push(...data);
        return { count: data.length };
      }),
    },
  },
}));

vi.mock("@/lib/services/csi/canonicalTitle", () => ({
  lookupCanonicalTitles: vi.fn(async () => new Map<string, string>()),
}));

const blobExistsMock = vi.fn(async (_key: string) => true);
const localPathForKeyMock = vi.fn((key: string) => `/storage/${key}`);
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ exists: blobExistsMock }),
  localPathForKey: localPathForKeyMock,
}));

const fsAccessMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { access: fsAccessMock },
  access: fsAccessMock,
}));

const routeParams = { params: Promise.resolve({ id: "7" }) };

function sidecarSplitResponse(overrides: Partial<{ pdf_path: string; filename: string }> = {}) {
  return {
    sections: [
      {
        csi: "03 30 00",
        title: "CAST-IN-PLACE CONCRETE",
        pdf_path: overrides.pdf_path ?? "/storage/plan-room/jobs/7/spec/sections/03_30_00_cast_in_place_concrete.pdf",
        filename: overrides.filename ?? "03_30_00_cast_in_place_concrete.pdf",
        page_start: 1,
        page_end: 3,
        page_count: 3,
        text: "concrete section text",
      },
    ],
    section_count: 1,
  };
}

describe("POST /api/bids/[id]/specbook/split", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    blobExistsMock.mockResolvedValue(true);
    fsAccessMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("derives a real /storage path for the sidecar handoff, never /app/uploads", async () => {
    db.specBook = { id: 7, bidId: 7, filePath: "plan-room/jobs/7/spec/original.pdf", status: "ready" };

    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify(sidecarSplitResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/api/bids/7/specbook/split", { method: "POST" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    expect(capturedBody.pdf_path).toBe("/storage/plan-room/jobs/7/spec/original.pdf");
    expect(capturedBody.output_dir).toBe("/storage/plan-room/jobs/7/spec/sections");
    expect(capturedBody.pdf_path).not.toMatch(/\/app\/uploads/);
    expect(capturedBody.output_dir).not.toMatch(/\/app\/uploads/);

    // Section artifact recorded as a relative BlobStore key — never the
    // sidecar's own absolute pdf_path.
    expect(db.createdSections).toHaveLength(1);
    expect(db.createdSections[0].pdfPath).toBe(
      "plan-room/jobs/7/spec/sections/03_30_00_cast_in_place_concrete.pdf"
    );
    expect(db.createdSections[0].pdfPath).not.toMatch(/^\//);
  });

  test("legacy absolute source path is used as-is; new sections still land under the BlobStore prefix", async () => {
    const legacyPath = path.join(process.cwd(), "uploads", "specbooks", "7", "book.pdf");
    db.specBook = { id: 7, bidId: 7, filePath: legacyPath, status: "ready" };

    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify(sidecarSplitResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/api/bids/7/specbook/split", { method: "POST" }), routeParams);

    expect(res.status).toBe(200);
    expect(fsAccessMock).toHaveBeenCalledWith(legacyPath);
    expect(capturedBody.pdf_path).toBe(legacyPath);
    expect(capturedBody.output_dir).toBe("/storage/plan-room/jobs/7/spec/sections");
    // BlobStore.exists must not be consulted for a legacy path.
    expect(blobExistsMock).not.toHaveBeenCalled();
  });

  test("404s without calling the sidecar when the source blob is missing", async () => {
    db.specBook = { id: 7, bidId: 7, filePath: "plan-room/jobs/7/spec/original.pdf", status: "ready" };
    blobExistsMock.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/api/bids/7/specbook/split", { method: "POST" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.createdSections).toHaveLength(0);
  });

  test("sidecar failure returns the existing 422 error shape, no sections persisted", async () => {
    db.specBook = { id: 7, bidId: 7, filePath: "plan-room/jobs/7/spec/original.pdf", status: "ready" };
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("fetch failed");
    }));

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/api/bids/7/specbook/split", { method: "POST" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toMatch(/sidecar unavailable/i);
    expect(db.createdSections).toHaveLength(0);
  });
});
