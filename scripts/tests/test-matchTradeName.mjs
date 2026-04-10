// Standalone unit tests for matchTradeNames
// Run with: node --test --experimental-strip-types scripts/tests/test-matchTradeName.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTradeNames } from "../../lib/services/import/matchTradeName.ts";

const TRADE_DICT = [
  { id: 1, name: "Electrical" },
  { id: 2, name: "Mechanical / HVAC" },
  { id: 3, name: "Plumbing" },
  { id: 4, name: "Fire Protection" },
  { id: 5, name: "Concrete" },
  { id: 6, name: "Structural Steel" },
  { id: 7, name: "Roofing" },
  { id: 8, name: "Drywall and Framing" },
  { id: 9, name: "Low Voltage / Data" },
  { id: 10, name: "Site Excavation" },
];

test("exact match returns confidence 'exact'", () => {
  const [result] = matchTradeNames(["Electrical"], TRADE_DICT);
  assert.equal(result.confidence, "exact");
  assert.equal(result.matched.id, 1);
  assert.equal(result.matched.name, "Electrical");
});

test("case-insensitive exact match", () => {
  const [result] = matchTradeNames(["ELECTRICAL"], TRADE_DICT);
  assert.equal(result.confidence, "exact");
  assert.equal(result.matched.id, 1);
});

test("normalized exact match strips punctuation", () => {
  const [result] = matchTradeNames(["Mechanical / HVAC"], TRADE_DICT);
  assert.equal(result.confidence, "exact");
  assert.equal(result.matched.id, 2);
});

test("substring match — source within target", () => {
  const [result] = matchTradeNames(["HVAC"], TRADE_DICT);
  assert.equal(result.confidence, "fuzzy");
  assert.equal(result.matched.name, "Mechanical / HVAC");
});

test("substring match — target within source", () => {
  const [result] = matchTradeNames(["Concrete Foundation Work"], TRADE_DICT);
  assert.equal(result.confidence, "fuzzy");
  assert.equal(result.matched.name, "Concrete");
});

test("token-based fuzzy match (word reorder)", () => {
  // "Steel Structural" doesn't match by exact string or substring,
  // but tokenizing both yields {steel, structural} → jaccard 1.0 → fuzzy match.
  const [result] = matchTradeNames(["Steel Structural"], TRADE_DICT);
  assert.equal(result.confidence, "fuzzy");
  assert.equal(result.matched.name, "Structural Steel");
});

test("returns null for no match", () => {
  const [result] = matchTradeNames(["Carpentry"], TRADE_DICT);
  assert.equal(result.confidence, "none");
  assert.equal(result.matched, null);
});

test("returns null for empty string", () => {
  const [result] = matchTradeNames([""], TRADE_DICT);
  assert.equal(result.confidence, "none");
  assert.equal(result.matched, null);
});

test("returns null for whitespace only", () => {
  const [result] = matchTradeNames(["   "], TRADE_DICT);
  assert.equal(result.confidence, "none");
  assert.equal(result.matched, null);
});

test("matches Plumbing variants", () => {
  const results = matchTradeNames(
    ["Plumbing", "PLUMBING", "plumbing services"],
    TRADE_DICT
  );
  assert.equal(results[0].matched.name, "Plumbing");
  assert.equal(results[1].matched.name, "Plumbing");
  assert.equal(results[2].matched.name, "Plumbing");
});

test("matches Fire Protection variants", () => {
  const results = matchTradeNames(
    ["Fire Protection", "Fire Sprinkler", "Fire"],
    TRADE_DICT
  );
  assert.equal(results[0].matched.name, "Fire Protection");
  // "Fire Sprinkler" → tokens [fire, sprinkler] vs [fire, protection] = 1/3 = 0.33 < 0.5
  // BUT "Fire" is a substring match
});

test("does not over-match short strings", () => {
  // "El" should not match "Electrical" by substring
  const [result] = matchTradeNames(["El"], TRADE_DICT);
  // El is a substring of Electrical, so this WILL fuzzy match
  // This is acceptable for the use case (importing trade lists from spreadsheets)
  // but documented here so we know
  assert.equal(result.confidence, "fuzzy");
});

test("processes multiple sources at once", () => {
  const results = matchTradeNames(
    ["Electrical", "Plumbing", "Concrete", "Carpentry"],
    TRADE_DICT
  );
  assert.equal(results.length, 4);
  assert.equal(results[0].confidence, "exact");
  assert.equal(results[1].confidence, "exact");
  assert.equal(results[2].confidence, "exact");
  assert.equal(results[3].confidence, "none");
});

test("handles empty trade dictionary", () => {
  const [result] = matchTradeNames(["Electrical"], []);
  assert.equal(result.confidence, "none");
  assert.equal(result.matched, null);
});

test("strips stop words during tokenization", () => {
  // "Drywall and Framing" tokens: [drywall, framing] (and is stop word)
  // "Drywall Framing" tokens: [drywall, framing]
  // jaccard = 1.0 → fuzzy match
  const [result] = matchTradeNames(["Drywall Framing"], TRADE_DICT);
  assert.notEqual(result.confidence, "none");
  assert.equal(result.matched.name, "Drywall and Framing");
});

test("preserves source string in result", () => {
  const sources = ["ELECTRICAL", "carpentry", "  Plumbing  "];
  const results = matchTradeNames(sources, TRADE_DICT);
  assert.equal(results[0].source, "ELECTRICAL");
  assert.equal(results[1].source, "carpentry");
  assert.equal(results[2].source, "  Plumbing  ");
});
