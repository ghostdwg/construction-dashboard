// ──────────────────────────────────────────────────────────────────────────────
//  .../market-intelligence/docs/[id]/analyze/__tests__/route.test.ts
//
//  Option-A credential migration of market.py's /market/analyze-text endpoint
//  (docs/architecture/adr/0001-ai-credential-resolution.md, docs/architecture/
//  adr/0002-remaining-sidecar-credential-targets.md §4). This route is the one
//  market caller that talks to the sidecar directly rather than through
//  sidecarMarket.ts, so it resolves getSetting("ANTHROPIC_API_KEY") itself —
//  but ONLY on the "claude" engine branch. The "ollama" branch runs local
//  inference and must keep working with no Anthropic credential at all.
//
//  No real HTTP, no real DB — fetch, prisma, and getSetting are mocked.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const SENTINEL = "sk-test-sentinel-do-not-use-market";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  docFindUnique: vi.fn(),
  analysisCreate: vi.fn(),
  analysisUpdate: vi.fn(),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSetting: h.getSetting,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSourceDoc: { findUnique: h.docFindUnique },
    marketDocAnalysis: { create: h.analysisCreate, update: h.analysisUpdate },
  },
}));

import { POST } from "../route";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

const DOC = { id: "doc_1", rawText: "council minutes body", jurisdiction: "Ankeny", documentDate: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.docFindUnique.mockResolvedValue(DOC);
  h.analysisCreate.mockResolvedValue({ id: "an_1" });
  h.analysisUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "an_1", ...args.data }));
});

describe("POST /api/market-intelligence/docs/[id]/analyze — Option A", () => {
  it("claude branch: resolves getSetting() and forwards sentinel as api_key; never leaks into response", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engine: "claude", model: "claude-sonnet-4-6", duration_ms: 10, cost_usd: 0,
        signals_count: 0, leads_count: 0, raw_response: {},
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ engine: "claude" }), params("doc_1"));
    const body = await res.json();

    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/market/analyze-text");
    expect(JSON.parse(init.body as string).api_key).toBe(SENTINEL);
    expect(JSON.stringify(body)).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("claude branch, missing credential: fails closed 503 before creating the analysis row or calling fetch", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ engine: "claude" }), params("doc_1"));

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.analysisCreate).not.toHaveBeenCalled(); // no dangling "running" row
    const body = await res.json();
    expect(body.error).toMatch(/ANTHROPIC_API_KEY not configured/);

    vi.unstubAllGlobals();
  });

  it("ollama branch: never resolves getSetting and works with no Anthropic credential", async () => {
    h.getSetting.mockResolvedValue(null); // even if unset, ollama must proceed
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engine: "ollama", model: "qwen2.5:14b", duration_ms: 5, cost_usd: 0,
        signals_count: 0, leads_count: 0, raw_response: {},
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ engine: "ollama" }), params("doc_1"));

    expect(res.status).toBe(200);
    expect(h.getSetting).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // ollama payload carries an empty api_key (sidecar default; never used).
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).api_key).toBe("");

    vi.unstubAllGlobals();
  });
});
