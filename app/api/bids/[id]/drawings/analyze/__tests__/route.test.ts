import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline, mock-only tests for the N3 Option-A credential migration of the
// drawing-analyze route (docs/architecture/adr/0001-ai-credential-resolution.md).
//
// This route is the TS half of the `drawing_intelligence.py` bypass fix: it
// must resolve the AI credential exclusively via getSetting() (never
// process.env directly) and forward it across the network boundary to the
// sidecar as an explicit `api_key` request-body field. No real HTTP call, no
// real DB — `fetch` and `prisma` are both mocked.
//
// Also covers the storage-path-compat fix (artifact-durability work): the
// route now resolves DrawingUpload.filePath (relative BlobStore key, legacy
// cwd-rooted path, or production storage-root path — see
// lib/services/drawings/storagePath.ts) to a real local absolute path BEFORE
// calling the sidecar, and fails closed (no sidecar call at all) if it can't
// be resolved — the identical fix already applied to the Spec Book sidecar
// handoff. resolveDrawingLocalPath() is mocked; tests unrelated to resolution
// mock it as an always-succeeding passthrough.

const SENTINEL = "sk-test-sentinel-do-not-use-12345";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  resolveDrawingLocalPath: vi.fn(),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({ getSetting: h.getSetting }));
vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({ ok: true, user: { id: "u1", role: "admin" } })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    drawingUpload: {
      findFirst: h.findFirst,
      update: h.update,
    },
  },
}));
vi.mock("@/lib/services/drawings/storagePath", () => ({
  resolveDrawingLocalPath: h.resolveDrawingLocalPath,
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/bids/1/drawings/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "1" });

beforeEach(() => {
  vi.clearAllMocks();
  h.findFirst.mockResolvedValue({ id: 42, filePath: "uploads/drawings/1/drawing.pdf" });
  h.update.mockResolvedValue({});
  // Default: resolves successfully to a synthetic local absolute path —
  // tests that care about resolution failure override this per-case.
  h.resolveDrawingLocalPath.mockImplementation(async (ref: string, _bidId: number) => ({
    ok: true,
    localPath: `/storage/${ref}`,
    kind: "canonical" as const,
    canonicalKey: ref,
  }));
});

describe("POST /api/bids/[id]/drawings/analyze — N3 Option-A credential migration", () => {
  it("1. sentinel credential resolved via getSetting() traverses verbatim across the fetch boundary to the sidecar's api_key field", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projectDescription: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ tier: 1, model: "haiku" }), { params });
    expect(res.status).toBe(200);

    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.api_key).toBe(SENTINEL);

    // file_path sent to the sidecar is the RESOLVED local absolute path,
    // never the raw relative DB value.
    expect(h.resolveDrawingLocalPath).toHaveBeenCalledWith("uploads/drawings/1/drawing.pdf", 1);
    expect(sentBody.file_path).toBe("/storage/uploads/drawings/1/drawing.pdf");

    vi.unstubAllGlobals();
  });

  it("2. sentinel never leaks into the response payload, persisted analysisJson, or a thrown error's message", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projectDescription: "ok", _meta: { tier: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ tier: 1, model: "haiku" }), { params });
    const payload = await res.json();

    expect(JSON.stringify(payload)).not.toContain(SENTINEL);

    // Persisted analysisJson (what's written back to the DB) never contains it.
    const persistCall = h.update.mock.calls.find(
      (c) => c[0]?.data?.analysisJson !== undefined
    );
    expect(persistCall).toBeTruthy();
    expect(JSON.stringify(persistCall![0].data.analysisJson)).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("2b. sentinel never leaks into a thrown/returned error message on sidecar failure", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal sidecar failure",
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ tier: 1, model: "haiku" }), { params });
    const payload = await res.json();

    expect(res.status).toBe(502);
    expect(JSON.stringify(payload)).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("3. fails closed with a controlled 503 + typed message when getSetting() resolves to null — never calls fetch", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ tier: 1, model: "haiku" }), { params });
    const payload = await res.json();

    expect(res.status).toBe(503);
    expect(payload.error).toMatch(/ANTHROPIC_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("4. fails closed with a controlled 404 when the stored filePath can't be resolved to a real local file — never calls fetch", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    h.resolveDrawingLocalPath.mockResolvedValue({ ok: false, reason: "missing" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ tier: 1, model: "haiku" }), { params });
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload.error).toMatch(/unavailable.*missing/);
    expect(fetchMock).not.toHaveBeenCalled();

    // Marked as error, not left "processing".
    const errorUpdate = h.update.mock.calls.find((c) => c[0]?.data?.analysisStatus === "error");
    expect(errorUpdate).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
