// ──────────────────────────────────────────────────────────────────────────────
//  .../submittals/generate-ai/__tests__/route.test.ts
//
//  Offline, mock-only tests for the Option-A credential migration of the
//  submittal drawing cross-reference path (docs/architecture/adr/0001-ai-
//  credential-resolution.md, docs/architecture/adr/0002-remaining-sidecar-
//  credential-targets.md — which extends the decision to
//  sidecar/services/submittal_intelligence.py specifically).
//
//  Before this migration, POST /api/bids/[id]/submittals/generate-ai's Phase 2
//  (drawing cross-reference) called the sidecar's /parse/submittals/generate
//  with NO credential in the request body at all — submittal_intelligence.py
//  resolved ANTHROPIC_API_KEY purely from its own process env, zero TS
//  involvement. This route now resolves the credential via getSetting()
//  (DB-first, env-fallback) and forwards it as an explicit `api_key` field in
//  the sidecar request body. There is no durable BackgroundJob row on this
//  path (Phase 2 only tracks a sidecar-side in-memory job, polled via a
//  jobId query param) — so the "leak surface" checked here is: the returned
//  response body, and the body sent to fetch.
//
//  No real HTTP call, no real DB — fetch and prisma are mocked.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const SENTINEL = "sk-test-sentinel-do-not-use-submittal";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  drawingFindFirst: vi.fn(),
  specBookFindFirst: vi.fn(),
  generateSubmittalsFromAiAnalysis: vi.fn(),
  seedCsiBaseline: vi.fn(),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSetting: h.getSetting,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drawingUpload: { findFirst: h.drawingFindFirst },
    specBook: { findFirst: h.specBookFindFirst },
    submittalItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/submittal/generateFromAiAnalysis", () => ({
  generateSubmittalsFromAiAnalysis: h.generateSubmittalsFromAiAnalysis,
}));

vi.mock("@/lib/services/submittal/csiBaselineSeeder", () => ({
  seedCsiBaseline: h.seedCsiBaseline,
}));

function routeParams(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

const SPEC_RESULT = { created: 3, sectionsWithExtractions: 2 };
const SPEC_BOOK = {
  sections: [{ csiNumber: "03 30 00", csiTitle: "Concrete" }],
};
const DRAWING_ANALYSIS = { projectDescription: "Medical fit-out" };

beforeEach(() => {
  vi.clearAllMocks();
  h.generateSubmittalsFromAiAnalysis.mockResolvedValue(SPEC_RESULT);
  h.drawingFindFirst.mockResolvedValue({ analysisJson: JSON.stringify(DRAWING_ANALYSIS) });
  h.specBookFindFirst.mockResolvedValue(SPEC_BOOK);
});

describe("POST /api/bids/[id]/submittals/generate-ai — Option A credential migration", () => {
  it("1. sentinel credential resolved via getSetting() traverses verbatim to the sidecar request body's api_key field", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), routeParams(1));
    const body = await res.json();

    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.api_key).toBe(SENTINEL);
    expect(body.jobId).toBe("sidecar-job-1");

    vi.unstubAllGlobals();
  });

  it("2. sentinel never leaks into the response body or a thrown/console-warned error", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), routeParams(1));
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    for (const call of warnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SENTINEL);
    }

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("3. missing credential (getSetting resolves null) fails closed: never calls the sidecar, returns jobId: null, spec-only result still returned", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), routeParams(1));
    const body = await res.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.jobId).toBeNull();
    expect(body.specResult).toEqual(SPEC_RESULT);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("4. no drawing analysis present — credential resolution and sidecar call are both skipped entirely (pre-existing short-circuit unaffected)", async () => {
    h.drawingFindFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), routeParams(1));
    const body = await res.json();

    expect(h.getSetting).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.jobId).toBeNull();

    vi.unstubAllGlobals();
  });
});
