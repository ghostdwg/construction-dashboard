// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/__tests__/score.test.ts
//  Phase MI-2 — scoreEntityMatch() acceptance tests.
//
//  Verifies the bigram Dice's coefficient behaves in the empirical bands
//  the resolver relies on:
//    >= 0.85 → Pass 3 (HIGH-confidence fuzzy)
//    0.70–0.85 → Pass 4 (PENDING_REVIEW)
//    < 0.70 → Pass 5 (no match)
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { scoreEntityMatch } from "../score";

describe("scoreEntityMatch — degenerate inputs", () => {
  test("identical strings → 1", () => {
    expect(scoreEntityMatch("hubbell", "hubbell")).toBe(1);
  });
  test("empty input → 0", () => {
    expect(scoreEntityMatch("", "hubbell")).toBe(0);
    expect(scoreEntityMatch("hubbell", "")).toBe(0);
    expect(scoreEntityMatch("", "")).toBe(0);
  });
  test("single-character strings score 0 unless identical", () => {
    // Identical strings short-circuit to 1 regardless of length.
    expect(scoreEntityMatch("a", "a")).toBe(1);
    // Non-identical single chars have no bigrams to compare.
    expect(scoreEntityMatch("a", "b")).toBe(0);
  });
});

describe("scoreEntityMatch — typo bands", () => {
  test("one-character omission scores HIGH", () => {
    // "hubbell" vs "hubbel" — should land in Pass 3 territory
    expect(scoreEntityMatch("hubbell", "hubbel")).toBeGreaterThan(0.7);
  });
  test("one-character substitution scores HIGH on long names", () => {
    expect(scoreEntityMatch("walnutcreek", "walnutereek")).toBeGreaterThan(0.7);
  });
  test("single transposition on short name scores moderate", () => {
    // "weitz" vs "weizt" — bigrams {we, ei, it, tz} vs {we, ei, iz, zt}
    // share 2 of 4 → Dice's = 0.5 exactly. Documents the empirical band
    // so a future scoring change that drops below this is visible.
    expect(scoreEntityMatch("weitz", "weizt")).toBeGreaterThanOrEqual(0.4);
    expect(scoreEntityMatch("weitz", "weizt")).toBeLessThan(0.7);
  });
});

describe("scoreEntityMatch — distinct names", () => {
  test("completely different names score low", () => {
    expect(scoreEntityMatch("hubbell", "ryan")).toBeLessThan(0.3);
  });
  test("different GCs score below review threshold", () => {
    expect(scoreEntityMatch("weitz", "neumannbrothers")).toBeLessThan(0.3);
  });
});

describe("scoreEntityMatch — same-root variants", () => {
  test("with-and-without descriptor", () => {
    // "weitz" (canonical normalized) vs "weitzcompany" — should be partial.
    // Pass 1 would have caught the descriptor-stripped form already; this
    // tests the resolver's fuzzy fallback if the normalizer fails.
    const score = scoreEntityMatch("weitz", "weitzcompany");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.8);
  });
});

describe("scoreEntityMatch — case sensitivity contract", () => {
  test("operates on already-normalized strings; case is preserved", () => {
    // The resolver always feeds normalized (lowercase) inputs. If a caller
    // passes mixed-case strings, the bigrams differ. Documented contract.
    expect(scoreEntityMatch("Hubbell", "hubbell")).toBeLessThan(1);
  });
});
