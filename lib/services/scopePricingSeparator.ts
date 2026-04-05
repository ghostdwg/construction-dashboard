import { ExcelRow } from "./estimateParsers/parseExcel";

export type ScopeLine = {
  division: string;
  description: string;
  quantity?: string;
  unit?: string;
  notes?: string;
};

export type PricingEntry = {
  lineRef: string;
  rawPriceText: string;
};

export type SeparationResult = {
  scopeLines: ScopeLine[];
  pricingData: PricingEntry[];
};

// Matches dollar amounts: $1,234.56 / $1234 / $ 1,234 etc
const DOLLAR_PATTERN = /\$\s*[\d,]+(\.\d{1,2})?/g;
// Matches unit costs: 12.50/SF, 125/LF, 50/EA etc
const UNIT_COST_PATTERN = /[\d,.]+\s*\/\s*(SF|LF|CY|EA|LS|SY|GAL|TON|LB|HR|DAY|EACH|UNIT)\b/gi;
// Matches pricing keywords with amounts following them
const PRICING_KEYWORD_PATTERN =
  /\b(total|subtotal|lump\s*sum|allowance|unit\s*price|per\s*unit|bid\s*amount|base\s*bid|proposal|amount|price|cost|fee|rate|value)\b[\s:]*[\d,.$]+/gi;
// Matches lines that are ONLY a price (nothing descriptive)
const PRICE_ONLY_LINE = /^\s*[\$]?\s*[\d,]+(\.\d{1,2})?\s*$/;
// CSI division header: "03 30 00" or "DIVISION 3" or "03 00 00 - CONCRETE"
const CSI_HEADER = /^(\d{2}\s+\d{2}\s+\d{2}|\d{2}\s+\d{2}|\bDIVISION\s+\d+)\b/i;
// Quantities with units we KEEP: "1,200 SF", "50 LF", etc
const QUANTITY_PATTERN =
  /\b([\d,]+(?:\.\d+)?)\s*(SF|LF|CY|EA|LS|SY|GAL|TON|LB|HR|DAY|EACH|UNIT|SQ\.?\s*FT|LIN\.?\s*FT)\b/i;
// Pricing column headers in Excel
const PRICE_COLUMN_KEYS = /price|cost|amount|rate|value|bid|fee|proposal|total|subtotal/i;

function extractPrices(text: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  const dollarsRe = new RegExp(DOLLAR_PATTERN.source, "g");
  while ((m = dollarsRe.exec(text)) !== null) found.push(m[0]);
  const unitRe = new RegExp(UNIT_COST_PATTERN.source, "gi");
  while ((m = unitRe.exec(text)) !== null) found.push(m[0]);
  return found;
}

function stripPrices(text: string): string {
  return text
    .replace(new RegExp(DOLLAR_PATTERN.source, "g"), "")
    .replace(new RegExp(UNIT_COST_PATTERN.source, "gi"), "")
    .replace(new RegExp(PRICING_KEYWORD_PATTERN.source, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractQuantity(
  text: string
): { quantity: string; unit: string } | null {
  const m = QUANTITY_PATTERN.exec(text);
  if (!m) return null;
  return { quantity: m[1], unit: m[2] };
}

function detectDivision(line: string, currentDivision: string): string {
  if (CSI_HEADER.test(line)) {
    return line.trim().substring(0, 40);
  }
  return currentDivision;
}

function processTextLines(
  lines: string[]
): { scopeLines: ScopeLine[]; pricingData: PricingEntry[] } {
  const scopeLines: ScopeLine[] = [];
  const pricingData: PricingEntry[] = [];
  let currentDivision = "";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    // Update division context
    const newDiv = detectDivision(raw, currentDivision);
    if (newDiv !== currentDivision) {
      currentDivision = newDiv;
      // Division headers are scope metadata, not a content line
      continue;
    }

    // Collect any prices found on this line
    const prices = extractPrices(raw);
    if (prices.length > 0) {
      pricingData.push({ lineRef: `line:${i + 1}`, rawPriceText: prices.join(" | ") });
    }

    // If the line is ONLY a price with nothing else, skip adding to scope
    if (PRICE_ONLY_LINE.test(raw)) continue;

    const stripped = stripPrices(raw);
    if (!stripped) continue;

    const qtyMatch = extractQuantity(stripped);
    scopeLines.push({
      division: currentDivision,
      description: stripped,
      quantity: qtyMatch?.quantity,
      unit: qtyMatch?.unit,
    });
  }

  return { scopeLines, pricingData };
}

function processExcelRows(
  rows: ExcelRow[]
): { scopeLines: ScopeLine[]; pricingData: PricingEntry[] } {
  const scopeLines: ScopeLine[] = [];
  const pricingData: PricingEntry[] = [];
  let currentDivision = "";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const keys = Object.keys(row);

    // Separate pricing columns from scope columns
    const scopeParts: string[] = [];
    const priceParts: string[] = [];

    for (const key of keys) {
      const val = row[key];
      if (val == null) continue;
      const str = String(val).trim();
      if (!str) continue;

      if (PRICE_COLUMN_KEYS.test(key)) {
        priceParts.push(`${key}: ${str}`);
      } else {
        // Even in scope columns, strip any embedded dollar amounts
        const prices = extractPrices(str);
        if (prices.length > 0) priceParts.push(...prices);
        const stripped = stripPrices(str);
        if (stripped) scopeParts.push(stripped);
      }
    }

    if (priceParts.length > 0) {
      pricingData.push({ lineRef: `row:${i + 1}`, rawPriceText: priceParts.join(" | ") });
    }

    if (scopeParts.length === 0) continue;

    const description = scopeParts.join(" | ");
    const divCheck = detectDivision(description, currentDivision);
    if (divCheck !== currentDivision) currentDivision = divCheck;

    const qtyMatch = extractQuantity(description);
    scopeLines.push({
      division: currentDivision,
      description,
      quantity: qtyMatch?.quantity,
      unit: qtyMatch?.unit,
    });
  }

  return { scopeLines, pricingData };
}

export function separateScopeAndPricing(
  rawText: string,
  rows?: ExcelRow[]
): SeparationResult {
  if (rows && rows.length > 0) {
    return processExcelRows(rows);
  }

  const lines = rawText.split(/\r?\n/);
  return processTextLines(lines);
}
