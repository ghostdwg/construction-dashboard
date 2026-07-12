import { describe, expect, it } from "vitest";
import { computeLeadScore, LEAD_SCORE_VERSION } from "../leadScore";

const NOW = new Date("2026-07-12T12:00:00Z");

function daysBefore(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

describe("computeLeadScore — weight matrix", () => {
  it("scores a perfect lead at 100", () => {
    const result = computeLeadScore({
      aiScore: 100,
      signals: [
        { aiRelevanceScore: 100, heuristicsClassification: "HIGH_EMERGENCE" },
        { aiRelevanceScore: 90, heuristicsClassification: "HIGH_EMERGENCE" },
        { aiRelevanceScore: 80, heuristicsClassification: "MEDIUM_EMERGENCE" },
      ],
      estimatedValue: 15_000_000,
      detectedAt: daysBefore(1),
      now: NOW,
    });
    expect(result.score).toBe(100);
    expect(result.version).toBe(LEAD_SCORE_VERSION);
    expect(result.factors.modelRelevance).toBe(40);
    expect(result.factors.heuristicEmergence).toBe(25);
    expect(result.factors.estimatedValue).toBe(15);
    expect(result.factors.corroboration).toBe(10);
    expect(result.factors.recency).toBe(10);
  });

  it("scores a zero-signal lead at a neutral baseline", () => {
    const result = computeLeadScore({
      aiScore: 0,
      signals: [],
      estimatedValue: null,
      detectedAt: daysBefore(200),
      now: NOW,
    });
    // modelRelevance=0, heuristicEmergence=10(neutral), estimatedValue=6, corroboration=0, recency=1
    expect(result.factors.modelRelevance).toBe(0);
    expect(result.factors.heuristicEmergence).toBe(10);
    expect(result.factors.estimatedValue).toBe(6);
    expect(result.factors.corroboration).toBe(0);
    expect(result.factors.recency).toBe(1);
    expect(result.score).toBe(17);
  });

  it("model relevance: takes the best of lead.aiScore and best signal score", () => {
    const a = computeLeadScore({
      aiScore: 50,
      signals: [{ aiRelevanceScore: 80, heuristicsClassification: null }],
      estimatedValue: null,
      detectedAt: daysBefore(1),
      now: NOW,
    });
    const b = computeLeadScore({
      aiScore: 80,
      signals: [{ aiRelevanceScore: 50, heuristicsClassification: null }],
      estimatedValue: null,
      detectedAt: daysBefore(1),
      now: NOW,
    });
    // both should have modelRelevance = round(0.4 * 80) = 32
    expect(a.factors.modelRelevance).toBe(32);
    expect(b.factors.modelRelevance).toBe(32);
  });

  it("heuristic emergence: pre-heuristics rows (all null) → 10 neutral", () => {
    const result = computeLeadScore({
      aiScore: 0,
      signals: [
        { aiRelevanceScore: 50, heuristicsClassification: null },
        { aiRelevanceScore: 40, heuristicsClassification: null },
      ],
      estimatedValue: null,
      detectedAt: daysBefore(1),
      now: NOW,
    });
    expect(result.factors.heuristicEmergence).toBe(10);
  });

  it("heuristic emergence: HIGH beats MEDIUM", () => {
    const result = computeLeadScore({
      aiScore: 0,
      signals: [
        { aiRelevanceScore: null, heuristicsClassification: "MEDIUM_EMERGENCE" },
        { aiRelevanceScore: null, heuristicsClassification: "HIGH_EMERGENCE" },
      ],
      estimatedValue: null,
      detectedAt: daysBefore(1),
      now: NOW,
    });
    expect(result.factors.heuristicEmergence).toBe(25);
  });

  it("estimated value brackets", () => {
    const cases: Array<[number | null, number]> = [
      [null,         6],
      [0,            0],
      [100_000,      4],
      [250_000,      8],
      [1_000_000,   12],
      [10_000_000,  15],
    ];
    for (const [v, expected] of cases) {
      const result = computeLeadScore({
        aiScore: 0, signals: [], estimatedValue: v,
        detectedAt: daysBefore(1), now: NOW,
      });
      expect(result.factors.estimatedValue).toBe(expected);
    }
  });

  it("corroboration: 0/1/2/3+ signals → 0/4/7/10", () => {
    const sig = { aiRelevanceScore: null, heuristicsClassification: null };
    const cases: Array<[number, number]> = [[0, 0], [1, 4], [2, 7], [3, 10], [5, 10]];
    for (const [count, expected] of cases) {
      const result = computeLeadScore({
        aiScore: 0, signals: Array(count).fill(sig) as typeof sig[],
        estimatedValue: null, detectedAt: daysBefore(1), now: NOW,
      });
      expect(result.factors.corroboration).toBe(expected);
    }
  });

  it("recency brackets: ≤7/≤30/≤90/else → 10/7/4/1", () => {
    const cases: Array<[number, number]> = [[0, 10], [7, 10], [30, 7], [90, 4], [91, 1]];
    for (const [days, expected] of cases) {
      const result = computeLeadScore({
        aiScore: 0, signals: [], estimatedValue: null,
        detectedAt: daysBefore(days), now: NOW,
      });
      expect(result.factors.recency).toBe(expected);
    }
  });

  it("score is clamped to [0, 100]", () => {
    const result = computeLeadScore({
      aiScore: 200, // intentionally out-of-range
      signals: Array(10).fill({ aiRelevanceScore: 200, heuristicsClassification: "HIGH_EMERGENCE" }),
      estimatedValue: 100_000_000,
      detectedAt: daysBefore(0),
      now: NOW,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("version is stable", () => {
    const result = computeLeadScore({
      aiScore: 50, signals: [], estimatedValue: null,
      detectedAt: daysBefore(5), now: NOW,
    });
    expect(result.version).toBe("v1");
  });
});
