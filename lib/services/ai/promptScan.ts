/**
 * Pure, synchronous, detect-only prompt scanner (P2-A0 shadow proof).
 *
 * No I/O. Never modifies the scanned text. This module only classifies —
 * it must never be wired into anything that blocks, redacts, sanitizes,
 * routes, or approves a request. Deliberately independent of
 * lib/services/redaction/redactEstimate.ts (never imported here): that
 * module targets structured scopeLines pre-redaction, not arbitrary
 * free-form prompt prose, and reusing its patterns unmodified against
 * prose would misrepresent what this shadow proof actually verifies.
 */

export const PROMPT_SCAN_VERSION = "1.0.0";

export const DETECTOR_IDS = [
  "dollar_amount",
  "unit_price",
  "total_line",
  "email",
  "phone",
  "url",
  "license",
  "prohibited_field_marker",
] as const;
export type DetectorId = (typeof DETECTOR_IDS)[number];

export type Confidence = "high" | "medium" | "low";

export interface PromptScanFinding {
  detector: DetectorId;
  count: number;
  confidence: Confidence;
}

export interface PromptScanResult {
  scannerVersion: string;
  mode: "shadow";
  findings: PromptScanFinding[];
  scannedChars: number;
  truncated: boolean;
}

const MAX_SCAN_CHARS = 200_000;

// Exact literal markers — the internal field identifiers that must never
// appear in an AI prompt (docs/architecture/GUARDRAILS.md — non-negotiable
// data boundaries). These are not surface syntax; presence of the literal
// identifier itself is always high confidence.
const PROHIBITED_FIELD_MARKERS = ["pricingData", "rawPriceText", "isPreferred"];

// Surface-syntax detectors. Defined independently from redactEstimate.ts —
// same general shape (this is a well-known problem space) but not imported,
// not shared, and not guaranteed to match its behavior.
//
// Every quantifier below is deliberately bounded (no unbounded `+`/`*` sits
// directly before a literal that might be absent from the input). Unbounded
// greedy runs followed by a required-but-possibly-missing anchor are a
// classic catastrophic-backtracking (ReDoS) trap: on adversarial or simply
// large real-world input (this scanner is capped at 200k chars, per real
// pasted specs/estimates) an unbounded pattern can hang the event loop for
// tens of seconds, which would defeat the "never affects the caller"
// requirement even though the scan itself is fire-and-forget. Verified empty
// -handed (no match) in well under 100ms against 200k-char adversarial probes
// for every detector below before this module was finalized.
const EMAIL_RE = /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63}){1,8}/g;
const PHONE_RE = /(\(?\d{3}\)?[\s.-])?\d{3}[\s.-]\d{4}\b/g;
const URL_RE = /https?:\/\/[^\s]{1,2048}/g;
const LICENSE_RE = /\bLic(?:ense)?\.?\s{0,3}(?:No\.?|#)?\s{0,3}[A-Z0-9-]{4,20}\b/gi;
const DOLLAR_RE = /\$\s{0,3}[\d,]{1,15}(?:\.\d{1,2})?/g;
const UNIT_PRICE_RE = /[\d,.]{1,15}\s{0,3}\/\s{0,3}(?:SF|LF|CY|EA|LS|SY|GAL|TON|LB|HR|DAY|EACH|UNIT)\b/gi;
const TOTAL_LINE_RE = /\b(?:total|subtotal|grand\s{0,3}total|sum|base\s{0,3}bid|bid\s{0,3}amount)\b[^\n]{0,200}\d/gi;

const SURFACE_DETECTORS: Array<{ detector: DetectorId; re: RegExp; confidence: Confidence }> = [
  { detector: "dollar_amount", re: DOLLAR_RE, confidence: "medium" },
  { detector: "unit_price", re: UNIT_PRICE_RE, confidence: "medium" },
  { detector: "total_line", re: TOTAL_LINE_RE, confidence: "medium" },
  { detector: "email", re: EMAIL_RE, confidence: "low" },
  { detector: "phone", re: PHONE_RE, confidence: "low" },
  { detector: "url", re: URL_RE, confidence: "low" },
  { detector: "license", re: LICENSE_RE, confidence: "low" },
];

function countMatches(re: RegExp, text: string): number {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Scans text for surface syntax and prohibited-field markers. Pure, sync, no I/O. */
export function scanPrompt(text: string): PromptScanResult {
  const truncated = text.length > MAX_SCAN_CHARS;
  const scanText = truncated ? text.slice(0, MAX_SCAN_CHARS) : text;

  const findings: PromptScanFinding[] = [];

  let markerCount = 0;
  for (const marker of PROHIBITED_FIELD_MARKERS) {
    markerCount += countMatches(new RegExp(escapeLiteral(marker), "g"), scanText);
  }
  if (markerCount > 0) {
    findings.push({ detector: "prohibited_field_marker", count: markerCount, confidence: "high" });
  }

  for (const { detector, re, confidence } of SURFACE_DETECTORS) {
    const count = countMatches(re, scanText);
    if (count > 0) findings.push({ detector, count, confidence });
  }

  return {
    scannerVersion: PROMPT_SCAN_VERSION,
    mode: "shadow",
    findings,
    scannedChars: scanText.length,
    truncated,
  };
}
