// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/verifyMarketSource.test.ts
//  Phase O2.2 PR5 — MarketSource verifier tests.
//
//  Pure-function tests for the stack detector + recommendation engine, plus
//  end-to-end verifyMarketSource() exercised against a mocked fetch.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  detectStack,
  countCandidateLinks,
  decideRecommendation,
  verifyMarketSource,
  VERIFY_VERSION,
} from "../verifyMarketSource";

describe("detectStack (pure)", () => {
  test("CivicPlus AgendaCenter by URL pattern", () => {
    expect(detectStack("https://www.ankenyiowa.gov/AgendaCenter", null)).toBe("CIVICPLUS_AGENDA_CENTER");
    expect(detectStack("https://www.dsm.city/AgendaCenter/Planning-Commission-1", null)).toBe("CIVICPLUS_AGENDA_CENTER");
  });

  test("CivicPlus AgendaCenter by body marker (when URL does not include /AgendaCenter)", () => {
    expect(detectStack("https://www.example.com/government", "<html>... AgendaCenter widget ...</html>")).toBe("CIVICPLUS_AGENDA_CENTER");
    expect(detectStack("https://www.example.com/", "<body>powered by civicplus</body>")).toBe("CIVICPLUS_AGENDA_CENTER");
  });

  test("CivicClerk by URL or body", () => {
    expect(detectStack("https://example.civicclerk.com/", null)).toBe("CIVICCLERK");
    expect(detectStack("https://example.com/", "<script>window.CIVIC_CLERK = {}</script>")).toBe("CIVICCLERK");
  });

  test("Granicus", () => {
    expect(detectStack("https://city.granicus.com/", null)).toBe("GRANICUS");
    expect(detectStack("https://example.com/", "<a href='/MediaViewerUrl/123'></a>")).toBe("GRANICUS");
  });

  test("Generic HTML when body has <html but no stack markers", () => {
    expect(detectStack("https://random.example.com/", "<!DOCTYPE html><html><body>nothing useful</body></html>")).toBe("GENERIC_HTML");
  });

  test("UNKNOWN_STACK when there's nothing to go on", () => {
    expect(detectStack("https://random.example.com/", null)).toBe("UNKNOWN_STACK");
    expect(detectStack("https://random.example.com/", "")).toBe("UNKNOWN_STACK");
    expect(detectStack("https://random.example.com/", "plain text response")).toBe("UNKNOWN_STACK");
  });
});

describe("countCandidateLinks (pure)", () => {
  test("counts .pdf hrefs", () => {
    const body = `<a href="/x/agenda-1.pdf">A</a><a href="/x/agenda-2.pdf?v=1">B</a>`;
    expect(countCandidateLinks(body)).toBe(2);
  });

  test("counts AgendaCenter/ViewFile/N patterns", () => {
    const body = `<a href="/AgendaCenter/ViewFile/12345">A</a><a href="/AgendaCenter/ViewFile/9">B</a>`;
    expect(countCandidateLinks(body)).toBe(2);
  });

  test("counts .doc and .docx hrefs", () => {
    const body = `<a href="x.doc">A</a><a href="y.docx">B</a><a href="z.docx?v=2">C</a>`;
    expect(countCandidateLinks(body)).toBe(3);
  });

  test("returns 0 on null or empty body", () => {
    expect(countCandidateLinks(null)).toBe(0);
    expect(countCandidateLinks("")).toBe(0);
  });

  test("ignores non-link text mentions of .pdf", () => {
    // "see the .pdf" without href should NOT count.
    const body = `<p>The agenda is a .pdf document attached separately.</p>`;
    expect(countCandidateLinks(body)).toBe(0);
  });
});

describe("decideRecommendation (pure)", () => {
  test("unreachable → remove", () => {
    const d = decideRecommendation({ reachable: false, status: null, contentType: null, detectedStack: "UNKNOWN_STACK", candidateLinkCount: 0 });
    expect(d.recommendation).toBe("remove");
    expect(d.reason).toMatch(/not reachable/i);
  });

  test("4xx → remove", () => {
    const d = decideRecommendation({ reachable: true, status: 404, contentType: "text/html", detectedStack: "UNKNOWN_STACK", candidateLinkCount: 0 });
    expect(d.recommendation).toBe("remove");
  });

  test("5xx → remove", () => {
    const d = decideRecommendation({ reachable: true, status: 503, contentType: "text/html", detectedStack: "UNKNOWN_STACK", candidateLinkCount: 0 });
    expect(d.recommendation).toBe("remove");
  });

  test("PDF content-type (wrong) → investigate", () => {
    const d = decideRecommendation({ reachable: true, status: 200, contentType: "application/pdf", detectedStack: "UNKNOWN_STACK", candidateLinkCount: 0 });
    expect(d.recommendation).toBe("investigate");
  });

  test("CivicPlus + links → activate", () => {
    const d = decideRecommendation({ reachable: true, status: 200, contentType: "text/html", detectedStack: "CIVICPLUS_AGENDA_CENTER", candidateLinkCount: 12 });
    expect(d.recommendation).toBe("activate");
    expect(d.reason).toMatch(/CIVICPLUS_AGENDA_CENTER/);
  });

  test("unknown stack but many candidate links → investigate (might still be valid)", () => {
    const d = decideRecommendation({ reachable: true, status: 200, contentType: "text/html", detectedStack: "GENERIC_HTML", candidateLinkCount: 8 });
    expect(d.recommendation).toBe("investigate");
  });

  test("unknown stack + few links → investigate", () => {
    const d = decideRecommendation({ reachable: true, status: 200, contentType: "text/html", detectedStack: "UNKNOWN_STACK", candidateLinkCount: 0 });
    expect(d.recommendation).toBe("investigate");
  });
});

describe("verifyMarketSource (end-to-end with mocked fetch)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("successful CivicPlus AgendaCenter → activate", async () => {
    const fakeFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(`<html>CivicPlus AgendaCenter <a href="/AgendaCenter/ViewFile/1">x</a></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }) as unknown as Response;
    });
    const r = await verifyMarketSource(
      { sourceId: "s1", name: "Ankeny P&Z", url: "https://www.ankenyiowa.gov/AgendaCenter" },
      { fetchImpl: fakeFetch as unknown as typeof fetch },
    );
    expect(r.reachable).toBe(true);
    expect(r.status).toBe(200);
    expect(r.detectedStack).toBe("CIVICPLUS_AGENDA_CENTER");
    expect(r.candidateLinkCount).toBeGreaterThanOrEqual(1);
    expect(r.recommendation).toBe("activate");
    expect(r.verifyVersion).toBe(VERIFY_VERSION);
  });

  test("404 → remove", async () => {
    const fakeFetch = vi.fn(async () => new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/html" },
    }) as unknown as Response);
    const r = await verifyMarketSource(
      { sourceId: "s2", name: "Dead Source", url: "https://example.invalid/" },
      { fetchImpl: fakeFetch as unknown as typeof fetch },
    );
    expect(r.reachable).toBe(true);
    expect(r.status).toBe(404);
    expect(r.recommendation).toBe("remove");
  });

  test("network error → remove + errorMessage captured", async () => {
    const fakeFetch = vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    const r = await verifyMarketSource(
      { sourceId: "s3", name: "Dead DNS", url: "https://does-not-resolve.invalid/" },
      { fetchImpl: fakeFetch as unknown as typeof fetch },
    );
    expect(r.reachable).toBe(false);
    expect(r.recommendation).toBe("remove");
    expect(r.errorMessage).toContain("ENOTFOUND");
  });

  test("generic HTML with many links → investigate", async () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="/agenda-${i}.pdf">x</a>`).join("");
    const fakeFetch = vi.fn(async () => new Response(
      `<!DOCTYPE html><html><body>random city page ${links}</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    ) as unknown as Response);
    const r = await verifyMarketSource(
      { sourceId: "s4", name: "Custom CMS", url: "https://www.example.com/government/meetings" },
      { fetchImpl: fakeFetch as unknown as typeof fetch },
    );
    expect(r.detectedStack).toBe("GENERIC_HTML");
    expect(r.recommendation).toBe("investigate");
    expect(r.candidateLinkCount).toBe(8);
  });
});
