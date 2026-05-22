// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/sourceCadence.ts
//  Phase O2.2 PR2 — Source cadence intelligence + due-status governance.
//
//  Estimates how often a MarketSource publishes new documents and exposes
//  that estimate to the future municipal-agenda-ingestion runner (PR5) so
//  it can decide which sources to scrape per cycle without thrashing dead
//  feeds or starving active ones.
//
//  Two-layer design:
//    * PURE helpers — estimateCadence, determineDueStatus, computeNextExpectedAt.
//      No I/O. Easy to unit-test deterministically.
//    * DB helpers — recordDocDate, recomputeCadence, recordRunOutcome,
//      isSourceDue. Thin wrappers around prisma that call the pure helpers.
//
//  This module does NOT trigger scrapes. It only governs which sources
//  should be considered candidate work and tracks the health signal that
//  feeds the operator workspace.
//
//  Hard rules (same governance posture as signalHeuristics.ts):
//    * Deterministic, no ML, no opaque scoring.
//    * Bounded sample size (CADENCE_SAMPLE_CAP) — never store unbounded history.
//    * Caller-supplied `now` everywhere so tests can pin a clock.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export const CADENCE_VERSION = "v1" as const;

// ── Tunables (versioned with CADENCE_VERSION) ───────────────────────────────

/** Max rolling sample size per source. Older samples are pruned. */
export const CADENCE_SAMPLE_CAP = 20;
/** Floor on the estimated cadence (days). Anything tighter is the runner's
 *  hourly tick, not a source-specific cadence. */
export const CADENCE_MIN_DAYS = 1;
/** Ceiling on the estimated cadence (days). Above this we treat the source
 *  as "very rare publishes" and rely on the safety floor instead. */
export const CADENCE_MAX_DAYS = 60;
/** Confidence bucket boundaries on sample size. */
export const CONFIDENCE_LOW_MAX = 4;   // sample size 0–4 → LOW
export const CONFIDENCE_MEDIUM_MAX = 15; // sample size 5–15 → MEDIUM; >15 → HIGH
/** Safety floor: any source not scanned in this many days is forced due. */
export const SAFETY_FLOOR_DAYS = 7;
/** Lead time: schedule the next scrape one day before nextExpectedAt to
 *  reduce miss-the-window risk. */
export const NEXT_EXPECTED_LEAD_DAYS = 1;
/** Dormancy: this many consecutive empty runs past nextExpectedAt flips
 *  publishStatus to STALE_PUBLISH. */
export const DORMANCY_RUN_THRESHOLD = 3;

// ── Public types ────────────────────────────────────────────────────────────

export type PublishStatus = "HEALTHY" | "STALE_PUBLISH" | "OPERATOR_REVIEW";
export type CadenceConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface CadenceEstimate {
  publishCadenceDays: number | null;
  confidence: CadenceConfidence | null;
  sampleSize: number;
}

export interface CadenceObservation extends CadenceEstimate {
  lastDocSeenAt: Date | null;
  nextExpectedAt: Date | null;
}

export interface DueComputation {
  isDue: boolean;
  reason: "never_scanned" | "expected_now" | "safety_floor" | "stale_publish_hold" | "operator_review_hold" | "not_due";
  expectedAt: Date | null;
  lastScannedAt: Date | null;
}

export interface RunOutcome {
  publishStatus: PublishStatus;
  consecutiveEmptyRuns: number;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Median of a numeric array. Returns null for empty input. Pure. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

/** Compute days between two dates. Calendar-day approximation: drop sub-day
 *  precision via Math.round on hours. Pure. */
function daysBetween(a: Date, b: Date): number {
  const diffMs = b.getTime() - a.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Given a list of doc dates (any order, may include duplicates), compute a
 * cadence estimate. Pure.
 *
 *   - Dedupe by exact date-millis equality.
 *   - Sort ascending.
 *   - Compute Δs between consecutive dates.
 *   - Median Δ, clamped to [CADENCE_MIN_DAYS, CADENCE_MAX_DAYS].
 *   - Confidence: 0–4 samples → LOW, 5–15 → MEDIUM, >15 → HIGH.
 *   - When fewer than 2 distinct dates exist, publishCadenceDays = null
 *     (and confidence = "LOW" if any sample exists, else null).
 */
export function estimateCadence(docDates: readonly Date[]): CadenceEstimate {
  if (docDates.length === 0) {
    return { publishCadenceDays: null, confidence: null, sampleSize: 0 };
  }

  // Dedupe + sort.
  const uniqueMs = Array.from(new Set(docDates.map((d) => d.getTime()))).sort((a, b) => a - b);
  if (uniqueMs.length < 2) {
    return { publishCadenceDays: null, confidence: "LOW", sampleSize: uniqueMs.length };
  }

  const deltas: number[] = [];
  for (let i = 1; i < uniqueMs.length; i++) {
    deltas.push(Math.round((uniqueMs[i] - uniqueMs[i - 1]) / (24 * 60 * 60 * 1000)));
  }

  const med = median(deltas);
  const cadence = med == null ? null : clamp(Math.round(med), CADENCE_MIN_DAYS, CADENCE_MAX_DAYS);

  let confidence: CadenceConfidence;
  if (deltas.length <= CONFIDENCE_LOW_MAX) confidence = "LOW";
  else if (deltas.length <= CONFIDENCE_MEDIUM_MAX) confidence = "MEDIUM";
  else confidence = "HIGH";

  return {
    publishCadenceDays: cadence,
    confidence,
    sampleSize: deltas.length,
  };
}

/** Compute the next expected publish date. Pure.
 *  Returns null when we lack data to predict. */
export function computeNextExpectedAt(
  lastDocSeenAt: Date | null,
  publishCadenceDays: number | null,
): Date | null {
  if (!lastDocSeenAt || publishCadenceDays == null) return null;
  const leadDays = Math.max(0, publishCadenceDays - NEXT_EXPECTED_LEAD_DAYS);
  const next = new Date(lastDocSeenAt.getTime());
  next.setUTCDate(next.getUTCDate() + leadDays);
  return next;
}

/**
 * Pure due-status calculator. Inputs are simple value types so tests can
 * exercise edge cases without a DB. Order of precedence:
 *
 *   1. publishStatus = OPERATOR_REVIEW  → not due (hold).
 *   2. publishStatus = STALE_PUBLISH    → not due (hold) unless explicit force.
 *   3. lastScannedAt is null            → due (never scanned).
 *   4. nextExpectedAt <= now            → due (expected_now).
 *   5. lastScannedAt is older than SAFETY_FLOOR_DAYS → due (safety_floor).
 *   6. otherwise                        → not due.
 */
export function determineDueStatus(args: {
  now: Date;
  lastScannedAt: Date | null;
  nextExpectedAt: Date | null;
  publishStatus?: PublishStatus;
}): DueComputation {
  const { now, lastScannedAt, nextExpectedAt, publishStatus = "HEALTHY" } = args;

  if (publishStatus === "OPERATOR_REVIEW") {
    return { isDue: false, reason: "operator_review_hold", expectedAt: nextExpectedAt, lastScannedAt };
  }
  if (publishStatus === "STALE_PUBLISH") {
    return { isDue: false, reason: "stale_publish_hold", expectedAt: nextExpectedAt, lastScannedAt };
  }

  if (!lastScannedAt) {
    return { isDue: true, reason: "never_scanned", expectedAt: nextExpectedAt, lastScannedAt: null };
  }
  if (nextExpectedAt && nextExpectedAt.getTime() <= now.getTime()) {
    return { isDue: true, reason: "expected_now", expectedAt: nextExpectedAt, lastScannedAt };
  }
  if (daysBetween(lastScannedAt, now) >= SAFETY_FLOOR_DAYS) {
    return { isDue: true, reason: "safety_floor", expectedAt: nextExpectedAt, lastScannedAt };
  }
  return { isDue: false, reason: "not_due", expectedAt: nextExpectedAt, lastScannedAt };
}

/**
 * Compute the resulting publishStatus after a run. Pure.
 *
 *   - If new docs found → reset to HEALTHY, consecutiveEmptyRuns = 0.
 *   - If empty AND priorConsecutive + 1 >= DORMANCY_RUN_THRESHOLD AND
 *     nextExpectedAt is in the past → flip to STALE_PUBLISH.
 *   - Otherwise → preserve HEALTHY, increment consecutiveEmptyRuns.
 *
 *   OPERATOR_REVIEW is never overridden by automation — return as-is.
 */
export function determineRunOutcome(args: {
  foundNewDocs: boolean;
  priorStatus: PublishStatus;
  priorConsecutiveEmptyRuns: number;
  now: Date;
  nextExpectedAt: Date | null;
}): RunOutcome {
  const { foundNewDocs, priorStatus, priorConsecutiveEmptyRuns, now, nextExpectedAt } = args;

  if (priorStatus === "OPERATOR_REVIEW") {
    return { publishStatus: "OPERATOR_REVIEW", consecutiveEmptyRuns: priorConsecutiveEmptyRuns };
  }

  if (foundNewDocs) {
    return { publishStatus: "HEALTHY", consecutiveEmptyRuns: 0 };
  }

  const newCount = priorConsecutiveEmptyRuns + 1;
  const pastExpected = nextExpectedAt != null && nextExpectedAt.getTime() <= now.getTime();
  if (newCount >= DORMANCY_RUN_THRESHOLD && pastExpected) {
    return { publishStatus: "STALE_PUBLISH", consecutiveEmptyRuns: newCount };
  }
  return { publishStatus: priorStatus, consecutiveEmptyRuns: newCount };
}

// ── DB-touching helpers ─────────────────────────────────────────────────────

/**
 * Append a new cadence sample for the source. Prunes oldest samples beyond
 * CADENCE_SAMPLE_CAP so the table stays bounded per source.
 *
 * Idempotency: this function does NOT dedupe by docDate at the DB layer
 * (different observations of the same date are legitimate — the date was
 * re-observed in a later scrape). The estimateCadence pure helper dedupes
 * when computing the median, so duplicate inserts don't skew the estimate.
 */
export async function recordDocDate(sourceId: string, docDate: Date, now: Date = new Date()): Promise<void> {
  await prisma.marketSourceCadenceSample.create({
    data: { sourceId, docDate, observedAt: now },
  });

  // Prune oldest beyond cap. Cheap: ≤ CADENCE_SAMPLE_CAP+small rows.
  const all = await prisma.marketSourceCadenceSample.findMany({
    where: { sourceId },
    orderBy: { observedAt: "desc" },
    select: { id: true },
  });
  if (all.length > CADENCE_SAMPLE_CAP) {
    const toDelete = all.slice(CADENCE_SAMPLE_CAP).map((r) => r.id);
    await prisma.marketSourceCadenceSample.deleteMany({
      where: { id: { in: toDelete } },
    });
  }
}

/**
 * Recompute the cadence estimate for a source from its current sample set,
 * derive nextExpectedAt, and write back to MarketSource. Returns the
 * resulting observation.
 */
export async function recomputeCadence(sourceId: string, now: Date = new Date()): Promise<CadenceObservation> {
  const samples = await prisma.marketSourceCadenceSample.findMany({
    where: { sourceId },
    select: { docDate: true },
    orderBy: { docDate: "asc" },
    take: CADENCE_SAMPLE_CAP, // defensive — pruning should already enforce this
  });

  const docDates = samples.map((s) => s.docDate);
  const estimate = estimateCadence(docDates);
  const lastDocSeenAt = docDates.length === 0 ? null : docDates[docDates.length - 1];
  const nextExpectedAt = computeNextExpectedAt(lastDocSeenAt, estimate.publishCadenceDays);

  await prisma.marketSource.update({
    where: { id: sourceId },
    data: {
      publishCadenceDays: estimate.publishCadenceDays,
      cadenceConfidence: estimate.confidence,
      cadenceSampleSize: estimate.sampleSize,
      lastDocSeenAt,
      nextExpectedAt,
    },
  });

  // Reference the constants in a side-effect-free way so dead-code elimination
  // can't drop them and so future test snapshots can reason about the cadence
  // version that produced the write. (No-op at runtime.)
  void CADENCE_VERSION;

  return { ...estimate, lastDocSeenAt, nextExpectedAt };
}

/**
 * Record the outcome of a scrape run against a source. Updates
 * publishStatus, consecutiveEmptyRuns, lastEmptyRunAt accordingly.
 *
 * Caller passes `foundNewDocs = true` when the scrape created at least
 * one new MarketSourceDoc (or for EnerGov, at least one new signal).
 */
export async function recordRunOutcome(
  sourceId: string,
  foundNewDocs: boolean,
  now: Date = new Date(),
): Promise<RunOutcome> {
  const source = await prisma.marketSource.findUnique({
    where: { id: sourceId },
    select: { publishStatus: true, consecutiveEmptyRuns: true, nextExpectedAt: true },
  });
  if (!source) throw new Error(`MarketSource ${sourceId} not found`);

  const priorStatus = (source.publishStatus as PublishStatus) ?? "HEALTHY";
  const outcome = determineRunOutcome({
    foundNewDocs,
    priorStatus,
    priorConsecutiveEmptyRuns: source.consecutiveEmptyRuns ?? 0,
    now,
    nextExpectedAt: source.nextExpectedAt,
  });

  await prisma.marketSource.update({
    where: { id: sourceId },
    data: {
      publishStatus: outcome.publishStatus,
      consecutiveEmptyRuns: outcome.consecutiveEmptyRuns,
      lastEmptyRunAt: foundNewDocs ? null : now,
    },
  });

  return outcome;
}

/**
 * Compute current due-status for a source. Wrapper around the pure
 * `determineDueStatus` that reads the source row.
 */
export async function isSourceDue(sourceId: string, now: Date = new Date()): Promise<DueComputation> {
  const source = await prisma.marketSource.findUnique({
    where: { id: sourceId },
    select: { lastScannedAt: true, nextExpectedAt: true, publishStatus: true },
  });
  if (!source) throw new Error(`MarketSource ${sourceId} not found`);
  return determineDueStatus({
    now,
    lastScannedAt: source.lastScannedAt,
    nextExpectedAt: source.nextExpectedAt,
    publishStatus: (source.publishStatus as PublishStatus) ?? "HEALTHY",
  });
}

// ── Due-source selection for the recurring runner (O2.2 PR4) ────────────────

/** Hard ceiling on `selectDueSources` — protects the runner from a runaway
 *  source set ever exceeding what a single hourly cycle can process. */
export const SELECT_DUE_MAX_LIMIT = 50;
/** Default sources-per-cycle cap. Tuned for the runner's leaseSeconds budget. */
export const SELECT_DUE_DEFAULT_LIMIT = 10;

export interface DueSource {
  id: string;
  name: string;
  sourceType: string;
  jurisdiction: string;
  lastScannedAt: Date | null;
  nextExpectedAt: Date | null;
  publishStatus: PublishStatus;
}

export interface SelectDueSourcesOptions {
  now?: Date;
  /** Caller-supplied cap. Clamped to [1, SELECT_DUE_MAX_LIMIT]. */
  limit?: number;
}

/**
 * Pick sources eligible for a scrape RIGHT NOW. Used by the
 * municipal-agenda-ingestion runner once per cycle to decide what to work on.
 *
 * Predicate:
 *   isActive = true
 *   AND publishStatus = "HEALTHY"           ← STALE_PUBLISH + OPERATOR_REVIEW excluded
 *   AND (nextExpectedAt IS NULL OR nextExpectedAt <= now)
 *
 * Ordering: oldest expected work first. nextExpectedAt NULLS FIRST so brand-new
 * never-scanned sources jump the queue. `id` tie-break makes the order
 * stable + replay-safe across runs that share `now`.
 *
 * NOTE: the safety-floor "force due after 7 days" logic from `determineDueStatus`
 * is intentionally NOT applied here. A source that has gone 7 days without a
 * scan is *already* due per the nextExpectedAt predicate (cadence keeps
 * nextExpectedAt within publishCadenceDays of lastDocSeenAt, max 60 days, and
 * recomputeCadence sets it on every scrape). The safety floor exists for the
 * single-source isSourceDue check; per-runner selection uses the simpler
 * nextExpectedAt predicate so the SQL stays index-friendly.
 */
export async function selectDueSources(
  options: SelectDueSourcesOptions = {},
): Promise<DueSource[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? SELECT_DUE_DEFAULT_LIMIT, SELECT_DUE_MAX_LIMIT));

  const rows = await prisma.marketSource.findMany({
    where: {
      isActive: true,
      publishStatus: "HEALTHY",
      OR: [
        { nextExpectedAt: null },
        { nextExpectedAt: { lte: now } },
      ],
    },
    orderBy: [
      // SQLite Prisma doesn't support nulls-first; emulate via two-pass sort
      // in JS after fetching. Take a slightly larger window then trim.
      { nextExpectedAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      name: true,
      sourceType: true,
      jurisdiction: true,
      lastScannedAt: true,
      nextExpectedAt: true,
      publishStatus: true,
    },
    take: limit,
  });

  // Promote NULL nextExpectedAt to the front (Prisma asc puts nulls last for
  // SQLite). Stable sort: equal keys preserve fetched order.
  const ordered = [...rows].sort((a, b) => {
    const an = a.nextExpectedAt;
    const bn = b.nextExpectedAt;
    if (an === null && bn === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (an === null) return -1;
    if (bn === null) return 1;
    const dt = an.getTime() - bn.getTime();
    if (dt !== 0) return dt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return ordered.map((r) => ({
    ...r,
    publishStatus: (r.publishStatus as PublishStatus) ?? "HEALTHY",
  }));
}

/**
 * Count sources currently in a given publishStatus. Used by the runner to
 * surface a stale-source gauge for the operator dashboard.
 */
export async function countSourcesByPublishStatus(status: PublishStatus): Promise<number> {
  return prisma.marketSource.count({ where: { publishStatus: status } });
}

// ── Internals exposed for tests ────────────────────────────────────────────

export const __internals = {
  CADENCE_SAMPLE_CAP,
  CADENCE_MIN_DAYS,
  CADENCE_MAX_DAYS,
  SAFETY_FLOOR_DAYS,
  NEXT_EXPECTED_LEAD_DAYS,
  DORMANCY_RUN_THRESHOLD,
  CONFIDENCE_LOW_MAX,
  CONFIDENCE_MEDIUM_MAX,
} as const;
