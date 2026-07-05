// ──────────────────────────────────────────────────────────────────────────────
//  .../schedule-v2/generate/__tests__/route.test.ts
//
//  Offline, mock-only tests for the Option-A credential migration of the
//  schedule-intelligence generation path (docs/architecture/adr/0001-ai-
//  credential-resolution.md, docs/architecture/adr/0002-remaining-sidecar-
//  credential-targets.md — which extends the decision to
//  sidecar/services/schedule_intelligence.py specifically).
//
//  Before this migration, POST /api/bids/[id]/schedule-v2/generate called
//  the sidecar's /parse/schedule/generate with NO credential in the request
//  body at all — schedule_intelligence.py resolved ANTHROPIC_API_KEY purely
//  from its own process env, zero TS involvement. This route now resolves
//  the credential via getSetting() (DB-first, env-fallback) and forwards it
//  as an explicit `api_key` field in the sidecar request body.
//
//  Unlike the submittals/generate-ai precedent (which has an independently-
//  valid Phase 1 spec-only result already computed and saved before its
//  optional Phase 2 AI cross-reference, so a missing credential there is
//  non-fatal), this POST *is* the entire schedule-intelligence trigger —
//  there is no partial/fallback result — so a missing credential here fails
//  the whole request closed with a 503, never reaching the sidecar.
//
//  No real HTTP call, no real DB — fetch and prisma are mocked.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const SENTINEL = "sk-test-sentinel-do-not-use-schedule";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  specBookFindFirst: vi.fn(),
  drawingFindFirst: vi.fn(),
  seedScheduleV2: vi.fn(),
  getOrCreateSchedule: vi.fn(),
  loadScheduleById: vi.fn(),
  createActivityV2: vi.fn(),
  recalculateScheduleV2: vi.fn(),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSetting: h.getSetting,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: { findFirst: h.specBookFindFirst },
    drawingUpload: { findFirst: h.drawingFindFirst },
    scheduleActivityV2: { update: vi.fn() },
  },
}));

vi.mock("@/lib/services/schedule/scheduleV2Service", () => ({
  seedScheduleV2: h.seedScheduleV2,
  getOrCreateSchedule: h.getOrCreateSchedule,
  loadScheduleById: h.loadScheduleById,
  createActivityV2: h.createActivityV2,
  recalculateScheduleV2: h.recalculateScheduleV2,
}));

function routeParams(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

const SPEC_BOOK = {
  sections: [
    { csiNumber: "03 30 00", csiTitle: "Concrete", csiCanonicalTitle: "Concrete", aiExtractions: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.specBookFindFirst.mockResolvedValue(SPEC_BOOK);
  h.drawingFindFirst.mockResolvedValue(null);
});

describe("POST /api/bids/[id]/schedule-v2/generate — Option A credential migration", () => {
  it("1. sentinel credential resolved via getSetting() traverses verbatim to the sidecar request body's api_key field", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ model: "sonnet" }) }),
      routeParams(1)
    );
    const body = await res.json();

    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.api_key).toBe(SENTINEL);
    expect(body.jobId).toBe("sidecar-job-1");

    vi.unstubAllGlobals();
  });

  it("2. sentinel never leaks into the response body, a thrown error, or the 503 error message", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ model: "sonnet" }) }),
      routeParams(1)
    );
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("3. missing credential (getSetting resolves null) fails closed: never calls the sidecar, returns 503", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ model: "sonnet" }) }),
      routeParams(1)
    );
    const body = await res.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/ANTHROPIC_API_KEY not configured/);

    vi.unstubAllGlobals();
  });

  it("4. missing credential (empty string from getSetting) also fails closed with 503", async () => {
    h.getSetting.mockResolvedValue("");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ model: "sonnet" }) }),
      routeParams(1)
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(503);

    vi.unstubAllGlobals();
  });

  it("5. no analyzed spec sections — pre-existing 400 short-circuit fires before credential resolution", async () => {
    h.specBookFindFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ model: "sonnet" }) }),
      routeParams(1)
    );

    expect(res.status).toBe(400);
    expect(h.getSetting).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
