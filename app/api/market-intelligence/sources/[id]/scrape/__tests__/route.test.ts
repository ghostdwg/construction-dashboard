// ──────────────────────────────────────────────────────────────────────────────
//  app/api/market-intelligence/sources/[id]/scrape/__tests__/route.test.ts
//  O2.2 PR1 — Verify the HTTP route delegates to scrapeOneSource and maps
//  ScrapeOneSourceError kinds to the right HTTP status codes.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const { scrapeOneSource, ScrapeOneSourceError } = vi.hoisted(() => {
  class ScrapeOneSourceError extends Error {
    constructor(public readonly kind: "not_found" | "inactive" | "upstream" | "internal", message: string) {
      super(message);
      this.name = "ScrapeOneSourceError";
    }
  }
  return { scrapeOneSource: vi.fn(), ScrapeOneSourceError };
});

vi.mock("@/lib/services/marketIntelligence/scrapeOneSource", () => ({
  scrapeOneSource,
  ScrapeOneSourceError,
}));

import { POST } from "../route";

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function emptyBodyRequest(): Request {
  return new Request("http://localhost/api/market-intelligence/sources/src_1/scrape", { method: "POST" });
}

function jsonBodyRequest(body: unknown): Request {
  const payload = JSON.stringify(body);
  return new Request("http://localhost/api/market-intelligence/sources/src_1/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The route gates body parsing on content-length (preserved behavior
      // from before the O2.2 PR1 refactor). Request() doesn't auto-set it
      // in Node, so the test must.
      "content-length": String(Buffer.byteLength(payload, "utf-8")),
    },
    body: payload,
  });
}

beforeEach(() => {
  scrapeOneSource.mockReset();
});

describe("POST /api/market-intelligence/sources/[id]/scrape", () => {
  test("delegates to scrapeOneSource and returns its result with ingestion summary appended", async () => {
    scrapeOneSource.mockResolvedValue({
      engine: "sidecar",
      sourceId: "src_1",
      docsFound: 2, docsInRange: 2, docsScanned: 2, docsSkipped: 0,
      docsDroppedDate: 0, docsDroppedUndated: 0,
      docsPrefilterApplied: 0, docsPrefilterSkipped: 0, docsPrefilterFailed: 0,
      totalCharsSaved: 0,
      signalsCreated: 3, leadsCreated: 1, relationshipsCreated: 0,
      signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
      totalCostUsd: 0.12,
      ingestion: {
        ingested: 4,
        bySourceKind: { MARKET_SIGNAL: 3, MARKET_LEAD: 1, RELATIONSHIP_EDGE: 0 },
        decisions: { create_new: 4 },
        failed: 0,
        failures: [],
      },
    });

    const res = await POST(emptyBodyRequest(), paramsFor("src_1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(scrapeOneSource).toHaveBeenCalledTimes(1);
    expect(scrapeOneSource).toHaveBeenCalledWith("src_1", {});

    expect(body.engine).toBe("sidecar");
    expect(body.signalsCreated).toBe(3);
    expect(body.ingestion.ingested).toBe(4);
    expect(body.ingestion.bySourceKind.MARKET_SIGNAL).toBe(3);
  });

  test("forwards request body overrides as the second arg", async () => {
    scrapeOneSource.mockResolvedValue({
      engine: "sidecar", sourceId: "src_1",
      docsFound: 0, docsInRange: 0, docsScanned: 0, docsSkipped: 0,
      docsDroppedDate: 0, docsDroppedUndated: 0,
      signalsCreated: 0, leadsCreated: 0, relationshipsCreated: 0,
      signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
      totalCostUsd: 0,
      ingestion: { ingested: 0, bySourceKind: { MARKET_SIGNAL: 0, MARKET_LEAD: 0, RELATIONSHIP_EDGE: 0 }, decisions: {}, failed: 0, failures: [] },
    });

    const override = { maxDocs: 3, prefilterMode: "always" as const, dateFrom: "2026-01-01" };
    await POST(jsonBodyRequest(override), paramsFor("src_1"));

    expect(scrapeOneSource).toHaveBeenCalledWith("src_1", override);
  });

  test("ScrapeOneSourceError kind=not_found → 404", async () => {
    scrapeOneSource.mockRejectedValue(new ScrapeOneSourceError("not_found", "MarketSource X not found"));
    const res = await POST(emptyBodyRequest(), paramsFor("X"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  test("ScrapeOneSourceError kind=inactive → 400", async () => {
    scrapeOneSource.mockRejectedValue(new ScrapeOneSourceError("inactive", "Source X is inactive"));
    const res = await POST(emptyBodyRequest(), paramsFor("X"));
    expect(res.status).toBe(400);
  });

  test("ScrapeOneSourceError kind=upstream → 502", async () => {
    scrapeOneSource.mockRejectedValue(new ScrapeOneSourceError("upstream", "Sidecar HTTP 504"));
    const res = await POST(emptyBodyRequest(), paramsFor("X"));
    expect(res.status).toBe(502);
  });

  test("Other thrown error → 500", async () => {
    scrapeOneSource.mockRejectedValue(new Error("something else"));
    const res = await POST(emptyBodyRequest(), paramsFor("X"));
    expect(res.status).toBe(500);
  });
});
