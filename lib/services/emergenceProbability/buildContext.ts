// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/buildContext.ts
//  Phase O2.2 PR7 — Forecast subject context assembly.
//
//  The forecast.ts scorer wants a fully-built ForecastSubjectContext. Prior
//  to PR7 there was NO exported helper that turned a `(subjectKind, subjectId)`
//  pair into one — callers had to assemble the context themselves (only the
//  backfill batch path did this internally and it wasn't reused). PR7 extracts
//  that gather logic into a single bounded-query function so the new
//  forecast-daily runner can use it.
//
//  Hard rules:
//    * Conservative — fields without an obvious DB source default to safe
//      "no information" values (0, false, null, []). The MI-8 heuristics
//      already handle nulls + zeros gracefully (see heuristics.ts).
//    * Bounded — every findMany has an explicit `take:` cap.
//    * One pass per data type. No N+1.
//    * Pure with respect to MI-8: does NOT mutate any forecast/score row.
//      Reads only.
//    * Does NOT redesign MI-8: only assembles the existing
//      ForecastSubjectContext interface that has lived in types.ts since v1.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { ForecastSubjectContext, SubjectKind } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

/** Maximum signals to pull per window — bounds the query for ultra-busy
 *  subjects without changing the count() result. */
const MAX_SIGNAL_PULL = 1000;

export interface BuildContextOptions {
  /** Override "now" for deterministic tests. */
  now?: Date;
}

/**
 * Build a ForecastSubjectContext for a given subject. The forecast-daily
 * runner calls this once per subject per cycle.
 *
 * Returns `null` only when the subject row doesn't exist (deleted between
 * subject-selection and context-build). All other "no data" cases yield a
 * partially-populated context with safe defaults — the heuristics handle
 * those gracefully.
 */
export async function buildForecastSubjectContext(
  subjectKind: SubjectKind,
  subjectId: string,
  options: BuildContextOptions = {},
): Promise<ForecastSubjectContext | null> {
  const now = options.now ?? new Date();
  const cutoff30  = new Date(now.getTime() - 30  * DAY_MS);
  const cutoff90  = new Date(now.getTime() - 90  * DAY_MS);
  const cutoff365 = new Date(now.getTime() - 365 * DAY_MS);

  if (subjectKind === "PROJECT") {
    return buildProjectContext(subjectId, { now, cutoff30, cutoff90, cutoff365 });
  }
  if (subjectKind === "PARCEL") {
    return buildParcelContext(subjectId, { now, cutoff30, cutoff90, cutoff365 });
  }
  // SubjectKind today is just PROJECT | PARCEL; SUBJECT_KINDS in types.ts may
  // add more. Unknown kinds get a noop null — runner will skip + warn.
  return null;
}

// ── Project path ────────────────────────────────────────────────────────────

interface WindowBounds {
  now: Date;
  cutoff30: Date;
  cutoff90: Date;
  cutoff365: Date;
}

async function buildProjectContext(projectId: string, w: WindowBounds): Promise<ForecastSubjectContext | null> {
  const [project, latestProb, probSnap30, probSnap90, probSnap365, signal30, signal90, signal365, entities, parcelLinks, lastSignal] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, jurisdiction: true,
        emergenceProbability: true, lastSignalAt: true,
        reviewStatus: true,
      },
    }),
    prisma.projectProbabilitySnapshot.findFirst({
      where: { projectId },
      orderBy: { computedAt: "desc" },
      select: { probability: true },
    }),
    prisma.projectProbabilitySnapshot.findMany({
      where: { projectId, computedAt: { gte: w.cutoff30 } },
      select: { probability: true },
      take: MAX_SIGNAL_PULL,
    }),
    prisma.projectProbabilitySnapshot.findMany({
      where: { projectId, computedAt: { gte: w.cutoff90 } },
      select: { probability: true },
      take: MAX_SIGNAL_PULL,
    }),
    prisma.projectProbabilitySnapshot.findMany({
      where: { projectId, computedAt: { gte: w.cutoff365 } },
      select: { probability: true },
      take: MAX_SIGNAL_PULL,
    }),
    prisma.projectSignal.count({
      where: { projectId, attachedAt: { gte: w.cutoff30 }, detachedAt: null },
    }),
    prisma.projectSignal.count({
      where: { projectId, attachedAt: { gte: w.cutoff90 }, detachedAt: null },
    }),
    prisma.projectSignal.count({
      where: { projectId, attachedAt: { gte: w.cutoff365 }, detachedAt: null },
    }),
    prisma.projectEntity.findMany({
      where: { projectId, removed: false },
      select: { entityId: true, role: true },
      take: MAX_SIGNAL_PULL,
    }),
    prisma.projectParcel.findMany({
      where: { projectId },
      select: { canonicalParcelId: true },
      take: MAX_SIGNAL_PULL,
    }),
    prisma.projectSignal.findFirst({
      where: { projectId, detachedAt: null },
      orderBy: { attachedAt: "desc" },
      select: { attachedAt: true },
    }),
  ]);

  if (!project) return null;

  // Derive parcel pressure mean from linked parcels' latest pressure snapshots.
  let latestParcelPressureMean: number | null = null;
  const linkedParcelIds = parcelLinks.map((p) => p.canonicalParcelId).filter((id): id is string => !!id);
  if (linkedParcelIds.length > 0) {
    const pressures = await prisma.parcelPressureSnapshot.findMany({
      where: { parcelId: { in: linkedParcelIds } },
      orderBy: { computedAt: "desc" },
      take: linkedParcelIds.length * 2,
      select: { parcelId: true, pressureScore: true },
    });
    // Pick latest per parcel.
    const latestByParcel = new Map<string, number>();
    for (const p of pressures) {
      if (!latestByParcel.has(p.parcelId)) latestByParcel.set(p.parcelId, p.pressureScore);
    }
    if (latestByParcel.size > 0) {
      const vals = [...latestByParcel.values()];
      latestParcelPressureMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  const developerEntityIds = entities
    .filter((e) => isDeveloperRole(e.role))
    .map((e) => e.entityId);
  const brokerEntityIds = entities
    .filter((e) => isBrokerRole(e.role))
    .map((e) => e.entityId);

  const latestSignalAt = lastSignal?.attachedAt ?? project.lastSignalAt ?? null;
  const daysSinceLastSignal = latestSignalAt
    ? Math.floor((w.now.getTime() - latestSignalAt.getTime()) / DAY_MS)
    : 999_999;

  return {
    subjectKind: "PROJECT",
    subjectId: project.id,
    projectId: project.id,
    parcelId: null,
    jurisdictionKey: project.jurisdiction ?? null,
    latestProjectProbability: latestProb?.probability ?? project.emergenceProbability ?? null,
    latestParcelPressureMean,
    probabilityMean30d:  meanOrNull(probSnap30.map((s) => s.probability)),
    probabilityMean90d:  meanOrNull(probSnap90.map((s) => s.probability)),
    probabilityMean365d: meanOrNull(probSnap365.map((s) => s.probability)),
    signalCountLast30d:  signal30,
    signalCountLast90d:  signal90,
    signalCountLast365d: signal365,
    developerEntityIds,
    brokerEntityIds,
    // The remaining fields don't have a clean MI-6/MI-7 surface in PR7.
    // Default to safe "no information" values. Heuristics already handle
    // 0 / false / [] correctly per heuristics.ts.
    continuanceCount: 0,
    activeUtilityExpansions: 0,
    pressuredNeighborCount: 0,
    onCorridor: false,
    hasInfrastructureInvestment: false,
    daysSinceLastSignal,
    hasShellBuildingPattern: false,
  };
}

// ── Parcel path ─────────────────────────────────────────────────────────────

async function buildParcelContext(parcelId: string, w: WindowBounds): Promise<ForecastSubjectContext | null> {
  const [parcel, latestPressure, signal30, signal90, signal365, lastSignal] = await Promise.all([
    prisma.parcel.findUnique({
      where: { id: parcelId },
      select: { id: true, jurisdiction: true, reviewStatus: true },
    }),
    prisma.parcelPressureSnapshot.findFirst({
      where: { parcelId },
      orderBy: { computedAt: "desc" },
      select: { pressureScore: true },
    }),
    prisma.parcelSignal.count({
      where: { parcelId, lastObservedAt: { gte: w.cutoff30 } },
    }),
    prisma.parcelSignal.count({
      where: { parcelId, lastObservedAt: { gte: w.cutoff90 } },
    }),
    prisma.parcelSignal.count({
      where: { parcelId, lastObservedAt: { gte: w.cutoff365 } },
    }),
    prisma.parcelSignal.findFirst({
      where: { parcelId },
      orderBy: { lastObservedAt: "desc" },
      select: { lastObservedAt: true },
    }),
  ]);

  if (!parcel) return null;

  // Pressured-neighbor count: parcels adjacent to this one with their latest
  // ParcelPressureSnapshot.pressureScore >= 0.5. Bounded by reasonable
  // adjacency-count (most parcels have a handful of neighbors).
  let pressuredNeighborCount = 0;
  const adjacencies = await prisma.parcelAdjacency.findMany({
    where: { fromParcelId: parcelId },
    select: { toParcelId: true },
    take: 100,
  });
  if (adjacencies.length > 0) {
    const neighborIds = adjacencies.map((a) => a.toParcelId);
    const neighborPressures = await prisma.parcelPressureSnapshot.findMany({
      where: { parcelId: { in: neighborIds } },
      orderBy: { computedAt: "desc" },
      take: neighborIds.length * 2,
      select: { parcelId: true, pressureScore: true },
    });
    const latestByNeighbor = new Map<string, number>();
    for (const p of neighborPressures) {
      if (!latestByNeighbor.has(p.parcelId)) latestByNeighbor.set(p.parcelId, p.pressureScore);
    }
    for (const score of latestByNeighbor.values()) {
      if (score >= 0.5) pressuredNeighborCount += 1;
    }
  }

  const latestSignalAt = lastSignal?.lastObservedAt ?? null;
  const daysSinceLastSignal = latestSignalAt
    ? Math.floor((w.now.getTime() - latestSignalAt.getTime()) / DAY_MS)
    : 999_999;

  return {
    subjectKind: "PARCEL",
    subjectId: parcel.id,
    projectId: null,
    parcelId: parcel.id,
    jurisdictionKey: parcel.jurisdiction ?? null,
    latestProjectProbability: null,
    latestParcelPressureMean: latestPressure?.pressureScore ?? null,
    probabilityMean30d:  null,
    probabilityMean90d:  null,
    probabilityMean365d: null,
    signalCountLast30d:  signal30,
    signalCountLast90d:  signal90,
    signalCountLast365d: signal365,
    developerEntityIds: [],
    brokerEntityIds: [],
    continuanceCount: 0,
    activeUtilityExpansions: 0,
    pressuredNeighborCount,
    onCorridor: false,
    hasInfrastructureInvestment: false,
    daysSinceLastSignal,
    hasShellBuildingPattern: false,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function isDeveloperRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toUpperCase();
  return r === "DEVELOPER" || r === "OWNER";
}

function isBrokerRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role.toUpperCase() === "BROKER";
}

// ── Subject selection ──────────────────────────────────────────────────────

export interface ActiveForecastSubject {
  subjectKind: SubjectKind;
  subjectId: string;
}

export interface SelectActiveForecastSubjectsOptions {
  /** Max Projects to return. */
  projectLimit?: number;
  /** Max Parcels to return. */
  parcelLimit?: number;
  /** Skip projects/parcels with these reviewStatus values. */
  excludedReviewStatuses?: string[];
}

const DEFAULT_PROJECT_LIMIT = 5000;
const DEFAULT_PARCEL_LIMIT = 5000;
const DEFAULT_EXCLUDED_REVIEW_STATUSES = ["REJECTED", "MERGED"];

/**
 * Return all (PROJECT, projectId) + (PARCEL, parcelId) pairs that should be
 * included in a daily forecast recompute. Bounded, deterministic-ordered.
 *
 * Active = reviewStatus NOT IN ("REJECTED", "MERGED"). Subjects in those
 * end-states never receive new signal evidence, so re-forecasting them is
 * pure overhead.
 */
export async function selectActiveForecastSubjects(
  options: SelectActiveForecastSubjectsOptions = {},
): Promise<ActiveForecastSubject[]> {
  const projectLimit = options.projectLimit ?? DEFAULT_PROJECT_LIMIT;
  const parcelLimit  = options.parcelLimit  ?? DEFAULT_PARCEL_LIMIT;
  const excluded     = options.excludedReviewStatuses ?? DEFAULT_EXCLUDED_REVIEW_STATUSES;

  const [projects, parcels] = await Promise.all([
    prisma.project.findMany({
      where: { reviewStatus: { notIn: excluded } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: projectLimit,
    }),
    prisma.parcel.findMany({
      where: { reviewStatus: { notIn: excluded } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: parcelLimit,
    }),
  ]);

  const out: ActiveForecastSubject[] = [];
  for (const p of projects) out.push({ subjectKind: "PROJECT", subjectId: p.id });
  for (const p of parcels)  out.push({ subjectKind: "PARCEL",  subjectId: p.id });
  return out;
}

export const __internals = {
  MAX_SIGNAL_PULL,
  DEFAULT_PROJECT_LIMIT,
  DEFAULT_PARCEL_LIMIT,
  DEFAULT_EXCLUDED_REVIEW_STATUSES,
} as const;
