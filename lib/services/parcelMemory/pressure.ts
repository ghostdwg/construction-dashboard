// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/pressure.ts
//  Phase MI-7 — Parcel pressure heuristic engine + snapshot writer.
//
//  Pressure is a 0..1 composite of factors that together describe how much
//  market/development force is currently acting on a parcel. The model is:
//
//      pressureScore = recencyMultiplier × (sum_i w_i · f_i) / sum_i w_i
//
//  where each f_i ∈ [0, 1] is one factor, w_i is its weight from
//  PRESSURE_FACTOR_WEIGHTS, and recencyMultiplier is an exponential half-life
//  decay tied to daysSinceLastSignal (PRESSURE_RECENCY_HALF_LIFE_DAYS).
//
//  Pure functions for scoring (computePressure) plus a stateful writer
//  (recordPressureSnapshot) that persists to ParcelPressureSnapshot. The
//  full input gathering — translating a parcel's database state into a
//  ParcelPressureInput — lives in collectPressureInput().
//
//  Stability contract: changes to factor logic OR weights MUST bump
//  PRESSURE_VERSION in types.ts.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitParcelMemoryAudit } from "./audit";
import {
  type ParcelPressureInput,
  type ParcelPressureFactors,
  type ParcelPressureResult,
  type ParcelMemoryActorContext,
  PRESSURE_FACTOR_WEIGHTS,
  PRESSURE_RECENCY_HALF_LIFE_DAYS,
  PRESSURE_VERSION,
} from "./types";

// ── Pure factor scoring ──────────────────────────────────────────────────────
//
// Each scorer returns a number in [0, 1]. Saturation curves are intentional:
// adding the 10th project doesn't move the needle the same way as adding
// the 2nd, but presence is what matters. We use min(1, x / k) and
// 1 - exp(-x/k) shapes to avoid runaway dominance.

function saturate(x: number, k: number): number {
  if (x <= 0) return 0;
  return Math.min(1, x / k);
}

function expSaturate(x: number, k: number): number {
  if (x <= 0) return 0;
  return 1 - Math.exp(-x / k);
}

export function scoreDeveloperRecurrence(input: ParcelPressureInput): number {
  return saturate(input.developerEntityIds.length, 2);
}

export function scoreBrokerRecurrence(input: ParcelPressureInput): number {
  return saturate(input.brokerEntityIds.length, 2);
}

export function scoreEntitlementActivity(input: ParcelPressureInput): number {
  return expSaturate(input.recentEntitlementSignals, 3);
}

export function scoreUtilityExpansion(input: ParcelPressureInput): number {
  return saturate(input.activeUtilityExpansions, 2);
}

export function scoreContinuancePressure(input: ParcelPressureInput): number {
  // Continuances are unusually noisy in the signal stream — 1 continuance is
  // routine; 3+ is unmistakable agenda-deferral pressure.
  if (input.continuanceCount <= 0) return 0;
  if (input.continuanceCount === 1) return 0.3;
  if (input.continuanceCount === 2) return 0.6;
  return 1;
}

export function scoreNeighborPressure(input: ParcelPressureInput): number {
  return expSaturate(input.pressuredNeighborCount, 2);
}

export function scoreShellClusterProximity(input: ParcelPressureInput): number {
  return saturate(input.nearbyShellPatternCount, 2);
}

export function scoreOwnershipChurn(input: ParcelPressureInput): number {
  return saturate(input.recentOwnershipTransferCount, 3);
}

export function scoreInfrastructureInvestment(input: ParcelPressureInput): number {
  return input.hasInfrastructureInvestment ? 1 : 0;
}

export function scoreCorridorAdjacency(input: ParcelPressureInput): number {
  return input.isOnCorridor ? 1 : 0;
}

export function computeRecencyMultiplier(daysSinceLastSignal: number): number {
  if (daysSinceLastSignal <= 0) return 1;
  // Exponential decay with half-life of PRESSURE_RECENCY_HALF_LIFE_DAYS.
  return Math.pow(0.5, daysSinceLastSignal / PRESSURE_RECENCY_HALF_LIFE_DAYS);
}

/** Pure composite scorer. Same input always produces same output. */
export function computePressure(input: ParcelPressureInput): ParcelPressureResult {
  const factors: ParcelPressureFactors = {
    developerRecurrence: scoreDeveloperRecurrence(input),
    brokerRecurrence: scoreBrokerRecurrence(input),
    entitlementActivity: scoreEntitlementActivity(input),
    utilityExpansion: scoreUtilityExpansion(input),
    continuancePressure: scoreContinuancePressure(input),
    neighborPressure: scoreNeighborPressure(input),
    shellClusterProximity: scoreShellClusterProximity(input),
    ownershipChurn: scoreOwnershipChurn(input),
    infrastructureInvestment: scoreInfrastructureInvestment(input),
    corridorAdjacency: scoreCorridorAdjacency(input),
    recencyMultiplier: computeRecencyMultiplier(input.daysSinceLastSignal),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  const reasonLog: string[] = [];
  for (const [factorName, weight] of Object.entries(PRESSURE_FACTOR_WEIGHTS)) {
    const score = (factors as unknown as Record<string, number>)[factorName];
    weightedSum += score * weight;
    weightTotal += weight;
    if (score > 0) {
      reasonLog.push(`${factorName}=${score.toFixed(2)} (w=${weight})`);
    }
  }

  const base = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const pressureScore = Math.max(0, Math.min(1, base * factors.recencyMultiplier));

  if (factors.recencyMultiplier < 1) {
    reasonLog.push(`recencyMultiplier=${factors.recencyMultiplier.toFixed(3)}`);
  }

  return {
    parcelId: input.parcelId,
    pressureScore,
    factors,
    reasonLog,
    pressureVersion: PRESSURE_VERSION,
  };
}

// ── Input collection ─────────────────────────────────────────────────────────

/**
 * Translate a parcel's current database state into a ParcelPressureInput.
 * Single round-trip over a handful of indexed queries; safe to call on the
 * hot path of live ingestion (~6 queries, all on indexed columns).
 */
export async function collectPressureInput(
  parcelId: string,
  opts: { recentEntitlementWindowDays?: number; neighborWindow?: number } = {}
): Promise<ParcelPressureInput | null> {
  const recentEntitlementWindow = opts.recentEntitlementWindowDays ?? 365;
  const entitlementCutoff = new Date(Date.now() - recentEntitlementWindow * 24 * 60 * 60 * 1000);

  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });
  if (!parcel) return null;

  const [
    projectLinks,
    parcelSignals,
    utilityRows,
    adjacencies,
    ownerships,
  ] = await Promise.all([
    prisma.parcelProject.findMany({
      where: { parcelId, detachedAt: null },
      select: { projectId: true },
    }),
    prisma.parcelSignal.findMany({
      where: { parcelId, detachedAt: null },
      select: { attachReason: true, firstObservedAt: true, lastObservedAt: true },
      orderBy: { lastObservedAt: "desc" },
    }),
    prisma.parcelUtilityContext.findMany({
      where: {
        parcelId,
        availability: { in: ["PROPOSED", "UNDER_CONSTRUCTION"] },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      select: { id: true },
    }),
    prisma.parcelAdjacency.findMany({
      where: { fromParcelId: parcelId, reviewStatus: { not: "REJECTED" } },
      select: { toParcelId: true, adjacencyKind: true },
    }),
    prisma.parcelOwnershipPeriod.findMany({
      where: {
        parcelId,
        ownedFrom: { gte: new Date(Date.now() - 1825 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    }),
  ]);

  // Pull developer/broker entityIds from attached projects.
  const projectIds = projectLinks.map((p) => p.projectId);
  const projectEntities = projectIds.length
    ? await prisma.projectEntity.findMany({
        where: { projectId: { in: projectIds }, removed: false },
        select: { entityId: true, role: true },
      })
    : [];

  const developerEntityIds = Array.from(new Set(
    projectEntities.filter((e) => e.role === "DEVELOPER" || e.role === "OWNER").map((e) => e.entityId)
  ));
  const brokerEntityIds = Array.from(new Set(
    projectEntities.filter((e) => e.role === "BROKER").map((e) => e.entityId)
  ));

  // Entitlement signals — those whose attachReason matches the entitlement
  // pattern AND firstObservedAt is within the window.
  const ENTITLEMENT_RE = /(rezoning|sup|cup|variance|plat|site\s*plan|annex)/i;
  const recentEntitlementSignals = parcelSignals.filter(
    (s) =>
      s.firstObservedAt >= entitlementCutoff &&
      ENTITLEMENT_RE.test(s.attachReason)
  ).length;

  // Continuance count — heuristic on attachReason.
  const CONTINUANCE_RE = /(continued|continuance|tabled|deferred)/i;
  const continuanceCount = parcelSignals.filter((s) => CONTINUANCE_RE.test(s.attachReason)).length;

  // Days-since-last-signal
  const lastSignalAt = parcelSignals[0]?.lastObservedAt ?? null;
  const daysSinceLastSignal = lastSignalAt
    ? Math.max(0, Math.floor((Date.now() - lastSignalAt.getTime()) / (24 * 60 * 60 * 1000)))
    : 9999;

  // Pressured-neighbor count and shell-pattern proximity — read the latest
  // pressure snapshot per neighbor. Capped at neighbor count to bound cost.
  const neighborIds = adjacencies.map((a) => a.toParcelId);
  let pressuredNeighborCount = 0;
  let nearbyShellPatternCount = 0;
  if (neighborIds.length > 0) {
    const neighborSnapshots = await prisma.parcelPressureSnapshot.findMany({
      where: { parcelId: { in: neighborIds } },
      orderBy: { computedAt: "desc" },
      take: neighborIds.length * 3,
    });
    const latestByParcel = new Map<string, number>();
    for (const snap of neighborSnapshots) {
      if (!latestByParcel.has(snap.parcelId)) {
        latestByParcel.set(snap.parcelId, snap.pressureScore);
      }
    }
    for (const score of latestByParcel.values()) {
      if (score >= 0.5) pressuredNeighborCount++;
    }

    // Shell pattern proximity — read project lifecycle of neighbor projects;
    // count those in EARLY_SIGNAL / PRE_ENTITLEMENT without owner role attached.
    const neighborProjectLinks = await prisma.parcelProject.findMany({
      where: { parcelId: { in: neighborIds }, detachedAt: null },
      select: { parcelId: true, projectId: true },
    });
    if (neighborProjectLinks.length > 0) {
      const np_ids = neighborProjectLinks.map((l) => l.projectId);
      const projects = await prisma.project.findMany({
        where: { id: { in: np_ids } },
        select: { id: true, lifecycleState: true },
      });
      const projEntities = await prisma.projectEntity.findMany({
        where: { projectId: { in: np_ids }, removed: false },
        select: { projectId: true, role: true },
      });
      const ownerByProject = new Map<string, boolean>();
      for (const pe of projEntities) {
        if (pe.role === "OWNER") ownerByProject.set(pe.projectId, true);
      }
      const seenParcels = new Set<string>();
      for (const link of neighborProjectLinks) {
        const project = projects.find((p) => p.id === link.projectId);
        if (!project) continue;
        const isEarly = ["EARLY_SIGNAL", "PRE_ENTITLEMENT", "EMERGING"].includes(project.lifecycleState);
        const hasOwner = ownerByProject.has(project.id);
        if (isEarly && !hasOwner && !seenParcels.has(link.parcelId)) {
          nearbyShellPatternCount++;
          seenParcels.add(link.parcelId);
        }
      }
    }
  }

  // Infrastructure-investment heuristic: any utility row with capacity text
  // containing "tif" or "bond" OR provider name including "dot" or "state",
  // OR parcelSignal whose attachReason mentions infrastructure-investment.
  const INFRA_RE = /(tif|bond|state\s*dot|infrastructure|state\s*highway)/i;
  const utilityRowsFull = await prisma.parcelUtilityContext.findMany({
    where: { parcelId },
    select: { capacity: true, providerName: true },
  });
  const utilityIndicatesInfra = utilityRowsFull.some(
    (r) => (r.capacity && INFRA_RE.test(r.capacity)) || (r.providerName && INFRA_RE.test(r.providerName))
  );
  const signalIndicatesInfra = parcelSignals.some((s) => INFRA_RE.test(s.attachReason));
  const hasInfrastructureInvestment = utilityIndicatesInfra || signalIndicatesInfra;

  // Corridor adjacency
  const isOnCorridor = adjacencies.some((a) => a.adjacencyKind === "CORRIDOR");

  return {
    parcelId,
    attachedProjectCount: projectLinks.length,
    developerEntityIds,
    brokerEntityIds,
    recentEntitlementSignals,
    activeUtilityExpansions: utilityRows.length,
    continuanceCount,
    pressuredNeighborCount,
    nearbyShellPatternCount,
    daysSinceLastSignal,
    recentOwnershipTransferCount: ownerships.length,
    hasInfrastructureInvestment,
    isOnCorridor,
  };
}

// ── Snapshot writer ──────────────────────────────────────────────────────────

export interface RecordPressureSnapshotOptions {
  reason?: "scheduled" | "signal_attached" | "manual" | "backfill";
  actor?: ParcelMemoryActorContext;
  /** Skip writing when the score is identical to the most recent snapshot.
   *  Default true — append-only by intent, but avoids meaningless duplicates. */
  skipIfUnchanged?: boolean;
  /** Pre-computed pressure result — when provided, skips re-collection.
   *  Used by backfill batches. */
  precomputed?: ParcelPressureResult;
}

export interface RecordPressureSnapshotResult {
  ok: boolean;
  snapshotId?: string;
  skipped?: boolean;
  result?: ParcelPressureResult;
  error?: string;
}

/**
 * Compute the current pressure for a parcel and append a
 * ParcelPressureSnapshot row. Append-only by design — never overwrites
 * past snapshots. The history is what makes pressure evolution queryable.
 */
export async function recordPressureSnapshot(
  parcelId: string,
  opts: RecordPressureSnapshotOptions = {}
): Promise<RecordPressureSnapshotResult> {
  const reason = opts.reason ?? "scheduled";
  const skipIfUnchanged = opts.skipIfUnchanged !== false;

  let result: ParcelPressureResult;
  if (opts.precomputed) {
    result = opts.precomputed;
  } else {
    const input = await collectPressureInput(parcelId);
    if (!input) return { ok: false, error: "parcel_not_found" };
    result = computePressure(input);
  }

  if (skipIfUnchanged) {
    const previous = await prisma.parcelPressureSnapshot.findFirst({
      where: { parcelId },
      orderBy: { computedAt: "desc" },
    });
    if (previous && Math.abs(previous.pressureScore - result.pressureScore) < 0.001) {
      emitParcelMemoryAudit({
        action: "record_pressure_snapshot",
        parcelId,
        decision: "skipped_unchanged",
        score: result.pressureScore,
      });
      return { ok: true, skipped: true, result };
    }
  }

  const snap = await prisma.parcelPressureSnapshot.create({
    data: {
      parcelId,
      pressureScore: result.pressureScore,
      factorsJson: JSON.stringify({
        factors: result.factors,
        reasonLog: result.reasonLog,
      }),
      pressureVersion: result.pressureVersion,
      reason,
      actorUserId: opts.actor?.userId ?? null,
      actorEmail: opts.actor?.email ?? null,
    },
  });

  emitParcelMemoryAudit({
    action: "record_pressure_snapshot",
    parcelId,
    decision: "recorded",
    score: result.pressureScore,
    reasonLog: result.reasonLog,
    actorUserId: opts.actor?.userId ?? null,
    actorEmail: opts.actor?.email ?? null,
  });

  return { ok: true, snapshotId: snap.id, result };
}
