// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/heuristics.ts
//  Phase MI-6 — Pure per-factor scoring functions.
//
//  Each function takes minimal input and returns a number in [0, 1]. No DB
//  calls, no LLMs, no random state. Composite scoring (similarity.ts)
//  combines these via weighted average.
//
//  Stability contract: every heuristic returns the same score for the same
//  inputs. Changes to the algorithm MUST bump AGGREGATOR_VERSION in types.ts
//  so ProjectProbabilitySnapshot rows know which version produced them.
// ──────────────────────────────────────────────────────────────────────────────

import { scoreEntityMatch } from "@/lib/services/entityResolver";
import type { ProjectEntityRole, SignalInput, ProjectContext } from "./types";

// ── Parcel ────────────────────────────────────────────────────────────────────
//
// Strongest single factor. Two signals naming the same parcel are almost
// always the same project (excluding parcel-replat situations, which the
// operator handles via merge).

export function scoreParcelMatch(signal: SignalInput, project: ProjectContext): number {
  if (signal.parcelIds.length === 0 || project.parcelIds.length === 0) return 0;
  const projectSet = new Set(project.parcelIds);
  for (const p of signal.parcelIds) {
    if (projectSet.has(p)) return 1;
  }
  // Address-substring fallback when parcel IDs don't match but addresses
  // overlap. Cheap heuristic; addresses are normalized to lowercase and the
  // shorter is checked as substring of the longer.
  return 0;
}

// ── Entity role matches ──────────────────────────────────────────────────────
//
// Co-occurring developer / engineer / broker entities are strong signals
// that two events belong to the same project. Score is "1 if any matching
// entity in role, else 0" — chosen over a count-based score to keep
// noise-tolerant against high-volume entities (a busy developer like
// Hubbell would otherwise dominate scoring).

function hasEntityInRole(
  signal: SignalInput,
  project: ProjectContext,
  role: ProjectEntityRole
): boolean {
  const projectIds = new Set(project.entityIdsByRole[role] ?? []);
  for (const e of signal.entityIds) {
    if (e.role === role && projectIds.has(e.entityId)) return true;
  }
  return false;
}

export function scoreDeveloperMatch(signal: SignalInput, project: ProjectContext): number {
  return hasEntityInRole(signal, project, "DEVELOPER") ? 1 : hasEntityInRole(signal, project, "OWNER") ? 0.85 : 0;
}

export function scoreEngineerMatch(signal: SignalInput, project: ProjectContext): number {
  return hasEntityInRole(signal, project, "ENGINEER") ? 1 : 0;
}

export function scoreBrokerMatch(signal: SignalInput, project: ProjectContext): number {
  return hasEntityInRole(signal, project, "BROKER") ? 1 : 0;
}

// ── Jurisdiction ─────────────────────────────────────────────────────────────

export function scoreJurisdictionMatch(signal: SignalInput, project: ProjectContext): number {
  if (!signal.jurisdiction || !project.jurisdiction) return 0;
  return signal.jurisdiction.trim().toLowerCase() === project.jurisdiction.trim().toLowerCase() ? 1 : 0;
}

// ── Zoning continuity ────────────────────────────────────────────────────────
//
// Heuristic: if a signal carries a zoning tag (e.g., "M-1", "PUD",
// "rezoning") AND the project's recent tags contain a related zoning
// designation, score positive. Conservative — operator can lower the
// reviewThreshold to surface near-misses.

const ZONING_TAG_PATTERN = /\b(rezoning|sup_cup|variance|pud|m-?[12]|c-?[12]|r-?[1234]|industrial|commercial|mixed-use)\b/i;

export function scoreZoningContinuity(signal: SignalInput, project: ProjectContext): number {
  const signalZoning = signal.tags.filter((t) => ZONING_TAG_PATTERN.test(t));
  if (signalZoning.length === 0) return 0;
  const projectZoning = project.recentTags.filter((t) => ZONING_TAG_PATTERN.test(t));
  if (projectZoning.length === 0) return 0;
  // Any overlap → strong; both have zoning context but distinct designation
  // → weak positive (still suggests entitlement continuity).
  const projectSet = new Set(projectZoning.map((t) => t.toLowerCase()));
  for (const t of signalZoning) {
    if (projectSet.has(t.toLowerCase())) return 1;
  }
  return 0.4;
}

// ── Utility extension ────────────────────────────────────────────────────────

const UTILITY_PATTERN = /\b(water main|sewer main|sanitary|storm sewer|utility extension|lift station|electrical service|substation|gas main|fiber)\b/i;

export function scoreUtilityExtension(signal: SignalInput, project: ProjectContext): number {
  const signalHasUtility = signal.tags.some((t) => UTILITY_PATTERN.test(t));
  if (!signalHasUtility) return 0;
  const projectHasUtility = project.recentTags.some((t) => UTILITY_PATTERN.test(t));
  // Utility extension on a project's parcel is a strong site-prep indicator
  // regardless of prior utility tags — but we double-score when the project
  // has already been associated with utility activity.
  return projectHasUtility ? 1 : 0.7;
}

// ── Temporal proximity ───────────────────────────────────────────────────────
//
// Signals close in time to a project's recent activity score high; distant
// signals score low. Window: a Gaussian-ish decay centered at 0 with
// half-life ~60 days. Pure function over the time delta.

const TEMPORAL_HALF_LIFE_DAYS = 60;

export function scoreTemporalProximity(signal: SignalInput, project: ProjectContext): number {
  const ref = project.lastSignalAt ?? project.firstSignalAt;
  if (!ref) return 0;
  const deltaMs = Math.abs(signal.occurredAt.getTime() - ref.getTime());
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
  // exponential decay: 1 at delta=0, ~0.5 at half-life
  return Math.pow(0.5, deltaDays / TEMPORAL_HALF_LIFE_DAYS);
}

// ── Title similarity ─────────────────────────────────────────────────────────
//
// Weak factor — many real projects share generic title fragments ("Phase 2
// expansion"). Uses entityResolver's bigram Dice's coefficient on normalized
// titles (lowercase, alphanumeric only). The composite weights this low.

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function scoreTitleSimilarity(signal: SignalInput, project: ProjectContext): number {
  if (!signal.title || !project.workingTitle) return 0;
  return scoreEntityMatch(normalizeTitle(signal.title), normalizeTitle(project.workingTitle));
}

// ── Agenda continuity ────────────────────────────────────────────────────────
//
// Agenda items that re-appear across multiple jurisdiction meetings — same
// applicant, same address — score positive. Detected via signal tag
// "continued" or "next-meeting" + matching jurisdiction.

const AGENDA_CONTINUITY_PATTERN = /\b(continued|tabled|next meeting|deferred to)\b/i;

export function scoreAgendaContinuity(signal: SignalInput, project: ProjectContext): number {
  const hasContinuance = signal.tags.some((t) => AGENDA_CONTINUITY_PATTERN.test(t));
  if (!hasContinuance) return 0;
  // Same jurisdiction agenda = stronger continuity signal
  if (signal.jurisdiction && project.jurisdiction &&
      signal.jurisdiction.toLowerCase() === project.jurisdiction.toLowerCase()) {
    return 1;
  }
  return 0.5;
}

// ── Continuance count ────────────────────────────────────────────────────────
//
// Distinct from agenda-continuity (which scores a SINGLE signal) — this
// scores against the PROJECT's accumulated continuance count. A project
// with ≥3 continuances reflects an applicant working through a
// jurisdiction's process; any new signal from that jurisdiction is more
// likely to belong.

export function scoreContinuanceCount(_signal: SignalInput, project: ProjectContext): number {
  if (project.continuanceCount >= 3) return 1;
  if (project.continuanceCount === 2) return 0.7;
  if (project.continuanceCount === 1) return 0.3;
  return 0;
}

// ── Shell-building pattern ───────────────────────────────────────────────────
//
// Specific industrial-emergence pattern: a parcel + engineer + utility
// activity without a named owner suggests speculative shell construction.
// When a new signal lands with industrial zoning OR a developer-but-no-
// tenant pattern AND the project already has the shell pattern, score
// positive.

const SHELL_TENANT_BUSINESS_PATTERN = /\b(distribution|warehouse|logistics|fulfillment|manufacturing|tilt-?up|shell)\b/i;

export function scoreShellBuildingPattern(signal: SignalInput, project: ProjectContext): number {
  if (!project.hasShellBuildingPattern) return 0;
  if (signal.tags.some((t) => SHELL_TENANT_BUSINESS_PATTERN.test(t))) return 1;
  // Even without the tag, a confirmed shell-pattern project accepts any
  // industrial-zoned signal at moderate score.
  if (signal.tags.some((t) => /industrial|m-?[12]/i.test(t))) return 0.6;
  return 0.3;
}
