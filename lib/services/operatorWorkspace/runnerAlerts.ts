// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/runnerAlerts.ts
//  Phase O2.2 PR8 — Runner-driven alert detectors + fingerprint + cooldown.
//
//  This module ships nine deterministic detectors used by the alert-eval
//  runner (PR8). Each detector queries existing DB tables, produces a list
//  of AlertCandidate objects, and the runner persists them via the existing
//  MI-10 recordAlertEvent helper.
//
//  Hard rules:
//    * NO new ontology, NO new tables, NO new ML.
//    * NO AI-generated severity — see alertSeverityNormalize.ts.
//    * NO autonomous messaging (no email/SMS/webhook). AlertEvent rows only;
//      delivery is operator-pull via the workspace UI.
//    * Pure detectors take a context bag of DB readers + a `now` clock so
//      tests can pin determinism.
//    * Cooldown is enforced PER (subjectKind, subjectId, runnerTriggerKind)
//      via the existing AlertEvent table — no new schema. Fingerprint is
//      written into AlertEvent.payloadJson and queried via Prisma `contains`.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { recordAlertEvent } from "./alerts";
import {
  type NormalizedAlertSeverity,
  pickHigherSeverity,
} from "./alertSeverityNormalize";

export const RUNNER_ALERTS_VERSION = "v1" as const;

// ── Trigger taxonomy (runner-driven; orthogonal to AlertRule.triggerKind) ──

export const RUNNER_TRIGGER_KINDS = [
  "NEW_HIGH_EMERGENCE",
  "TRAJECTORY_SHIFT_TO_ACCELERATING",
  "TRAJECTORY_SHIFT_TO_DECAYING",
  "STALE_RECOVERY",
  "RECURRING_DEVELOPER",
  "GOVERNANCE_BURST",
  "FORECAST_OVERRIDE",
  "SOURCE_DEGRADATION",
  "SUPPRESSION_ANOMALY",
] as const;
export type RunnerTriggerKind = (typeof RUNNER_TRIGGER_KINDS)[number];

// ── Defaults (versioned with RUNNER_ALERTS_VERSION) ────────────────────────

interface DetectorConfig {
  defaultSeverity: NormalizedAlertSeverity;
  cooldownMinutes: number;
}

const DETECTOR_CONFIG: Readonly<Record<RunnerTriggerKind, DetectorConfig>> = Object.freeze({
  NEW_HIGH_EMERGENCE:                { defaultSeverity: "IMPORTANT", cooldownMinutes: 24 * 60 },
  TRAJECTORY_SHIFT_TO_ACCELERATING:  { defaultSeverity: "IMPORTANT", cooldownMinutes: 24 * 60 },
  TRAJECTORY_SHIFT_TO_DECAYING:      { defaultSeverity: "WATCH",     cooldownMinutes: 48 * 60 },
  STALE_RECOVERY:                    { defaultSeverity: "WATCH",     cooldownMinutes: 48 * 60 },
  RECURRING_DEVELOPER:               { defaultSeverity: "WATCH",     cooldownMinutes: 7 * 24 * 60 },
  GOVERNANCE_BURST:                  { defaultSeverity: "IMPORTANT", cooldownMinutes: 24 * 60 },
  FORECAST_OVERRIDE:                 { defaultSeverity: "INFO",      cooldownMinutes: 24 * 60 },
  SOURCE_DEGRADATION:                { defaultSeverity: "INFO",      cooldownMinutes: 7 * 24 * 60 },
  SUPPRESSION_ANOMALY:               { defaultSeverity: "WATCH",     cooldownMinutes: 24 * 60 },
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;
const HIGH_EMERGENCE_THRESHOLD = 0.70;
const GOVERNANCE_SUBTYPES = new Set<string>([
  "CODE_ADOPTION", "ORDINANCE_CHANGE", "ZONING_REWRITE", "DENSITY_EXPANSION",
  "TIF_APPROVAL", "MORATORIUM", "INFRASTRUCTURE_FUNDING",
]);

// ── Public types ────────────────────────────────────────────────────────────

export interface AlertCandidate {
  triggerKind: RunnerTriggerKind;
  subjectKind: string;
  subjectId: string;
  projectId: string | null;
  parcelId: string | null;
  severity: NormalizedAlertSeverity;
  headline: string;
  detail: string;
  /** Per-row factor breakdown — written to AlertExplanation rows. */
  factors: Array<{
    factorKind: "EVIDENCE" | "FORECAST_DELTA" | "CALIBRATION_CONTEXT" | "UNCERTAINTY" | "RECOMMENDATION" | "OTHER";
    factorName: string;
    factorScore: number | null;
    rationale: string;
  }>;
  capturedScore: number | null;
  capturedTrajectory: string | null;
  /** Linked entities/parcels/projects + recent signal references. Serialized
   *  into AlertEvent.payloadJson alongside the fingerprint + prior-history
   *  block built by `persistRunnerAlert`. */
  payload: Record<string, unknown>;
}

export interface RunnerAlertContext {
  /** Clock for deterministic tests. */
  now?: Date;
  /** Operator pre-flight `dryRun=true` skips persistence + just returns
   *  candidates. The runner uses this in shadow-mode debugging. */
  dryRun?: boolean;
  /** Hard cap on alerts persisted per cycle. Defense against runaway
   *  detectors. Defaults to 200. */
  maxPersistsPerCycle?: number;
}

export interface RunnerAlertSummary {
  candidatesProduced: Record<RunnerTriggerKind, number>;
  candidatesSuppressedByCooldown: Record<RunnerTriggerKind, number>;
  alertsPersisted: Record<RunnerTriggerKind, number>;
  persistedBySeverity: Record<NormalizedAlertSeverity, number>;
  errors: Array<{ triggerKind: RunnerTriggerKind; error: string }>;
}

// ── Fingerprint + cooldown ─────────────────────────────────────────────────

/** Stable identifier for "this alert is about the same thing" — used for
 *  the cooldown lookup against existing AlertEvent rows. Deterministic. */
export function buildFingerprint(
  triggerKind: RunnerTriggerKind,
  subjectKind: string,
  subjectId: string,
): string {
  return `${triggerKind}|${subjectKind}|${subjectId}`;
}

interface PayloadWithFingerprint {
  runnerTriggerKind: RunnerTriggerKind;
  fingerprint: string;
  runnerAlertsVersion: typeof RUNNER_ALERTS_VERSION;
  [k: string]: unknown;
}

function isFingerprintInPayload(payload: unknown, fingerprint: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  return (payload as Record<string, unknown>).fingerprint === fingerprint;
}

/** Was there an AlertEvent with this fingerprint within cooldownMinutes?
 *  Uses Prisma `contains` on payloadJson for a server-side filter; final
 *  in-memory check against the decoded JSON guarantees no false positives
 *  from incidental substring matches. */
export async function isInCooldown(
  fingerprint: string,
  cooldownMinutes: number,
  subjectKind: string,
  subjectId: string,
  now: Date,
): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;
  const cutoff = new Date(now.getTime() - cooldownMinutes * 60 * 1000);
  const rows = await prisma.alertEvent.findMany({
    where: {
      subjectKind,
      subjectId,
      capturedAt: { gte: cutoff },
      payloadJson: { contains: `"fingerprint":"${fingerprint}"` },
    },
    select: { payloadJson: true },
    take: 5,
  });
  for (const r of rows) {
    if (!r.payloadJson) continue;
    try {
      const parsed = JSON.parse(r.payloadJson);
      if (isFingerprintInPayload(parsed, fingerprint)) return true;
    } catch {
      // Malformed JSON in payloadJson is rare; safest is to NOT treat as a
      // cooldown hit (false-negative loses one dedup; false-positive loses
      // a legitimate alert).
    }
  }
  return false;
}

// ── Prior-history enrichment (explainability) ──────────────────────────────

interface PriorHistorySummary {
  priorAlertCount30d: number;
  lastAlertAt: Date | null;
  priorTriggerKindCounts: Record<string, number>;
}

async function buildPriorHistory(
  subjectKind: string,
  subjectId: string,
  now: Date,
): Promise<PriorHistorySummary> {
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await prisma.alertEvent.findMany({
    where: { subjectKind, subjectId, capturedAt: { gte: cutoff } },
    select: { capturedAt: true, payloadJson: true },
    orderBy: { capturedAt: "desc" },
    take: 50,
  });
  let lastAlertAt: Date | null = null;
  const priorTriggerKindCounts: Record<string, number> = {};
  for (const r of rows) {
    if (!lastAlertAt) lastAlertAt = r.capturedAt;
    if (!r.payloadJson) continue;
    try {
      const parsed = JSON.parse(r.payloadJson);
      const kind = typeof parsed.runnerTriggerKind === "string" ? parsed.runnerTriggerKind : "unknown";
      priorTriggerKindCounts[kind] = (priorTriggerKindCounts[kind] ?? 0) + 1;
    } catch {
      priorTriggerKindCounts.unknown = (priorTriggerKindCounts.unknown ?? 0) + 1;
    }
  }
  return {
    priorAlertCount30d: rows.length,
    lastAlertAt,
    priorTriggerKindCounts,
  };
}

// ── Detectors ──────────────────────────────────────────────────────────────

/** Detect subjects whose latest ProbabilityTrend crossed into HIGH-emergence
 *  band (currentScore ≥ 0.70 AND previousScore < 0.70) within the window. */
export async function detectNewHighEmergence(now: Date, windowMs = DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.probabilityTrend.findMany({
    where: {
      recordedAt: { gte: cutoff },
      currentScore: { gte: HIGH_EMERGENCE_THRESHOLD },
      previousScore: { lt: HIGH_EMERGENCE_THRESHOLD },
    },
    select: {
      subjectKind: true, subjectId: true,
      projectId: true, parcelId: true,
      previousScore: true, currentScore: true, delta: true,
      snapshotId: true, recordedAt: true,
    },
    orderBy: { delta: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    triggerKind: "NEW_HIGH_EMERGENCE" as const,
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    projectId: r.projectId,
    parcelId: r.parcelId,
    severity: "IMPORTANT" as NormalizedAlertSeverity,
    headline: `New HIGH emergence: ${r.currentScore.toFixed(2)} (Δ ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)})`,
    detail: `${r.subjectKind} ${r.subjectId} crossed the HIGH-emergence threshold (≥ 0.70). Previous score ${r.previousScore.toFixed(2)} → ${r.currentScore.toFixed(2)}.`,
    factors: [
      { factorKind: "FORECAST_DELTA", factorName: "previous_score", factorScore: r.previousScore, rationale: `previous score ${r.previousScore.toFixed(3)}` },
      { factorKind: "FORECAST_DELTA", factorName: "current_score",  factorScore: r.currentScore,  rationale: `current score ${r.currentScore.toFixed(3)} ≥ threshold ${HIGH_EMERGENCE_THRESHOLD}` },
      { factorKind: "FORECAST_DELTA", factorName: "delta",          factorScore: r.delta,         rationale: `Δ ${r.delta.toFixed(3)}` },
    ],
    capturedScore: r.currentScore,
    capturedTrajectory: null,
    payload: {
      snapshotId: r.snapshotId,
      recordedAt: r.recordedAt.toISOString(),
      previousScore: r.previousScore,
      currentScore: r.currentScore,
      delta: r.delta,
    },
  }));
}

/** Detect EmergenceTrajectory rows that transitioned INTO an acceleration
 *  state (IGNITING / ACCELERATING) within the window. */
export async function detectTrajectoryShiftToAccelerating(now: Date, windowMs = DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.emergenceTrajectory.findMany({
    where: {
      state: { in: ["IGNITING", "ACCELERATING"] },
      stateEnteredAt: { gte: cutoff },
    },
    select: {
      subjectKind: true, subjectId: true,
      projectId: true, parcelId: true,
      state: true, previousState: true,
      acceleration: true, shortTermDelta: true, longTermDelta: true,
      shiftReason: true, stateEnteredAt: true,
    },
    orderBy: { stateEnteredAt: "desc" },
    take: 100,
  });

  return rows.map((r) => {
    const severity: NormalizedAlertSeverity = r.state === "IGNITING" ? "IMPORTANT" : "WATCH";
    return {
      triggerKind: "TRAJECTORY_SHIFT_TO_ACCELERATING" as const,
      subjectKind: r.subjectKind,
      subjectId: r.subjectId,
      projectId: r.projectId,
      parcelId: r.parcelId,
      severity: pickHigherSeverity(severity, DETECTOR_CONFIG.TRAJECTORY_SHIFT_TO_ACCELERATING.defaultSeverity),
      headline: `Trajectory → ${r.state} (${r.previousState ?? "—"} → ${r.state})`,
      detail: `${r.subjectKind} ${r.subjectId} entered ${r.state}. Acceleration ${r.acceleration.toFixed(3)}. ${r.shiftReason ?? ""}`.trim(),
      factors: [
        { factorKind: "FORECAST_DELTA", factorName: "trajectory_to",     factorScore: null,             rationale: `state=${r.state}` },
        { factorKind: "FORECAST_DELTA", factorName: "acceleration",      factorScore: r.acceleration,   rationale: `acceleration=${r.acceleration.toFixed(3)}` },
        { factorKind: "FORECAST_DELTA", factorName: "short_term_delta",  factorScore: r.shortTermDelta, rationale: `30d Δ ${r.shortTermDelta.toFixed(3)}` },
        { factorKind: "FORECAST_DELTA", factorName: "long_term_delta",   factorScore: r.longTermDelta,  rationale: `180d Δ ${r.longTermDelta.toFixed(3)}` },
      ],
      capturedScore: null,
      capturedTrajectory: r.state,
      payload: {
        previousState: r.previousState,
        currentState: r.state,
        acceleration: r.acceleration,
        shiftReason: r.shiftReason,
        stateEnteredAt: r.stateEnteredAt.toISOString(),
      },
    };
  });
}

/** Detect EmergenceTrajectory rows that transitioned INTO DECAYING /
 *  STALLED / DORMANT from a non-decay state within the window. */
export async function detectTrajectoryShiftToDecaying(now: Date, windowMs = DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.emergenceTrajectory.findMany({
    where: {
      state: { in: ["DECAYING", "STALLED", "DORMANT"] },
      stateEnteredAt: { gte: cutoff },
      previousState: { notIn: ["DECAYING", "STALLED", "DORMANT"] },
    },
    select: {
      subjectKind: true, subjectId: true, projectId: true, parcelId: true,
      state: true, previousState: true, acceleration: true,
      stateEnteredAt: true,
    },
    orderBy: { stateEnteredAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    triggerKind: "TRAJECTORY_SHIFT_TO_DECAYING" as const,
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    projectId: r.projectId,
    parcelId: r.parcelId,
    severity: "WATCH" as NormalizedAlertSeverity,
    headline: `Trajectory → ${r.state} (was ${r.previousState ?? "—"})`,
    detail: `${r.subjectKind} ${r.subjectId} entered ${r.state}. Acceleration ${r.acceleration.toFixed(3)}.`,
    factors: [
      { factorKind: "FORECAST_DELTA", factorName: "trajectory_to",   factorScore: null,           rationale: `state=${r.state}` },
      { factorKind: "FORECAST_DELTA", factorName: "trajectory_from", factorScore: null,           rationale: `previous=${r.previousState ?? "—"}` },
      { factorKind: "FORECAST_DELTA", factorName: "acceleration",    factorScore: r.acceleration, rationale: `acceleration=${r.acceleration.toFixed(3)}` },
    ],
    capturedScore: null,
    capturedTrajectory: r.state,
    payload: {
      previousState: r.previousState,
      currentState: r.state,
      acceleration: r.acceleration,
      stateEnteredAt: r.stateEnteredAt.toISOString(),
    },
  }));
}

/** Detect "stale recovery" — subjects that were DORMANT / STALLED and are
 *  now EMERGING / ACCELERATING / IGNITING within the window. */
export async function detectStaleRecovery(now: Date, windowMs = DAY_MS * 2): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.emergenceTrajectory.findMany({
    where: {
      state: { in: ["EMERGING", "ACCELERATING", "IGNITING"] },
      previousState: { in: ["DORMANT", "STALLED"] },
      stateEnteredAt: { gte: cutoff },
    },
    select: {
      subjectKind: true, subjectId: true, projectId: true, parcelId: true,
      state: true, previousState: true, acceleration: true,
      stateEnteredAt: true,
    },
    orderBy: { stateEnteredAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    triggerKind: "STALE_RECOVERY" as const,
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    projectId: r.projectId,
    parcelId: r.parcelId,
    severity: "WATCH" as NormalizedAlertSeverity,
    headline: `Stale recovery: ${r.previousState} → ${r.state}`,
    detail: `${r.subjectKind} ${r.subjectId} reactivated from ${r.previousState} to ${r.state}.`,
    factors: [
      { factorKind: "FORECAST_DELTA", factorName: "recovery_from", factorScore: null, rationale: `was ${r.previousState}` },
      { factorKind: "FORECAST_DELTA", factorName: "recovery_to",   factorScore: null, rationale: `now ${r.state}` },
    ],
    capturedScore: null,
    capturedTrajectory: r.state,
    payload: {
      previousState: r.previousState,
      currentState: r.state,
      stateEnteredAt: r.stateEnteredAt.toISOString(),
    },
  }));
}

/** Detect operator forecast overrides within the window. INFO severity —
 *  operator awareness, not urgency. */
export async function detectForecastOverride(now: Date, windowMs = DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.forecastSnapshot.findMany({
    where: { reviewStatus: "OVERRIDDEN", computedAt: { gte: cutoff } },
    select: {
      id: true, subjectKind: true, subjectId: true, projectId: true, parcelId: true,
      emergenceScore: true, overrideReason: true,
      overriddenByEmail: true, computedAt: true,
    },
    orderBy: { computedAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    triggerKind: "FORECAST_OVERRIDE" as const,
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    projectId: r.projectId,
    parcelId: r.parcelId,
    severity: "INFO" as NormalizedAlertSeverity,
    headline: `Forecast override: score=${r.emergenceScore.toFixed(2)}`,
    detail: `${r.subjectKind} ${r.subjectId} was operator-overridden${r.overriddenByEmail ? ` by ${r.overriddenByEmail}` : ""}. Reason: ${r.overrideReason ?? "—"}.`,
    factors: [
      { factorKind: "OTHER", factorName: "override_reason", factorScore: null, rationale: r.overrideReason ?? "(no reason given)" },
    ],
    capturedScore: r.emergenceScore,
    capturedTrajectory: null,
    payload: {
      forecastSnapshotId: r.id,
      overriddenByEmail: r.overriddenByEmail,
      overrideReason: r.overrideReason,
      computedAt: r.computedAt.toISOString(),
    },
  }));
}

/** Detect MarketSources that newly transitioned to STALE_PUBLISH within the
 *  window. */
export async function detectSourceDegradation(now: Date, windowMs = DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.marketSource.findMany({
    where: {
      publishStatus: "STALE_PUBLISH",
      lastEmptyRunAt: { gte: cutoff },
    },
    select: {
      id: true, name: true, jurisdiction: true,
      consecutiveEmptyRuns: true, lastEmptyRunAt: true,
    },
    orderBy: { lastEmptyRunAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    triggerKind: "SOURCE_DEGRADATION" as const,
    subjectKind: "MARKET_SOURCE",
    subjectId: r.id,
    projectId: null,
    parcelId: null,
    severity: "INFO" as NormalizedAlertSeverity,
    headline: `Source dormant: ${r.name}`,
    detail: `${r.jurisdiction} — ${r.name} flipped to STALE_PUBLISH after ${r.consecutiveEmptyRuns} consecutive empty runs.`,
    factors: [
      { factorKind: "EVIDENCE", factorName: "empty_run_count", factorScore: r.consecutiveEmptyRuns, rationale: `${r.consecutiveEmptyRuns} consecutive empty runs` },
    ],
    capturedScore: null,
    capturedTrajectory: null,
    payload: {
      sourceName: r.name,
      jurisdiction: r.jurisdiction,
      consecutiveEmptyRuns: r.consecutiveEmptyRuns,
      lastEmptyRunAt: r.lastEmptyRunAt?.toISOString() ?? null,
    },
  }));
}

/** Detect suppression anomalies — 24h SUPPRESSED count > 2× rolling 7-day
 *  average AND > absolute floor (50). */
export async function detectSuppressionAnomaly(now: Date): Promise<AlertCandidate[]> {
  const cutoff24h = new Date(now.getTime() - DAY_MS);
  const cutoff8d  = new Date(now.getTime() - 8 * DAY_MS);

  const [last24h, prior7d] = await Promise.all([
    prisma.marketSignal.count({
      where: {
        heuristicsClassification: "SUPPRESSED",
        createdAt: { gte: cutoff24h },
      },
    }),
    prisma.marketSignal.count({
      where: {
        heuristicsClassification: "SUPPRESSED",
        createdAt: { gte: cutoff8d, lt: cutoff24h },
      },
    }),
  ]);

  const dailyAvg = prior7d / 7;
  if (last24h <= 50) return [];
  if (last24h <= dailyAvg * 2) return [];

  return [{
    triggerKind: "SUPPRESSION_ANOMALY" as const,
    subjectKind: "PLATFORM",
    subjectId: "suppression-monitor",
    projectId: null,
    parcelId: null,
    severity: "WATCH" as NormalizedAlertSeverity,
    headline: `Suppression spike: ${last24h} in 24h (avg ${dailyAvg.toFixed(0)}/day)`,
    detail: `Suppressed-signal count in last 24h (${last24h}) exceeds 2× the rolling 7-day average (${dailyAvg.toFixed(1)}).`,
    factors: [
      { factorKind: "EVIDENCE", factorName: "suppressed_24h",     factorScore: last24h,  rationale: `${last24h} suppressions in last 24h` },
      { factorKind: "EVIDENCE", factorName: "rolling_avg_7d",     factorScore: dailyAvg, rationale: `${dailyAvg.toFixed(1)}/day average over prior 7d` },
    ],
    capturedScore: null,
    capturedTrajectory: null,
    payload: { last24h, prior7d, dailyAvg },
  }];
}

/** Detect governance-burst — multiple governance-subtype signals from the
 *  same jurisdiction in 24h. */
export async function detectGovernanceBurst(now: Date, windowMs = DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.marketSignal.findMany({
    where: {
      createdAt: { gte: cutoff },
      signalSubtype: { in: [...GOVERNANCE_SUBTYPES] },
    },
    select: {
      id: true, signalSubtype: true, headline: true,
      sourceDoc: { select: { jurisdiction: true } },
    },
    take: 500,
  });

  // Group by jurisdiction.
  const byJurisdiction = new Map<string, { count: number; subtypes: Set<string>; sampleIds: string[] }>();
  for (const r of rows) {
    const jur = r.sourceDoc?.jurisdiction;
    if (!jur) continue;
    let bucket = byJurisdiction.get(jur);
    if (!bucket) {
      bucket = { count: 0, subtypes: new Set(), sampleIds: [] };
      byJurisdiction.set(jur, bucket);
    }
    bucket.count += 1;
    if (r.signalSubtype) bucket.subtypes.add(r.signalSubtype);
    if (bucket.sampleIds.length < 5) bucket.sampleIds.push(r.id);
  }

  const out: AlertCandidate[] = [];
  for (const [jurisdiction, b] of byJurisdiction) {
    if (b.count < 3) continue;  // burst threshold
    out.push({
      triggerKind: "GOVERNANCE_BURST",
      subjectKind: "JURISDICTION",
      subjectId: jurisdiction,
      projectId: null,
      parcelId: null,
      severity: "IMPORTANT",
      headline: `${jurisdiction}: ${b.count} governance signals in 24h`,
      detail: `${b.count} governance-subtype signals in last 24h (${[...b.subtypes].join(", ")}).`,
      factors: [
        { factorKind: "EVIDENCE", factorName: "burst_count",         factorScore: b.count,    rationale: `${b.count} governance signals in 24h` },
        { factorKind: "EVIDENCE", factorName: "distinct_subtypes",   factorScore: b.subtypes.size, rationale: `subtypes: ${[...b.subtypes].join(", ")}` },
      ],
      capturedScore: null,
      capturedTrajectory: null,
      payload: {
        burstCount: b.count,
        distinctSubtypes: [...b.subtypes],
        sampleSignalIds: b.sampleIds,
      },
    });
  }
  return out;
}

/** Detect developers/actors appearing across ≥ 3 distinct doc-tied signals
 *  in last 7 days. Uses MarketSignal.metadata.owner_name. */
export async function detectRecurringDeveloper(now: Date, windowMs = 7 * DAY_MS): Promise<AlertCandidate[]> {
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.marketSignal.findMany({
    where: { createdAt: { gte: cutoff }, metadata: { not: null } },
    select: { id: true, metadata: true, sourceDocId: true },
    take: 2000,
  });

  const byActor = new Map<string, { displayName: string; docs: Set<string>; signalIds: string[] }>();
  for (const r of rows) {
    if (!r.metadata || !r.sourceDocId) continue;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(r.metadata);
    } catch { continue; }
    const owner = typeof meta.owner_name === "string" ? meta.owner_name : null;
    const dev   = typeof meta.developer_name === "string" ? meta.developer_name : null;
    const display = owner ?? dev;
    if (!display) continue;
    const key = display.trim().toLowerCase().replace(/\b(llc|inc|corp|company|the|holdings|partners|group|llp|ltd)\b/g, "").replace(/[^a-z0-9]+/g, "");
    if (!key) continue;
    let bucket = byActor.get(key);
    if (!bucket) {
      bucket = { displayName: display, docs: new Set(), signalIds: [] };
      byActor.set(key, bucket);
    }
    bucket.docs.add(r.sourceDocId);
    if (bucket.signalIds.length < 10) bucket.signalIds.push(r.id);
  }

  const out: AlertCandidate[] = [];
  for (const [key, b] of byActor) {
    if (b.docs.size < 3) continue;
    out.push({
      triggerKind: "RECURRING_DEVELOPER",
      subjectKind: "DEVELOPER",
      subjectId: key,
      projectId: null,
      parcelId: null,
      severity: "WATCH",
      headline: `Recurring actor: ${b.displayName} (${b.docs.size} meetings/7d)`,
      detail: `"${b.displayName}" appears in ${b.docs.size} distinct source documents in the last 7 days.`,
      factors: [
        { factorKind: "EVIDENCE", factorName: "distinct_docs",    factorScore: b.docs.size, rationale: `${b.docs.size} distinct sourceDocIds` },
        { factorKind: "EVIDENCE", factorName: "signal_count",     factorScore: b.signalIds.length, rationale: `${b.signalIds.length} signals reference this actor` },
      ],
      capturedScore: null,
      capturedTrajectory: null,
      payload: {
        displayName: b.displayName,
        distinctDocCount: b.docs.size,
        sampleSignalIds: b.signalIds,
      },
    });
  }
  return out;
}

// ── Persistence (cooldown + recordAlertEvent) ──────────────────────────────

export interface PersistRunnerAlertResult {
  persisted: boolean;
  suppressedReason?: "cooldown" | "dry_run";
  alertId?: string;
  fingerprint: string;
}

/** Persist a single candidate via recordAlertEvent, after cooldown check.
 *  Enriches payloadJson with fingerprint + prior history. */
export async function persistRunnerAlert(
  candidate: AlertCandidate,
  cooldownMinutes: number,
  now: Date,
  dryRun: boolean,
): Promise<PersistRunnerAlertResult> {
  const fingerprint = buildFingerprint(candidate.triggerKind, candidate.subjectKind, candidate.subjectId);

  if (await isInCooldown(fingerprint, cooldownMinutes, candidate.subjectKind, candidate.subjectId, now)) {
    return { persisted: false, suppressedReason: "cooldown", fingerprint };
  }
  if (dryRun) {
    return { persisted: false, suppressedReason: "dry_run", fingerprint };
  }

  const priorHistory = await buildPriorHistory(candidate.subjectKind, candidate.subjectId, now);
  const enrichedPayload: PayloadWithFingerprint = {
    runnerTriggerKind: candidate.triggerKind,
    fingerprint,
    runnerAlertsVersion: RUNNER_ALERTS_VERSION,
    priorHistory: {
      priorAlertCount30d: priorHistory.priorAlertCount30d,
      lastAlertAt: priorHistory.lastAlertAt?.toISOString() ?? null,
      priorTriggerKindCounts: priorHistory.priorTriggerKindCounts,
    },
    ...candidate.payload,
  };

  // O2.2 PR8: the PR8 normalized bands (INFO / WATCH / IMPORTANT / CRITICAL)
  // are deliberately wider than the legacy AlertSeverity type. The DB column
  // accepts any string; we widen here at the boundary rather than redesigning
  // the MI-10 enum. Cast preserves type safety up to this single point.
  const result = await recordAlertEvent({
    ruleId: null,
    subjectKind: candidate.subjectKind,
    subjectId: candidate.subjectId,
    projectId: candidate.projectId,
    parcelId: candidate.parcelId,
    severity: candidate.severity as unknown as Parameters<typeof recordAlertEvent>[0]["severity"],
    headline: candidate.headline,
    detail: candidate.detail,
    capturedScore: candidate.capturedScore,
    capturedTrajectory: candidate.capturedTrajectory,
    factors: candidate.factors,
    payload: enrichedPayload,
  });

  return { persisted: true, alertId: result.id, fingerprint };
}

// ── Detector-config accessor (used by runner + tests) ──────────────────────

export function detectorConfig(kind: RunnerTriggerKind): DetectorConfig {
  return DETECTOR_CONFIG[kind];
}

export function emptySummary(): RunnerAlertSummary {
  const candidatesProduced = {} as Record<RunnerTriggerKind, number>;
  const candidatesSuppressedByCooldown = {} as Record<RunnerTriggerKind, number>;
  const alertsPersisted = {} as Record<RunnerTriggerKind, number>;
  for (const k of RUNNER_TRIGGER_KINDS) {
    candidatesProduced[k] = 0;
    candidatesSuppressedByCooldown[k] = 0;
    alertsPersisted[k] = 0;
  }
  return {
    candidatesProduced,
    candidatesSuppressedByCooldown,
    alertsPersisted,
    persistedBySeverity: { INFO: 0, WATCH: 0, IMPORTANT: 0, CRITICAL: 0 },
    errors: [],
  };
}

// ── Detector registry — used by alertEval runner ───────────────────────────

export const DETECTORS: ReadonlyArray<{
  kind: RunnerTriggerKind;
  run: (now: Date) => Promise<AlertCandidate[]>;
}> = Object.freeze([
  { kind: "NEW_HIGH_EMERGENCE",                run: (now) => detectNewHighEmergence(now) },
  { kind: "TRAJECTORY_SHIFT_TO_ACCELERATING",  run: (now) => detectTrajectoryShiftToAccelerating(now) },
  { kind: "TRAJECTORY_SHIFT_TO_DECAYING",      run: (now) => detectTrajectoryShiftToDecaying(now) },
  { kind: "STALE_RECOVERY",                    run: (now) => detectStaleRecovery(now) },
  { kind: "FORECAST_OVERRIDE",                 run: (now) => detectForecastOverride(now) },
  { kind: "SOURCE_DEGRADATION",                run: (now) => detectSourceDegradation(now) },
  { kind: "SUPPRESSION_ANOMALY",               run: (now) => detectSuppressionAnomaly(now) },
  { kind: "GOVERNANCE_BURST",                  run: (now) => detectGovernanceBurst(now) },
  { kind: "RECURRING_DEVELOPER",               run: (now) => detectRecurringDeveloper(now) },
]);

export const __internals = {
  HIGH_EMERGENCE_THRESHOLD,
  GOVERNANCE_SUBTYPES,
  DETECTOR_CONFIG,
} as const;
