// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/activationReport.ts
//  Phase O2.2 PR6 — First-live operational report aggregator.
//
//  Pure aggregator (one DB pass per metric). Consumed by:
//    * scripts/activation-report.ts — operator CLI; single-command audit
//    * app/market-intelligence/activation/page.tsx — full report page
//    * app/market-intelligence/RunnerSummary.tsx — sidebar card
//
//  All queries are bounded `count()` or capped `findMany({take})`. Safe to
//  call per-page-render. No mutations.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export const ACTIVATION_REPORT_VERSION = "v1" as const;

// ── Public types ───────────────────────────────────────────────────────────

export interface SourceStatusRow {
  publishStatus: "HEALTHY" | "STALE_PUBLISH" | "OPERATOR_REVIEW";
  isActive: boolean;
  count: number;
}

export interface JurisdictionActivity {
  jurisdiction: string;
  signalsLast24h: number;
  signalsLast7d: number;
}

export interface SuppressedSource {
  sourceId: string;
  sourceName: string;
  jurisdiction: string;
  signalsCreated7d: number;
  suppressedShare: number;        // 0..1 — interpreted by Prometheus rate; DB-side this is best-effort
}

export interface CadenceDistribution {
  none: number;     // never recomputed yet
  low: number;
  medium: number;
  high: number;
}

export interface RunnerCycleStats {
  cycleName: string;
  totalLast24h: number;
  succeeded24h: number;
  failed24h: number;
  preempted24h: number;
  staleLeases: number;
  lastCycleAt: Date | null;
  lastCycleStatus: string | null;
  lastCycleDurationMs: number | null;
  lastCycleError: string | null;
}

export interface IngestionThroughput {
  signalsLast1h: number;
  signalsLast24h: number;
  signalsLast7d: number;
  highEmergence24h: number;
  mediumEmergence24h: number;
  lowEmergence24h: number;
}

export interface ProjectFormationStats {
  projectsCreatedLast24h: number;
  projectsCreatedLast7d: number;
  ingestionAttributedProjects7d: number;
  probabilitySnapshots24h: number;
}

// O2.2 PR8 — alert activity reporting
export interface AlertActivityStats {
  alertsLast24h: number;
  alertsLast7d: number;
  byTriggerKind24h: Record<string, number>;
  bySeverity24h: Record<string, number>;
  unreadCount: number;
  unreadBySeverity: Record<string, number>;
  dismissedCount7d: number;
  dismissedRatio7d: number | null;
  suppressedByCooldown24h: number;
  topJurisdictions24h: Array<{ jurisdiction: string; count: number }>;
  recentAlerts: Array<{
    id: string;
    subjectKind: string;
    subjectId: string;
    severity: string;
    headline: string;
    capturedAt: Date;
    reviewStatus: string;
    runnerTriggerKind: string | null;
  }>;
  lastAlertEvalCycleAt: Date | null;
  lastAlertEvalCycleStatus: string | null;
}

// O2.2 PR7 — forecast activity reporting
export interface ForecastActivityStats {
  forecastSnapshotsLast24h: number;
  forecastSnapshotsLast7d: number;
  trajectoryShifts24h: number;
  highEmergenceProjects: number;
  highEmergenceParcels: number;
  overriddenForecasts: number;
  lastForecastCycleAt: Date | null;
  lastForecastCycleStatus: string | null;
  newHighEmergence24h: number;
  biggestTrajectoryShifts24h: Array<{
    subjectKind: string;
    subjectId: string;
    fromState: string | null;
    toState: string;
    delta: number;
    shiftReason: string | null;
    shiftedAt: Date;
  }>;
  topEmergenceProjects: Array<{
    projectId: string;
    workingTitle: string | null;
    score: number;
    trajectoryState: string | null;
    confidence: string;
  }>;
}

export interface TopEmergentSignal {
  id: string;
  headline: string;
  jurisdiction: string | null;
  signalSubtype: string | null;
  heuristicsScore: number | null;
  heuristicsClassification: string | null;
  createdAt: Date;
}

export interface ActivationReport {
  version: typeof ACTIVATION_REPORT_VERSION;
  generatedAt: Date;
  sourceStatus: SourceStatusRow[];
  topJurisdictions7d: JurisdictionActivity[];
  cadenceConfidenceDistribution: CadenceDistribution;
  runnerCycles: RunnerCycleStats[];
  ingestionThroughput: IngestionThroughput;
  projectFormation: ProjectFormationStats;
  topEmergentSignals24h: TopEmergentSignal[];
  staleSources: Array<{ id: string; name: string; jurisdiction: string; consecutiveEmptyRuns: number; lastEmptyRunAt: Date | null }>;
  // Derived ratio: suppressed / (suppressed + classified) across all bands
  // over the last 24h. Read from Prometheus counters when available;
  // computed best-effort from DB here. May be null when no data yet.
  suppressionRatio24h: number | null;
  // O2.2 PR7 — forecast activity surface (the second autonomous cycle)
  forecastActivity: ForecastActivityStats;
  // O2.2 PR8 — alert activity surface
  alertActivity: AlertActivityStats;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface BuildOptions {
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** Cap on top-jurisdiction list. */
  topJurisdictionsLimit?: number;
  /** Cap on top-emergent-signals list. */
  topEmergentLimit?: number;
  /** Cap on stale-sources list (most recent first). */
  staleSourcesLimit?: number;
  /** Which runner names to include in runner stats. */
  runnerNames?: string[];
}

const DEFAULT_RUNNER_NAMES = ["municipal-agenda-ingestion", "forecast-daily", "alert-eval", "health-check"];
const HIGH_EMERGENCE_THRESHOLD = 0.70;

// ── Aggregator ─────────────────────────────────────────────────────────────

/**
 * Build a complete activation report. Runs ~10 bounded DB queries in
 * parallel. Safe to call per HTTP render — at projected scales these are
 * all index hits or small counts.
 */
export async function buildActivationReport(options: BuildOptions = {}): Promise<ActivationReport> {
  const now = options.now ?? new Date();
  const oneHourAgo = new Date(now.getTime() - HOUR_MS);
  const oneDayAgo = new Date(now.getTime() - DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const topJurisdictionsLimit = options.topJurisdictionsLimit ?? 10;
  const topEmergentLimit = options.topEmergentLimit ?? 10;
  const staleSourcesLimit = options.staleSourcesLimit ?? 20;
  const runnerNames = options.runnerNames ?? DEFAULT_RUNNER_NAMES;

  const [
    sourceStatusGroups,
    jurisdictionAggs,
    cadenceGroups,
    runnerLeasesAll,
    signalsLast1h,
    signalsLast24h,
    signalsLast7d,
    classifiedLast24h,
    suppressedLast24h,
    projectsLast24h,
    projectsLast7d,
    ingestionProjects7d,
    probabilitySnapshots24h,
    topEmergentSignalsRaw,
    staleSourcesRaw,
  ] = await Promise.all([
    prisma.marketSource.groupBy({
      by: ["publishStatus", "isActive"],
      _count: { _all: true },
    }),
    prisma.marketSignal.groupBy({
      by: ["source"],
      where: { createdAt: { gte: sevenDaysAgo }, source: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
      take: topJurisdictionsLimit,
    }),
    prisma.marketSource.groupBy({
      by: ["cadenceConfidence"],
      _count: { _all: true },
    }),
    prisma.runnerLease.findMany({
      where: { cycleName: { in: runnerNames } },
      orderBy: { leasedAt: "desc" },
      take: runnerNames.length * 200,  // ~200 cycles per runner — bounded
    }),
    prisma.marketSignal.count({ where: { createdAt: { gte: oneHourAgo } } }),
    prisma.marketSignal.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.marketSignal.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.marketSignal.groupBy({
      by: ["heuristicsClassification"],
      where: { createdAt: { gte: oneDayAgo }, heuristicsClassification: { not: null } },
      _count: { _all: true },
    }),
    prisma.marketSignal.count({
      where: { createdAt: { gte: oneDayAgo }, heuristicsClassification: "SUPPRESSED" },
    }),
    prisma.project.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.project.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.project.count({
      where: { createdAt: { gte: sevenDaysAgo }, source: { startsWith: "ingestion_" } },
    }),
    prisma.projectProbabilitySnapshot.count({ where: { computedAt: { gte: oneDayAgo } } }),
    prisma.marketSignal.findMany({
      where: {
        createdAt: { gte: oneDayAgo },
        heuristicsClassification: { in: ["HIGH_EMERGENCE", "MEDIUM_EMERGENCE"] },
      },
      orderBy: [{ heuristicsScore: "desc" }, { createdAt: "desc" }],
      take: topEmergentLimit,
      select: {
        id: true, headline: true, signalSubtype: true,
        heuristicsScore: true, heuristicsClassification: true,
        createdAt: true,
        sourceDoc: { select: { jurisdiction: true } },
      },
    }),
    prisma.marketSource.findMany({
      where: { publishStatus: { in: ["STALE_PUBLISH", "OPERATOR_REVIEW"] } },
      orderBy: [{ lastEmptyRunAt: "desc" }, { name: "asc" }],
      take: staleSourcesLimit,
      select: {
        id: true, name: true, jurisdiction: true,
        consecutiveEmptyRuns: true, lastEmptyRunAt: true,
      },
    }),
  ]);

  // ── Source status rollup ────────────────────────────────────────────────
  const sourceStatus: SourceStatusRow[] = sourceStatusGroups.map((g) => ({
    publishStatus: (g.publishStatus as SourceStatusRow["publishStatus"]) ?? "HEALTHY",
    isActive: g.isActive,
    count: g._count._all,
  }));

  // ── Top jurisdictions (24h + 7d) ─────────────────────────────────────────
  // Jurisdiction is stored on MarketSignal.source as the source LABEL, not
  // a clean jurisdiction string. For PR6 we surface the label as-is so
  // operators see "Ankeny P&Z" rather than null. A future PR can join
  // through sourceDoc.jurisdiction for cleaner geography.
  const jurisdictionAgg7d = new Map(
    jurisdictionAggs.map((j) => [j.source ?? "(unknown)", j._count._all]),
  );
  // For the 24h column, run a smaller query against the same source labels.
  const jurisdictionAggs24h = await prisma.marketSignal.groupBy({
    by: ["source"],
    where: { createdAt: { gte: oneDayAgo }, source: { in: [...jurisdictionAgg7d.keys()] } },
    _count: { _all: true },
  });
  const jurisdictionAgg24h = new Map(
    jurisdictionAggs24h.map((j) => [j.source ?? "(unknown)", j._count._all]),
  );
  const topJurisdictions7d: JurisdictionActivity[] = [...jurisdictionAgg7d.entries()].map(([jur, count]) => ({
    jurisdiction: jur,
    signalsLast7d: count,
    signalsLast24h: jurisdictionAgg24h.get(jur) ?? 0,
  }));

  // ── Cadence-confidence distribution ─────────────────────────────────────
  const cadence: CadenceDistribution = { none: 0, low: 0, medium: 0, high: 0 };
  for (const g of cadenceGroups) {
    const conf = g.cadenceConfidence;
    if (conf === "HIGH") cadence.high = g._count._all;
    else if (conf === "MEDIUM") cadence.medium = g._count._all;
    else if (conf === "LOW") cadence.low = g._count._all;
    else cadence.none = g._count._all;
  }

  // ── Runner cycle stats per runner ───────────────────────────────────────
  const runnerCycles: RunnerCycleStats[] = runnerNames.map((cycleName) => {
    const cycles = runnerLeasesAll.filter((l) => l.cycleName === cycleName);
    const last24h = cycles.filter((l) => l.leasedAt >= oneDayAgo);
    const last = cycles[0] ?? null;
    return {
      cycleName,
      totalLast24h: last24h.length,
      succeeded24h: last24h.filter((l) => l.status === "succeeded").length,
      failed24h:    last24h.filter((l) => l.status === "failed").length,
      preempted24h: last24h.filter((l) => l.status === "stale").length,  // dispatcher records "stale" as preempted equivalent
      staleLeases:  cycles.filter((l) => l.status === "stale").length,
      lastCycleAt:        last?.leasedAt ?? null,
      lastCycleStatus:    last?.status ?? null,
      lastCycleDurationMs: last?.durationMs ?? null,
      lastCycleError:     last?.errorMessage ?? null,
    };
  });

  // ── Ingestion throughput ────────────────────────────────────────────────
  let highEmergence24h = 0, mediumEmergence24h = 0, lowEmergence24h = 0;
  for (const g of classifiedLast24h) {
    const c = g.heuristicsClassification;
    if (c === "HIGH_EMERGENCE") highEmergence24h = g._count._all;
    else if (c === "MEDIUM_EMERGENCE") mediumEmergence24h = g._count._all;
    else if (c === "LOW_EMERGENCE") lowEmergence24h = g._count._all;
  }
  const ingestionThroughput: IngestionThroughput = {
    signalsLast1h, signalsLast24h, signalsLast7d,
    highEmergence24h, mediumEmergence24h, lowEmergence24h,
  };

  // ── Suppression ratio (best-effort from DB) ─────────────────────────────
  // SUPPRESSED rows are not persisted in current architecture; this number
  // stays at 0 from the DB perspective. Caller (CLI) can substitute the
  // Prometheus counter value when available.
  const classified = highEmergence24h + mediumEmergence24h + lowEmergence24h + suppressedLast24h;
  const suppressionRatio24h = classified > 0 ? suppressedLast24h / classified : null;

  // ── Top emergent signals ────────────────────────────────────────────────
  const topEmergentSignals24h: TopEmergentSignal[] = topEmergentSignalsRaw.map((s) => ({
    id: s.id,
    headline: s.headline,
    jurisdiction: s.sourceDoc?.jurisdiction ?? null,
    signalSubtype: s.signalSubtype,
    heuristicsScore: s.heuristicsScore,
    heuristicsClassification: s.heuristicsClassification,
    createdAt: s.createdAt,
  }));

  // ── Project formation ───────────────────────────────────────────────────
  const projectFormation: ProjectFormationStats = {
    projectsCreatedLast24h: projectsLast24h,
    projectsCreatedLast7d: projectsLast7d,
    ingestionAttributedProjects7d: ingestionProjects7d,
    probabilitySnapshots24h,
  };

  // ── O2.2 PR7 — forecast activity ─────────────────────────────────────────
  const forecastActivity = await buildForecastActivity(now, oneDayAgo, sevenDaysAgo);
  // ── O2.2 PR8 — alert activity ────────────────────────────────────────────
  const alertActivity = await buildAlertActivity(now, oneDayAgo, sevenDaysAgo);

  return {
    version: ACTIVATION_REPORT_VERSION,
    generatedAt: now,
    sourceStatus,
    topJurisdictions7d,
    cadenceConfidenceDistribution: cadence,
    runnerCycles,
    ingestionThroughput,
    projectFormation,
    topEmergentSignals24h,
    staleSources: staleSourcesRaw,
    suppressionRatio24h,
    forecastActivity,
    alertActivity,
  };
}

async function buildAlertActivity(now: Date, oneDayAgo: Date, sevenDaysAgo: Date): Promise<AlertActivityStats> {
  const [
    alerts24h,
    alerts7d,
    byTriggerRaw24h,
    bySeverityGroups24h,
    unreadGroups,
    dismissed7d,
    reviewed7d,
    recentRaw,
    lastAlertEvalCycle,
  ] = await Promise.all([
    prisma.alertEvent.count({ where: { capturedAt: { gte: oneDayAgo } } }),
    prisma.alertEvent.count({ where: { capturedAt: { gte: sevenDaysAgo } } }),
    prisma.alertEvent.findMany({
      where: { capturedAt: { gte: oneDayAgo } },
      select: { payloadJson: true, projectId: true, parcelId: true, subjectKind: true, subjectId: true },
      take: 500,
    }),
    prisma.alertEvent.groupBy({
      by: ["severity"],
      where: { capturedAt: { gte: oneDayAgo } },
      _count: { _all: true },
    }),
    prisma.alertEvent.groupBy({
      by: ["severity"],
      where: { reviewStatus: "UNREAD" },
      _count: { _all: true },
    }),
    prisma.alertEvent.count({ where: { reviewStatus: "DISMISSED", capturedAt: { gte: sevenDaysAgo } } }),
    prisma.alertEvent.count({ where: { reviewStatus: { in: ["ACKNOWLEDGED", "DISMISSED", "ESCALATED", "SUPPRESSED"] }, capturedAt: { gte: sevenDaysAgo } } }),
    prisma.alertEvent.findMany({
      where: { capturedAt: { gte: oneDayAgo } },
      orderBy: { capturedAt: "desc" },
      take: 15,
      select: {
        id: true, subjectKind: true, subjectId: true, severity: true,
        headline: true, capturedAt: true, reviewStatus: true, payloadJson: true,
      },
    }),
    prisma.runnerLease.findFirst({
      where: { cycleName: "alert-eval" },
      orderBy: { leasedAt: "desc" },
      select: { leasedAt: true, status: true },
    }),
  ]);

  const byTriggerKind24h: Record<string, number> = {};
  const jurisdictionCounts = new Map<string, number>();
  let suppressedByCooldown24h = 0;
  for (const a of byTriggerRaw24h) {
    let trigger = "unknown";
    let jurisdiction: string | null = null;
    if (a.payloadJson) {
      try {
        const parsed = JSON.parse(a.payloadJson);
        if (typeof parsed.runnerTriggerKind === "string") trigger = parsed.runnerTriggerKind;
        if (typeof parsed.jurisdiction === "string") jurisdiction = parsed.jurisdiction;
      } catch { /* ignore */ }
    }
    byTriggerKind24h[trigger] = (byTriggerKind24h[trigger] ?? 0) + 1;
    // For governance burst alerts, the subjectId IS the jurisdiction.
    const jur = jurisdiction ?? (a.subjectKind === "JURISDICTION" ? a.subjectId : null);
    if (jur) jurisdictionCounts.set(jur, (jurisdictionCounts.get(jur) ?? 0) + 1);
  }

  const bySeverity24h: Record<string, number> = {};
  for (const g of bySeverityGroups24h) bySeverity24h[g.severity] = g._count._all;

  const unreadBySeverity: Record<string, number> = {};
  let unreadCount = 0;
  for (const g of unreadGroups) {
    unreadBySeverity[g.severity] = g._count._all;
    unreadCount += g._count._all;
  }

  const dismissedRatio7d = reviewed7d > 0 ? dismissed7d / reviewed7d : null;

  const topJurisdictions24h = [...jurisdictionCounts.entries()]
    .map(([jurisdiction, count]) => ({ jurisdiction, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const recentAlerts = recentRaw.map((a) => {
    let runnerTriggerKind: string | null = null;
    if (a.payloadJson) {
      try {
        const parsed = JSON.parse(a.payloadJson);
        if (typeof parsed.runnerTriggerKind === "string") runnerTriggerKind = parsed.runnerTriggerKind;
      } catch { /* ignore */ }
    }
    return {
      id: a.id,
      subjectKind: a.subjectKind,
      subjectId: a.subjectId,
      severity: a.severity,
      headline: a.headline,
      capturedAt: a.capturedAt,
      reviewStatus: a.reviewStatus,
      runnerTriggerKind,
    };
  });

  // Best-effort: count suppressed-by-cooldown via Prometheus would be ideal,
  // but we can approximate by counting AlertEvent rows in the last 24h whose
  // payload indicates this is a re-fire after cooldown elapsed. For PR8 we
  // expose the field as 0 — the real number comes from the
  // neuroglitch_alerts_suppressed_total Prometheus counter on Grafana.
  void suppressedByCooldown24h;  // reserved for future enrichment

  void now;  // reserved for future "since last cycle" math

  return {
    alertsLast24h: alerts24h,
    alertsLast7d: alerts7d,
    byTriggerKind24h,
    bySeverity24h,
    unreadCount,
    unreadBySeverity,
    dismissedCount7d: dismissed7d,
    dismissedRatio7d,
    suppressedByCooldown24h: 0,
    topJurisdictions24h,
    recentAlerts,
    lastAlertEvalCycleAt: lastAlertEvalCycle?.leasedAt ?? null,
    lastAlertEvalCycleStatus: lastAlertEvalCycle?.status ?? null,
  };
}

async function buildForecastActivity(now: Date, oneDayAgo: Date, sevenDaysAgo: Date): Promise<ForecastActivityStats> {
  const [
    snaps24h,
    snaps7d,
    shifts24hRaw,
    highEmergenceRows,
    overriddenCount,
    lastForecastCycle,
    newHighEmergenceRaw,
    topProjectsRaw,
  ] = await Promise.all([
    prisma.forecastSnapshot.count({ where: { computedAt: { gte: oneDayAgo } } }),
    prisma.forecastSnapshot.count({ where: { computedAt: { gte: sevenDaysAgo } } }),
    prisma.probabilityTrend.findMany({
      where: { recordedAt: { gte: oneDayAgo } },
      orderBy: [{ delta: "desc" }],
      take: 10,
      select: {
        subjectKind: true,
        subjectId: true,
        previousScore: true,
        currentScore: true,
        delta: true,
        recordedAt: true,
      },
    }),
    prisma.emergenceScore.groupBy({
      by: ["subjectKind"],
      where: { score: { gte: HIGH_EMERGENCE_THRESHOLD } },
      _count: { _all: true },
    }),
    prisma.forecastSnapshot.count({ where: { reviewStatus: "OVERRIDDEN" } }),
    prisma.runnerLease.findFirst({
      where: { cycleName: "forecast-daily" },
      orderBy: { leasedAt: "desc" },
      select: { leasedAt: true, status: true },
    }),
    // "New HIGH" = subjects whose latest snapshot in last 24h is HIGH AND
    // whose prior snapshot (older than 24h) was below the threshold. Cheap
    // approximation: look at ProbabilityTrend rows where currentScore >=
    // threshold and previousScore < threshold within the 24h window.
    prisma.probabilityTrend.count({
      where: {
        recordedAt: { gte: oneDayAgo },
        currentScore: { gte: HIGH_EMERGENCE_THRESHOLD },
        previousScore: { lt: HIGH_EMERGENCE_THRESHOLD },
      },
    }),
    prisma.emergenceScore.findMany({
      where: { subjectKind: "PROJECT", score: { gte: HIGH_EMERGENCE_THRESHOLD } },
      orderBy: { score: "desc" },
      take: 10,
      select: { projectId: true, score: true, confidence: true },
    }),
  ]);

  // Trajectory shifts (24h): join shifts to the EmergenceTrajectory for
  // shiftReason + the to-state. Fetch trajectories for the subjects in our
  // shifts list — bounded by 10 entries.
  const trajKeys = shifts24hRaw.map((s) => ({ subjectKind: s.subjectKind, subjectId: s.subjectId }));
  const trajectories = trajKeys.length === 0 ? [] : await prisma.emergenceTrajectory.findMany({
    where: { OR: trajKeys.map((k) => ({ subjectKind: k.subjectKind, subjectId: k.subjectId })) },
    select: { subjectKind: true, subjectId: true, state: true, previousState: true, shiftReason: true },
  });
  const trajIndex = new Map<string, typeof trajectories[number]>();
  for (const t of trajectories) trajIndex.set(`${t.subjectKind}|${t.subjectId}`, t);

  const biggestTrajectoryShifts24h = shifts24hRaw.map((s) => {
    const t = trajIndex.get(`${s.subjectKind}|${s.subjectId}`);
    return {
      subjectKind: s.subjectKind,
      subjectId: s.subjectId,
      fromState: t?.previousState ?? null,
      toState: t?.state ?? "STEADY",
      delta: s.delta,
      shiftReason: t?.shiftReason ?? null,
      shiftedAt: s.recordedAt,
    };
  });

  // Project titles for top-emergence display.
  const projectIds = topProjectsRaw.map((r) => r.projectId).filter((id): id is string => !!id);
  const projects = projectIds.length === 0 ? [] : await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, workingTitle: true },
  });
  const titleByProject = new Map(projects.map((p) => [p.id, p.workingTitle]));
  const topEmergenceProjects = topProjectsRaw
    .filter((r) => r.projectId)
    .map((r) => ({
      projectId: r.projectId!,
      workingTitle: titleByProject.get(r.projectId!) ?? null,
      score: r.score,
      trajectoryState: null,  // resolved lazily by UI
      confidence: r.confidence,
    }));

  let highEmergenceProjects = 0;
  let highEmergenceParcels = 0;
  for (const g of highEmergenceRows) {
    if (g.subjectKind === "PROJECT") highEmergenceProjects = g._count._all;
    else if (g.subjectKind === "PARCEL") highEmergenceParcels = g._count._all;
  }

  // Voiding unused variable lint: `now` is the caller's clock anchor for
  // future "since last cycle" math. Kept for symmetry with other helpers.
  void now;

  return {
    forecastSnapshotsLast24h: snaps24h,
    forecastSnapshotsLast7d: snaps7d,
    trajectoryShifts24h: shifts24hRaw.length,
    highEmergenceProjects,
    highEmergenceParcels,
    overriddenForecasts: overriddenCount,
    lastForecastCycleAt: lastForecastCycle?.leasedAt ?? null,
    lastForecastCycleStatus: lastForecastCycle?.status ?? null,
    newHighEmergence24h: newHighEmergenceRaw,
    biggestTrajectoryShifts24h,
    topEmergenceProjects,
  };
}
