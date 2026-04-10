import type { PricingEntry } from "../scopePricingSeparator";

// ── Types ──────────────────────────────────────────────────────────────────

export type PricingParseResult = {
  total: number;
  lineCount: number;
  warnings: string[];
};

// ── Patterns ───────────────────────────────────────────────────────────────

// Dollar amounts: $1,234.56
const DOLLAR_RE = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;

// Unit prices — skip these for totaling: 12.50/SF
const UNIT_PRICE_RE = /[\d,.]+\s*\/\s*(?:SF|LF|CY|EA|LS|SY|GAL|TON|LB|HR|DAY|EACH|UNIT)\b/i;

// Grand total / base bid indicators
const GRAND_TOTAL_RE = /\b(?:grand\s*total|base\s*bid|bid\s*amount|total\s*(?:bid|price|cost|amount))\b/i;

// Subtotal indicators — lower priority than grand total
const SUBTOTAL_RE = /\b(?:subtotal|sub\s*total)\b/i;

// ── Helpers ────────────────────────────────────────────────────────────────

function parseDollarAmount(text: string): number {
  const matches: number[] = [];
  const re = new RegExp(DOLLAR_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (!isNaN(num)) matches.push(num);
  }
  return matches.reduce((sum, n) => sum + n, 0);
}

function isUnitPrice(text: string): boolean {
  return UNIT_PRICE_RE.test(text);
}

// ── Main function ──────────────────────────────────────────────────────────

export function parsePricingTotal(pricingDataJson: string): PricingParseResult {
  const warnings: string[] = [];

  let entries: PricingEntry[];
  try {
    entries = JSON.parse(pricingDataJson);
  } catch {
    return { total: 0, lineCount: 0, warnings: ["Failed to parse pricingData JSON"] };
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return { total: 0, lineCount: 0, warnings: ["No pricing entries found"] };
  }

  // Classify each entry
  const parsed: Array<{
    amount: number;
    isGrandTotal: boolean;
    isSubtotal: boolean;
    isUnitPrice: boolean;
    raw: string;
  }> = [];
  let unitPriceOnlyCount = 0;

  for (const entry of entries) {
    const raw = entry.rawPriceText ?? "";
    if (!raw) continue;

    // Track but skip pure unit prices ($/SF etc) — they can't roll up to a total
    if (isUnitPrice(raw) && !DOLLAR_RE.test(raw)) {
      unitPriceOnlyCount++;
      continue;
    }

    const amount = parseDollarAmount(raw);
    if (amount <= 0) continue;

    parsed.push({
      amount,
      isGrandTotal: GRAND_TOTAL_RE.test(raw),
      isSubtotal: SUBTOTAL_RE.test(raw),
      isUnitPrice: isUnitPrice(raw),
      raw,
    });
  }

  if (parsed.length === 0) {
    if (unitPriceOnlyCount > 0) {
      return {
        total: 0,
        lineCount: unitPriceOnlyCount,
        warnings: ["Only unit prices found — cannot compute total"],
      };
    }
    return { total: 0, lineCount: entries.length, warnings: ["No dollar amounts found in pricing data"] };
  }

  // Strategy 1: If there's a grand total line, use it
  const grandTotals = parsed.filter((p) => p.isGrandTotal);
  if (grandTotals.length === 1) {
    return { total: grandTotals[0].amount, lineCount: parsed.length, warnings };
  }
  if (grandTotals.length > 1) {
    // Multiple grand totals — use the largest (likely the final one)
    const largest = grandTotals.reduce((a, b) => (a.amount > b.amount ? a : b));
    warnings.push(`Multiple grand total lines found — using largest ($${largest.amount.toLocaleString()})`);
    return { total: largest.amount, lineCount: parsed.length, warnings };
  }

  // Strategy 2: No grand total — sum non-subtotal, non-unit-price amounts
  const lineItems = parsed.filter((p) => !p.isSubtotal && !p.isUnitPrice);
  if (lineItems.length > 0) {
    const total = lineItems.reduce((sum, p) => sum + p.amount, 0);

    // Sanity check: if we have subtotals, verify our sum is in the same ballpark
    const subtotals = parsed.filter((p) => p.isSubtotal);
    if (subtotals.length > 0) {
      const subtotalSum = subtotals.reduce((sum, p) => sum + p.amount, 0);
      // If subtotal sum is close to our total (within 20%), it's likely correct
      // If subtotal sum is much larger, it's probably the better number
      if (subtotalSum > total * 1.2 && subtotalSum > total) {
        warnings.push("Subtotal sum exceeds line item sum — using subtotals");
        return { total: subtotalSum, lineCount: parsed.length, warnings };
      }
    }

    if (total < 1000) {
      warnings.push("Parsed total is suspiciously low — may be partial or unit prices only");
    }

    return { total, lineCount: parsed.length, warnings };
  }

  // Strategy 3: Only subtotals — sum them
  const subtotals = parsed.filter((p) => p.isSubtotal);
  if (subtotals.length > 0) {
    const total = subtotals.reduce((sum, p) => sum + p.amount, 0);
    warnings.push("No line items found — total computed from subtotals only");
    return { total, lineCount: parsed.length, warnings };
  }

  // Fallback: should be unreachable since parsed.length > 0 implies line items or subtotals
  warnings.push("Could not determine total from pricing data");
  return { total: 0, lineCount: parsed.length, warnings };
}
