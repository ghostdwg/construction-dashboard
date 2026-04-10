// Standalone unit tests for parsePricingTotal
// Run with: node --test --experimental-strip-types scripts/tests/test-parsePricingTotal.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePricingTotal } from "../../lib/services/estimate/parsePricingTotal.ts";

function pricingJson(entries) {
  return JSON.stringify(entries.map((rawPriceText, i) => ({ lineRef: `line:${i}`, rawPriceText })));
}

test("returns zero with warning for empty pricingData", () => {
  const result = parsePricingTotal("[]");
  assert.equal(result.total, 0);
  assert.ok(result.warnings.length > 0);
});

test("returns zero with warning for invalid JSON", () => {
  const result = parsePricingTotal("not-json");
  assert.equal(result.total, 0);
  assert.ok(result.warnings[0].includes("Failed to parse"));
});

test("uses single grand total when present", () => {
  const json = pricingJson([
    "Material: $10,000",
    "Labor: $5,000",
    "Grand Total: $18,500",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 18500);
});

test("uses largest grand total when multiple", () => {
  const json = pricingJson([
    "Subtotal: $10,000",
    "Total Price: $15,000",
    "Total Bid: $20,000",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 20000);
  assert.ok(result.warnings.some(w => w.includes("Multiple grand total")));
});

test("sums line items when no grand total", () => {
  const json = pricingJson([
    "Material: $10,000",
    "Labor: $5,000",
    "Equipment: $3,500",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 18500);
});

test("skips unit prices in totaling", () => {
  const json = pricingJson([
    "12.50/SF",
    "$45,000",
    "125/LF",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 45000);
});

test("handles dollar amounts with cents", () => {
  const json = pricingJson([
    "Total: $1,234.56",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 1234.56);
});

test("handles dollar amounts without comma separators", () => {
  const json = pricingJson([
    "Total Bid: $123456",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 123456);
});

test("handles multiple amounts on one line", () => {
  const json = pricingJson([
    "Material: $10,000 | Labor: $5,000",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 15000);
});

test("warns on suspiciously low total", () => {
  const json = pricingJson([
    "Setup: $50",
    "Cleanup: $25",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 75);
  assert.ok(result.warnings.some(w => w.includes("suspiciously low")));
});

test("handles only unit prices — returns zero with warning", () => {
  const json = pricingJson([
    "12.50/SF",
    "125/LF",
    "50/EA",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 0);
  assert.ok(result.warnings.some(w => w.includes("unit prices")));
});

test("handles spaces in dollar amounts", () => {
  const json = pricingJson([
    "Grand Total: $ 25,000",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 25000);
});

test("ignores negative or zero amounts", () => {
  const json = pricingJson([
    "Discount: $0",
    "Material: $10,000",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 10000);
});

test("real-world Procore-style pricing data", () => {
  const json = pricingJson([
    "Base Bid Total: $1,250,000",
    "Alternate 1: $50,000",
    "Alternate 2: $25,000",
  ]);
  const result = parsePricingTotal(json);
  assert.equal(result.total, 1250000);
});
