// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/alertSeverityNormalize.ts
//  Phase O2.2 PR8 — Severity normalization (deterministic, no AI).
//
//  The MI-10 enum is INFO | WATCH | ATTENTION | URGENT. PR8 standardizes
//  operator-facing bands as INFO | WATCH | IMPORTANT | CRITICAL per the
//  user spec. This module is the ONLY place legacy ↔ normalized mapping
//  happens — it's a pure, versioned table so downstream display + analytics
//  stay aligned across both producer paths (operator-created AlertRules and
//  runner-driven detectors).
//
//  Hard rules (PR8):
//    * Pure function. No I/O.
//    * Deterministic — same input → same output, byte-for-byte.
//    * Versioned — bumping SEVERITY_NORMALIZATION_VERSION is a versioning event.
//    * Does NOT redesign the MI-10 enum. ALERT_SEVERITIES still includes
//      ATTENTION + URGENT; the AlertEvent.severity column accepts any string.
//      Newly-written events use the normalized bands directly.
// ──────────────────────────────────────────────────────────────────────────────

export const SEVERITY_NORMALIZATION_VERSION = "v1" as const;

export const NORMALIZED_ALERT_SEVERITIES = [
  "INFO",       // operator awareness, never urgent
  "WATCH",      // routine attention, surface in feed
  "IMPORTANT",  // promote to top of inbox
  "CRITICAL",   // demand immediate review
] as const;
export type NormalizedAlertSeverity = (typeof NORMALIZED_ALERT_SEVERITIES)[number];

/** Stable mapping from legacy MI-10 severity → PR8 normalized band. Same
 *  rank-ordering preserved (INFO < WATCH < IMPORTANT < CRITICAL matches
 *  INFO < WATCH < ATTENTION < URGENT). Unknown strings degrade to INFO
 *  with `decision: "unknown_input"` from `normalizeSeverityDetailed`. */
const LEGACY_TO_NORMALIZED: Readonly<Record<string, NormalizedAlertSeverity>> = Object.freeze({
  // Legacy MI-10 bands
  INFO: "INFO",
  WATCH: "WATCH",
  ATTENTION: "IMPORTANT",
  URGENT: "CRITICAL",
  // Already-normalized bands (idempotent — re-normalizing is safe)
  IMPORTANT: "IMPORTANT",
  CRITICAL: "CRITICAL",
});

const RANK: Readonly<Record<NormalizedAlertSeverity, number>> = Object.freeze({
  INFO: 0,
  WATCH: 1,
  IMPORTANT: 2,
  CRITICAL: 3,
});

/** Map an MI-10 severity (or already-normalized severity) onto the
 *  PR8 normalized band. Unknown inputs default to INFO. */
export function normalizeSeverity(legacy: string | null | undefined): NormalizedAlertSeverity {
  if (!legacy) return "INFO";
  return LEGACY_TO_NORMALIZED[legacy.toUpperCase()] ?? "INFO";
}

export interface NormalizeSeverityDetail {
  input: string | null;
  output: NormalizedAlertSeverity;
  decision: "mapped" | "idempotent" | "unknown_input" | "null_input";
}

/** Diagnostic variant — used by tests + audit logging to confirm WHY a
 *  given severity ended up in its target band. */
export function normalizeSeverityDetailed(legacy: string | null | undefined): NormalizeSeverityDetail {
  if (!legacy) return { input: null, output: "INFO", decision: "null_input" };
  const upper = legacy.toUpperCase();
  const mapped = LEGACY_TO_NORMALIZED[upper];
  if (!mapped) return { input: legacy, output: "INFO", decision: "unknown_input" };
  const normalized: Set<string> = new Set(NORMALIZED_ALERT_SEVERITIES);
  if (normalized.has(upper)) return { input: legacy, output: mapped, decision: "idempotent" };
  return { input: legacy, output: mapped, decision: "mapped" };
}

/** Rank-order accessor — used by `pickHigherSeverity`. */
export function normalizedSeverityRank(sev: NormalizedAlertSeverity): number {
  return RANK[sev];
}

/** Return whichever severity is higher (CRITICAL beats IMPORTANT beats
 *  WATCH beats INFO). Useful when a detector wants to apply a floor while
 *  also respecting a per-rule operator floor. */
export function pickHigherSeverity(a: NormalizedAlertSeverity, b: NormalizedAlertSeverity): NormalizedAlertSeverity {
  return normalizedSeverityRank(a) >= normalizedSeverityRank(b) ? a : b;
}
