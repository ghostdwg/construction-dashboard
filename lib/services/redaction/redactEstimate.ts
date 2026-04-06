import type { ScopeLine } from "../scopePricingSeparator";

// ── Identity patterns ────────────────────────────────────────────────────────

// Email addresses
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Phone numbers: (515) 555-0101 / 515-555-0101 / 515.555.0101 / 5155550101
const PHONE_RE =
  /(\(?\d{3}\)?[\s.\-])?\d{3}[\s.\-]\d{4}/g;

// Street addresses: "123 Main St", "4500 N. Oak Ave", etc.
// Requires a leading number + word + street suffix
const ADDRESS_RE =
  /\b\d{1,6}\s+[A-Z][A-Za-z0-9.\s]{2,30}(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Pkwy|Hwy|Suite|Ste|Floor|Fl)\.?\b/g;

// Contractor license numbers: "Lic#", "License No.", "Lic. No." followed by alphanumerics
const LICENSE_RE =
  /\b(?:Lic(?:ense)?\.?\s*(?:No\.?|#)?\s*)[A-Z0-9\-]{4,20}/gi;

// Web URLs
const URL_RE = /https?:\/\/[^\s]+/g;

// ── Pricing patterns (residual — separator may have missed these) ─────────────

// Dollar amounts with optional commas/cents
const DOLLAR_RE = /\$\s*[\d,]+(?:\.\d{1,2})?/g;

// Unit prices: 12.50/SF, 125/LF, 50/EA, etc.
const UNIT_PRICE_RE = /[\d,.]+\s*\/\s*(?:SF|LF|CY|EA|LS|SY|GAL|TON|LB|HR|DAY|EACH|UNIT)\b/gi;

// Lump sum / allowance with trailing number
const LUMP_SUM_RE =
  /\b(?:lump\s*sum|allowance|LS)\s*[\$\d,]+(?:\.\d{1,2})?/gi;

// Total / subtotal lines that still contain a number
const TOTAL_LINE_RE =
  /\b(?:total|subtotal|grand\s*total|sum|base\s*bid|bid\s*amount)\b[^\n]*\d/gi;

// ── Flagging heuristic ────────────────────────────────────────────────────────

// Lines that may still contain pricing after redaction — flag for human review
const SUSPICIOUS_RE =
  /(?:\$|\/SF|\/LF|\/EA|per\s+(?:sf|lf|ea|unit)|total|subtotal|allowance|\bLS\b)/i;

// ── Token assignment ──────────────────────────────────────────────────────────

export const TOKEN_LABELS = [
  "SUB-A", "SUB-B", "SUB-C", "SUB-D", "SUB-E",
  "SUB-F", "SUB-G", "SUB-H", "SUB-I", "SUB-J",
];

// ── Core redaction function ───────────────────────────────────────────────────

function redactLine(text: string): { redacted: string; count: number } {
  let count = 0;
  let out = text;

  const replace = (re: RegExp, token: string): void => {
    const before = out;
    out = out.replace(re, token);
    // Count distinct replacements by comparing lengths isn't reliable —
    // count matches in the original instead
    const matches = before.match(re);
    if (matches) count += matches.length;
  };

  // Identity
  replace(EMAIL_RE, "[EMAIL]");
  replace(PHONE_RE, "[PHONE]");
  replace(URL_RE, "[EMAIL]"); // URLs treated same as contact info
  replace(ADDRESS_RE, "[ADDRESS]");
  replace(LICENSE_RE, "[LICENSE]");

  // Residual pricing
  replace(TOTAL_LINE_RE, "[REDACTED]");
  replace(DOLLAR_RE, "[REDACTED]");
  replace(UNIT_PRICE_RE, "[REDACTED]");
  replace(LUMP_SUM_RE, "[REDACTED]");

  // Collapse extra whitespace left by replacements
  out = out.replace(/\s{2,}/g, " ").trim();

  return { redacted: out, count };
}

// ── Public API ────────────────────────────────────────────────────────────────

export type RedactionResult = {
  sanitizedText: string;
  flaggedLines: string[];
  redactionCount: number;
};

// Takes parsed scopeLines JSON string (already price-separated by intake layer)
// and returns sanitized, AI-safe text with identity redacted and residual
// pricing tokens replaced.
export function redactEstimate(scopeLinesJson: string): RedactionResult {
  let scopeLines: ScopeLine[];
  try {
    scopeLines = JSON.parse(scopeLinesJson) as ScopeLine[];
  } catch {
    return { sanitizedText: "", flaggedLines: [], redactionCount: 0 };
  }

  if (!Array.isArray(scopeLines) || scopeLines.length === 0) {
    return { sanitizedText: "", flaggedLines: [], redactionCount: 0 };
  }

  const outputLines: string[] = [];
  const flaggedLines: string[] = [];
  let totalRedactions = 0;
  let currentDivision = "";

  for (const line of scopeLines) {
    // Emit division header when it changes
    if (line.division && line.division !== currentDivision) {
      currentDivision = line.division;
      outputLines.push(`\n[${currentDivision}]`);
    }

    const { redacted, count } = redactLine(line.description);
    totalRedactions += count;

    // Reconstruct quantity/unit if present and not already in description
    let full = redacted;
    if (line.quantity && line.unit && !redacted.includes(line.quantity)) {
      full = `${redacted} — ${line.quantity} ${line.unit}`;
    }
    if (line.notes) {
      const { redacted: redactedNotes, count: nc } = redactLine(line.notes);
      totalRedactions += nc;
      full += ` (${redactedNotes})`;
    }

    outputLines.push(full);

    // Flag if suspicious pricing patterns remain after redaction
    if (SUSPICIOUS_RE.test(full)) {
      flaggedLines.push(full);
    }
  }

  const sanitizedText = outputLines.join("\n").trim();

  return { sanitizedText, flaggedLines, redactionCount: totalRedactions };
}
