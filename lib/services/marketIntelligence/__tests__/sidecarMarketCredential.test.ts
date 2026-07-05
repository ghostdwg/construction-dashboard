// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/sidecarMarketCredential.test.ts
//
//  Option-A credential migration of market.py (docs/architecture/adr/0001-ai-
//  credential-resolution.md, docs/architecture/adr/0002-remaining-sidecar-
//  credential-targets.md §4).
//
//  callSidecarScan() and callSidecarScrape() are the single TS chokepoint that
//  EVERY market.py Claude-calling trigger path funnels through:
//    * manual scan route        → callSidecarScan
//    * manual "scrape now" route → scrapeOneSource → callSidecarScrape
//    * run-due worker path       → runMarketScrape → callSidecarScrape
//    * cron municipalAgenda run  → scrapeOneSource → callSidecarScrape
//  ADR 0002 §6 (Package 4) therefore treats testing these two functions
//  directly as coverage of all three trigger paths from one file — the same
//  "single source of truth, single test surface" property scrapeOneSource's
//  header comment already claims for ingestion.
//
//  These tests prove: the credential is resolved via getSetting() ONCE per
//  call and forwarded verbatim as the request body's `api_key` field; it never
//  leaks into the response, a thrown error, or (implicitly) any persistence
//  call downstream; and a missing/empty credential fails CLOSED before any
//  sidecar fetch is attempted.
//
//  No real HTTP, no real DB — fetch, prisma, and getSetting are all mocked.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const SENTINEL = "sk-test-sentinel-do-not-use-market";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSetting: h.getSetting,
}));

// sidecarMarket.ts imports prisma (for persistSidecarPayload) — mock it so the
// module loads offline. These credential tests exercise only the two callSidecar
// functions, which never touch prisma.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketLead: { create: vi.fn() },
    marketSignal: { create: vi.fn() },
    relationshipEdge: { create: vi.fn() },
  },
}));

import { callSidecarScan, callSidecarScrape } from "../sidecarMarket";

const OK_SCAN = {
  signals_found: 0, relationships_found: 0, jurisdiction: null, document_date: null,
  signals: [], relationships: [], raw_text: null, char_count: 0,
  cost_usd: 0, input_tokens: 0, output_tokens: 0,
};
const OK_SCRAPE = {
  docs_found: 0, docs_in_range: 0, docs_scanned: 0, docs_skipped: 0,
  docs_dropped_date: 0, docs_dropped_undated: 0,
  docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
  total_chars_saved: 0, results: [], total_cost_usd: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("callSidecarScan — Option A credential forwarding (manual scan path)", () => {
  it("MANDATORY 2/4: resolves via getSetting() once and forwards the sentinel as api_key", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => OK_SCAN });
    vi.stubGlobal("fetch", fetchMock);

    const out = await callSidecarScan({ text: "council text", jurisdiction: "Ankeny" });

    expect(h.getSetting).toHaveBeenCalledTimes(1);
    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/market/scan-document");
    expect(JSON.parse(init.body as string).api_key).toBe(SENTINEL);
    // MANDATORY 3: never leaks into the response the caller receives.
    expect(JSON.stringify(out)).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("MANDATORY 5: missing credential (null) fails closed BEFORE any fetch", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(callSidecarScan({ text: "x" })).rejects.toThrow(/ANTHROPIC_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("MANDATORY 5: empty-string credential also fails closed before any fetch", async () => {
    h.getSetting.mockResolvedValue("");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(callSidecarScan({ text: "x" })).rejects.toThrow(/ANTHROPIC_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("MANDATORY 3: sentinel never appears in a thrown sidecar-error message", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => "internal boom",
    });
    vi.stubGlobal("fetch", fetchMock);

    let msg = "";
    try {
      await callSidecarScan({ text: "x" });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain("Sidecar scan failed");
    expect(msg).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });
});

describe("callSidecarScrape — Option A credential forwarding (scrape/run-due/cron paths)", () => {
  it("MANDATORY 2/4: resolves via getSetting() once and forwards the sentinel as api_key", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => OK_SCRAPE });
    vi.stubGlobal("fetch", fetchMock);

    const out = await callSidecarScrape({
      sourceId: "src_1", url: "https://x.gov", jurisdiction: "Ankeny", alreadySeen: [],
    });

    expect(h.getSetting).toHaveBeenCalledTimes(1);
    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/market/scrape-source");
    expect(JSON.parse(init.body as string).api_key).toBe(SENTINEL);
    expect(JSON.stringify(out)).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("MANDATORY 5: missing credential fails closed BEFORE any fetch (all three trigger paths inherit this)", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callSidecarScrape({ sourceId: "s", url: "u", jurisdiction: "j", alreadySeen: [] })
    ).rejects.toThrow(/ANTHROPIC_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
