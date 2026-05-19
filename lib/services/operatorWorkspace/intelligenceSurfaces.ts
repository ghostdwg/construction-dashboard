// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/intelligenceSurfaces.ts
//  Phase MI-10 — Real-time intelligence surfaces.
//
//  Read-only feeds composed from existing intelligence tables (EmergenceScore,
//  EmergenceTrajectory, ProbabilityTrend, CorridorHeat, JurisdictionVelocity,
//  DevelopmentMomentum, ParcelPressureSnapshot, Outcome, MarketSignal).
//
//  Each surface is one query; no aggregation across surfaces happens here.
//  The workspace page composes the surfaces it needs.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { IntelligenceSurfaceItem, IntelligenceSurfaceResult } from "./types";

const DEFAULT_LIMIT = 25;
const DEFAULT_WINDOW_DAYS = 30;

function buildResult(
  surfaceKind: string,
  items: IntelligenceSurfaceItem[],
  windowDays: number,
  reasonLog: string[]
): IntelligenceSurfaceResult {
  return {
    surfaceKind,
    items,
    generatedAt: new Date(),
    windowDays,
    reasonLog,
  };
}

// ── Emerging now ─────────────────────────────────────────────────────────────
//
// Projects with EmergenceTrajectory state IGNITING or ACCELERATING and
// score ≥ 0.40, sorted by score desc.

export async function surfaceEmergingNow(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const trajectories = await prisma.emergenceTrajectory.findMany({
    where: { state: { in: ["IGNITING", "ACCELERATING"] } },
    take: limit,
    orderBy: { acceleration: "desc" },
  });
  const subjectIds = trajectories.map((t) => t.subjectId);
  const scores = subjectIds.length
    ? await prisma.emergenceScore.findMany({
        where: { subjectId: { in: subjectIds } },
      })
    : [];
  const scoreById = new Map(scores.map((s) => [`${s.subjectKind}:${s.subjectId}`, s]));

  const projectIds = trajectories
    .filter((t) => t.subjectKind === "PROJECT" && t.projectId != null)
    .map((t) => t.projectId as string);
  const projects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds } } })
    : [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const items: IntelligenceSurfaceItem[] = trajectories
    .map((t) => {
      const score = scoreById.get(`${t.subjectKind}:${t.subjectId}`);
      if (!score || score.score < 0.40) return null;
      const project = t.projectId ? projectById.get(t.projectId) : null;
      return {
        surfaceKind: "EMERGING_NOW",
        subjectKind: t.subjectKind,
        subjectId: t.subjectId,
        displayLabel: project?.workingTitle ?? `${t.subjectKind}/${t.subjectId.slice(0, 6)}`,
        displayContext: project?.jurisdiction ?? "—",
        score: score.score,
        scoreLabel: `${score.score.toFixed(2)} — ${score.confidence}`,
        trajectoryState: t.state,
        rationale: `state=${t.state} acceleration=${t.acceleration.toFixed(3)} streak=${t.streakLength}`,
        evidenceCount: 0,
        capturedAt: t.updatedAt,
        href: t.projectId ? `/market-intelligence/projects/${t.projectId}` : null,
      } as IntelligenceSurfaceItem;
    })
    .filter((x): x is IntelligenceSurfaceItem => x !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);

  return buildResult("EMERGING_NOW", items, DEFAULT_WINDOW_DAYS, [
    `trajectories_in_igniting_or_accelerating=${trajectories.length}`,
    `score_filtered=${items.length}`,
  ]);
}

// ── Accelerating corridors ───────────────────────────────────────────────────

export async function surfaceAcceleratingCorridors(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await prisma.corridorHeat.findMany({
    where: { classification: { in: ["IGNITING", "HOT"] } },
    take: limit,
    orderBy: [{ acceleration: "desc" }, { heatScore: "desc" }],
  });
  const items: IntelligenceSurfaceItem[] = rows.map((r) => ({
    surfaceKind: "ACCELERATING_CORRIDORS",
    subjectKind: "CORRIDOR",
    subjectId: r.corridorKey,
    displayLabel: r.corridorLabel,
    displayContext: `members=${r.activeMembers}`,
    score: r.heatScore,
    scoreLabel: `heat=${r.heatScore.toFixed(2)} (${r.classification})`,
    trajectoryState: null,
    rationale: `heat=${r.heatScore.toFixed(2)} accel=${r.acceleration.toFixed(2)} meanPressure=${r.meanPressure.toFixed(2)}`,
    evidenceCount: r.activeMembers,
    capturedAt: r.computedAt,
    href: `/market-intelligence/corridors?corridor=${encodeURIComponent(r.corridorKey)}`,
  }));
  return buildResult("ACCELERATING_CORRIDORS", items, DEFAULT_WINDOW_DAYS, [
    `corridors_hot_or_igniting=${rows.length}`,
  ]);
}

// ── Jurisdiction acceleration ────────────────────────────────────────────────

export async function surfaceJurisdictionAcceleration(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await prisma.jurisdictionVelocity.findMany({
    where: { cadenceClass: { in: ["HOT", "WARM"] } },
    take: limit,
    orderBy: [{ acceleration: "desc" }, { velocityScore: "desc" }],
  });
  const items: IntelligenceSurfaceItem[] = rows.map((r) => ({
    surfaceKind: "JURISDICTION_ACCELERATION",
    subjectKind: "JURISDICTION",
    subjectId: r.jurisdictionKey,
    displayLabel: r.jurisdictionLabel,
    displayContext: `projects(30d)=${r.newProjectsLast30d}, signals(30d)=${r.newSignalsLast30d}`,
    score: r.velocityScore,
    scoreLabel: `velocity=${r.velocityScore.toFixed(2)} (${r.cadenceClass})`,
    trajectoryState: null,
    rationale: `velocity=${r.velocityScore.toFixed(2)} accel=${r.acceleration.toFixed(2)} class=${r.cadenceClass}`,
    evidenceCount: r.newProjectsLast30d,
    capturedAt: r.computedAt,
    href: null,
  }));
  return buildResult("JURISDICTION_ACCELERATION", items, DEFAULT_WINDOW_DAYS, [
    `jurisdictions_hot_or_warm=${rows.length}`,
  ]);
}

// ── Repeated developer movement ──────────────────────────────────────────────

export async function surfaceRepeatedDeveloperMovement(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await prisma.developmentMomentum.findMany({
    where: { classification: { in: ["ACCELERATING", "SUSTAINED"] } },
    take: limit,
    orderBy: [{ momentumScore: "desc" }, { acceleration: "desc" }],
  });
  const items: IntelligenceSurfaceItem[] = rows.map((r) => ({
    surfaceKind: "REPEATED_DEVELOPER_MOVEMENT",
    subjectKind: "DEVELOPER",
    subjectId: r.developerEntityId,
    displayLabel: r.developerNameCache ?? r.developerEntityId.slice(0, 12),
    displayContext: `new30d=${r.newProjectsLast30d}, parc90d=${r.newParcelsLast90d}`,
    score: r.momentumScore,
    scoreLabel: `momentum=${r.momentumScore.toFixed(2)} (${r.classification})`,
    trajectoryState: null,
    rationale: `momentum=${r.momentumScore.toFixed(2)} accel=${r.acceleration.toFixed(2)} class=${r.classification}`,
    evidenceCount: r.newProjectsLast365d,
    capturedAt: r.computedAt,
    href: `/market-intelligence/entities?id=${encodeURIComponent(r.developerEntityId)}`,
  }));
  return buildResult("REPEATED_DEVELOPER_MOVEMENT", items, 90, [
    `developers_accelerating_or_sustained=${rows.length}`,
  ]);
}

// ── High-confidence forecasts ────────────────────────────────────────────────

export async function surfaceHighConfidenceForecasts(opts: { limit?: number; minScore?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minScore = opts.minScore ?? 0.70;
  const rows = await prisma.emergenceScore.findMany({
    where: { score: { gte: minScore }, confidence: "HIGH" },
    take: limit,
    orderBy: { score: "desc" },
  });
  const items: IntelligenceSurfaceItem[] = rows.map((r) => ({
    surfaceKind: "HIGH_CONFIDENCE_FORECASTS",
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    displayLabel: `${r.subjectKind}/${r.subjectId.slice(0, 6)}`,
    displayContext: "",
    score: r.score,
    scoreLabel: `${r.score.toFixed(2)} — ${r.confidence}`,
    trajectoryState: null,
    rationale: `score=${r.score.toFixed(2)} confidence=${r.confidence}`,
    evidenceCount: 0,
    capturedAt: r.latestComputedAt,
    href: r.projectId ? `/market-intelligence/projects/${r.projectId}` : null,
  }));
  return buildResult("HIGH_CONFIDENCE_FORECASTS", items, DEFAULT_WINDOW_DAYS, [
    `min_score=${minScore}`, `rows=${rows.length}`,
  ]);
}

// ── Timeline pull-in ─────────────────────────────────────────────────────────
//
// ExpectedTimeline rows whose expectedEstimate has moved INWARD vs the
// latestSnapshot context. Approximated here by selecting rows with
// expectedEstimate within the next 90 days and HIGH/MEDIUM confidence.

export async function surfaceTimelinePullIn(opts: { limit?: number; horizonDays?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const horizonDays = opts.horizonDays ?? 90;
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.expectedTimeline.findMany({
    where: {
      expectedEstimate: { gte: now, lte: horizon },
      confidence: { in: ["HIGH", "MEDIUM"] },
    },
    take: limit,
    orderBy: { expectedEstimate: "asc" },
  });
  const items: IntelligenceSurfaceItem[] = rows.map((r) => ({
    surfaceKind: "TIMELINE_PULL_IN",
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    displayLabel: `${r.subjectKind}/${r.subjectId.slice(0, 6)}: ${r.milestoneKind}`,
    displayContext: r.rationale ?? "",
    score: null,
    scoreLabel: r.confidence,
    trajectoryState: null,
    rationale: `expected=${r.expectedEstimate?.toISOString() ?? "null"} confidence=${r.confidence}`,
    evidenceCount: 0,
    capturedAt: r.latestComputedAt,
    href: r.projectId ? `/market-intelligence/projects/${r.projectId}` : null,
  }));
  return buildResult("TIMELINE_PULL_IN", items, horizonDays, [
    `horizon_days=${horizonDays}`, `rows=${rows.length}`,
  ]);
}

// ── Speculative shell activity ───────────────────────────────────────────────
//
// Parcels currently showing shell-building pattern via MI-7 spatial signals.
// Approximated here by selecting recent ParcelPressureSnapshot rows whose
// factorsJson contains the shell-cluster keyword.

export async function surfaceSpeculativeShell(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.parcelPressureSnapshot.findMany({
    where: {
      computedAt: { gte: cutoff },
      factorsJson: { contains: "shellClusterProximity" },
    },
    take: limit * 3, // fetch wider; many rows will not actually carry pattern
    orderBy: { computedAt: "desc" },
  });
  const filtered = rows.filter((r) => {
    try {
      const parsed = JSON.parse(r.factorsJson) as { factors?: { shellClusterProximity?: number } };
      return (parsed.factors?.shellClusterProximity ?? 0) > 0.3;
    } catch {
      return false;
    }
  }).slice(0, limit);
  const items: IntelligenceSurfaceItem[] = filtered.map((r) => ({
    surfaceKind: "SPECULATIVE_SHELL",
    subjectKind: "PARCEL",
    subjectId: r.parcelId,
    displayLabel: `Parcel ${r.parcelId.slice(0, 12)}`,
    displayContext: "shell-cluster proximity",
    score: r.pressureScore,
    scoreLabel: `pressure=${r.pressureScore.toFixed(2)}`,
    trajectoryState: null,
    rationale: `pressure=${r.pressureScore.toFixed(2)} shell-cluster factor present`,
    evidenceCount: 0,
    capturedAt: r.computedAt,
    href: null,
  }));
  return buildResult("SPECULATIVE_SHELL", items, 90, [
    `rows_scanned=${rows.length}`, `filtered=${filtered.length}`,
  ]);
}

// ── Utility propagation ──────────────────────────────────────────────────────

export async function surfaceUtilityPropagation(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.parcelUtilityContext.findMany({
    where: {
      availability: { in: ["PROPOSED", "UNDER_CONSTRUCTION"] },
      effectiveFrom: { gte: cutoff },
    },
    take: limit,
    orderBy: { effectiveFrom: "desc" },
  });
  const items: IntelligenceSurfaceItem[] = rows.map((r) => ({
    surfaceKind: "UTILITY_PROPAGATION",
    subjectKind: "PARCEL",
    subjectId: r.parcelId,
    displayLabel: `${r.utilityKind} ${r.availability}`,
    displayContext: r.providerName ?? "",
    score: null,
    scoreLabel: r.availability,
    trajectoryState: null,
    rationale: `${r.utilityKind} → ${r.availability}; effective ${r.effectiveFrom.toISOString().slice(0, 10)}`,
    evidenceCount: 0,
    capturedAt: r.effectiveFrom,
    href: null,
  }));
  return buildResult("UTILITY_PROPAGATION", items, 90, [
    `rows=${rows.length}`,
  ]);
}

// ── Broker clustering ────────────────────────────────────────────────────────
//
// Identifies broker entities that appear on ≥ 3 distinct projects in the
// last 180 days. Composes from ProjectEntity role=BROKER.

export async function surfaceBrokerClustering(opts: { limit?: number; minProjects?: number } = {}): Promise<IntelligenceSurfaceResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minProjects = opts.minProjects ?? 3;
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const rows = await prisma.projectEntity.findMany({
    where: { role: "BROKER", removed: false, attachedAt: { gte: cutoff } },
    take: 2000,
    select: { entityId: true, projectId: true },
  });
  const byEntity = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byEntity.get(r.entityId) ?? new Set<string>();
    set.add(r.projectId);
    byEntity.set(r.entityId, set);
  }
  const entityIds = Array.from(byEntity.entries())
    .filter(([, projects]) => projects.size >= minProjects)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, limit)
    .map(([id]) => id);

  const entities = entityIds.length
    ? await prisma.entity.findMany({ where: { id: { in: entityIds } } })
    : [];
  const entityById = new Map(entities.map((e) => [e.id, e]));

  const items: IntelligenceSurfaceItem[] = entityIds.map((id) => {
    const entity = entityById.get(id);
    const projects = byEntity.get(id) ?? new Set();
    return {
      surfaceKind: "BROKER_CLUSTERING",
      subjectKind: "DEVELOPER",
      subjectId: id,
      displayLabel: entity?.canonicalName ?? id.slice(0, 12),
      displayContext: `${projects.size} projects (180d)`,
      score: null,
      scoreLabel: `${projects.size} projects`,
      trajectoryState: null,
      rationale: `broker on ${projects.size} distinct projects in last 180d`,
      evidenceCount: projects.size,
      capturedAt: new Date(),
      href: null,
    } as IntelligenceSurfaceItem;
  });

  return buildResult("BROKER_CLUSTERING", items, 180, [
    `entities_scanned=${byEntity.size}`,
    `min_projects=${minProjects}`,
    `qualified=${items.length}`,
  ]);
}

// ── Workspace summary aggregator ─────────────────────────────────────────────

export async function summarizeWorkspaceSurfaces(opts: { limit?: number } = {}): Promise<IntelligenceSurfaceResult[]> {
  const limit = opts.limit ?? 8;
  const [
    emerging,
    corridors,
    jurisdictions,
    developers,
    highConf,
    pullIn,
    shell,
    utility,
    broker,
  ] = await Promise.all([
    surfaceEmergingNow({ limit }),
    surfaceAcceleratingCorridors({ limit }),
    surfaceJurisdictionAcceleration({ limit }),
    surfaceRepeatedDeveloperMovement({ limit }),
    surfaceHighConfidenceForecasts({ limit }),
    surfaceTimelinePullIn({ limit }),
    surfaceSpeculativeShell({ limit }),
    surfaceUtilityPropagation({ limit }),
    surfaceBrokerClustering({ limit }),
  ]);
  return [emerging, corridors, jurisdictions, developers, highConf, pullIn, shell, utility, broker];
}
