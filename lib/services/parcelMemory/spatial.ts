// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/spatial.ts
//  Phase MI-7 — Spatial relationship services.
//
//  Six capabilities the rest of the platform needs from the parcel-memory
//  layer:
//
//    1. attachProjectToParcel          — bind a project to a canonical parcel
//    2. inferAdjacentParcels           — heuristically populate ParcelAdjacency
//    3. detectCorridorEmergence        — flag corridor-style emergence
//    4. detectSpeculativeCluster       — flag speculative-cluster emergence
//    5. detectRepeatedDeveloperFootprint — flag repeated-developer-on-parcels
//    6. computeParcelPressure          — (in pressure.ts; re-exported via index)
//
//  Philosophy: all six functions are deterministic-first, explainable, and
//  conservative. None auto-collapses weak relationships into stronger ones;
//  every output is a *suggestion* with a reason log the operator can audit.
//
//  No GIS engine, no embeddings, no opaque ML. Geographic-distance
//  calculations use the haversine great-circle formula on Parcel.centroidLat
//  / centroidLng when those are known; otherwise heuristics fall back on
//  jurisdiction + address-token overlap.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitParcelMemoryAudit } from "./audit";
import { scoreParcelMatch } from "./score";
import { normalizeParcelRef } from "./normalize";
import type {
  ParcelMemoryActorContext,
  ParcelAdjacencyKind,
  CorridorDetectionResult,
  SpeculativeClusterResult,
  RepeatedDeveloperFootprintResult,
} from "./types";

// ── attachProjectToParcel ────────────────────────────────────────────────────

export interface AttachProjectToParcelInput {
  parcelId: string;
  projectId: string;
  attachReason: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH" | "VERIFIED";
  role?: "primary" | "secondary" | "corridor" | "easement";
  actor?: ParcelMemoryActorContext;
}

export interface AttachProjectToParcelResult {
  ok: boolean;
  parcelProjectId?: string;
  alreadyAttached?: boolean;
  error?: string;
}

/**
 * Bind a Project to a canonical Parcel via ParcelProject. Idempotent:
 * re-attaching the same (parcel, project, role) triple bumps lastSeenAt and
 * detachedAt → NULL but does not duplicate the row.
 *
 * Operator detach is via the soft-detach pattern: set detachedAt + detachedBy
 * + detachedReason. The row is preserved for lineage.
 */
export async function attachProjectToParcel(
  input: AttachProjectToParcelInput
): Promise<AttachProjectToParcelResult> {
  const role = input.role ?? "primary";
  const confidence = input.confidence ?? "MEDIUM";

  // Verify both ends exist (cheaper than letting the FK error bubble up,
  // and lets us return a structured error).
  const [parcel, project] = await Promise.all([
    prisma.parcel.findUnique({ where: { id: input.parcelId } }),
    prisma.project.findUnique({ where: { id: input.projectId } }),
  ]);
  if (!parcel) return { ok: false, error: "parcel_not_found" };
  if (!project) return { ok: false, error: "project_not_found" };

  const existing = await prisma.parcelProject.findUnique({
    where: {
      parcelId_projectId_role: {
        parcelId: input.parcelId,
        projectId: input.projectId,
        role,
      },
    },
  });

  if (existing) {
    await prisma.parcelProject.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        detachedAt: null,
        detachedReason: null,
        detachedBy: null,
        confidence,
      },
    });
    emitParcelMemoryAudit({
      action: "attach_project_to_parcel",
      parcelId: input.parcelId,
      decision: "re_attach",
      actorUserId: input.actor?.userId ?? null,
      actorEmail: input.actor?.email ?? null,
      factors: { projectId: input.projectId, role },
    });
    return { ok: true, parcelProjectId: existing.id, alreadyAttached: true };
  }

  const created = await prisma.parcelProject.create({
    data: {
      parcelId: input.parcelId,
      projectId: input.projectId,
      attachReason: input.attachReason,
      confidence,
      role,
    },
  });

  emitParcelMemoryAudit({
    action: "attach_project_to_parcel",
    parcelId: input.parcelId,
    decision: "new_attach",
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
    factors: { projectId: input.projectId, role, confidence },
  });

  return { ok: true, parcelProjectId: created.id };
}

// ── inferAdjacentParcels ─────────────────────────────────────────────────────

export interface InferAdjacentParcelsOptions {
  /** Max number of candidates to consider per parcel (cost cap). */
  maxCandidates?: number;
  /** Geographic distance threshold in feet for SAME_BLOCK heuristic. */
  sameBlockFtThreshold?: number;
  /** Heuristic threshold for NEARBY (looser). */
  nearbyFtThreshold?: number;
}

export interface InferAdjacencyResult {
  parcelId: string;
  inferred: Array<{
    toParcelId: string;
    adjacencyKind: ParcelAdjacencyKind;
    reason: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    approxDistanceFt: number | null;
  }>;
}

/**
 * Heuristic adjacency inference. NEVER overwrites or strengthens existing
 * ParcelAdjacency rows — only suggests new ones at low confidence. The
 * operator (or MI-7 PR-3 governance) confirms before promotion.
 *
 * Strategy:
 *   - If both parcels have centroids → haversine distance:
 *       < 50ft  → SHARED_BOUNDARY suggestion (LOW)
 *       < 200ft → ACROSS_STREET / SAME_BLOCK suggestion
 *       < nearbyFtThreshold → NEARBY suggestion
 *   - If both share jurisdiction AND share ≥ 2 address-token bigrams (e.g.
 *     "5301 Mills" / "5305 Mills") → SAME_BLOCK suggestion (LOW)
 *   - Otherwise no suggestion.
 *
 * This intentionally produces noisy LOW-confidence suggestions, not
 * authoritative facts. PR-3 operator review filters down to keepers.
 */
export async function inferAdjacentParcels(
  parcelId: string,
  opts: InferAdjacentParcelsOptions = {}
): Promise<InferAdjacencyResult> {
  const maxCandidates = opts.maxCandidates ?? 200;
  const sameBlockFt = opts.sameBlockFtThreshold ?? 200;
  const nearbyFt = opts.nearbyFtThreshold ?? 1000;

  const subject = await prisma.parcel.findUnique({ where: { id: parcelId } });
  if (!subject) return { parcelId, inferred: [] };

  const candidates = await prisma.parcel.findMany({
    where: {
      id: { not: parcelId },
      NOT: { reviewStatus: { in: ["REJECTED", "MERGED"] } },
      ...(subject.jurisdiction ? { jurisdiction: subject.jurisdiction } : {}),
    },
    take: maxCandidates,
    orderBy: { updatedAt: "desc" },
  });

  const existing = new Set(
    (await prisma.parcelAdjacency.findMany({
      where: { fromParcelId: parcelId },
      select: { toParcelId: true, adjacencyKind: true },
    })).map((a) => `${a.toParcelId}:${a.adjacencyKind}`)
  );

  const inferred: InferAdjacencyResult["inferred"] = [];

  for (const c of candidates) {
    const distance = haversineFeet(
      subject.centroidLat, subject.centroidLng,
      c.centroidLat, c.centroidLng
    );

    if (distance !== null) {
      let kind: ParcelAdjacencyKind | null = null;
      let confidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
      let reason = "";
      if (distance < 50) {
        kind = "SHARED_BOUNDARY";
        confidence = "MEDIUM";
        reason = "centroid_distance<50ft";
      } else if (distance < sameBlockFt) {
        kind = "SAME_BLOCK";
        confidence = "LOW";
        reason = `centroid_distance<${sameBlockFt}ft`;
      } else if (distance < nearbyFt) {
        kind = "NEARBY";
        confidence = "LOW";
        reason = `centroid_distance<${nearbyFt}ft`;
      }
      if (kind && !existing.has(`${c.id}:${kind}`)) {
        inferred.push({
          toParcelId: c.id,
          adjacencyKind: kind,
          reason,
          confidence,
          approxDistanceFt: Math.round(distance),
        });
      }
      continue;
    }

    // No centroids — fall back to address-token overlap when both have addresses.
    if (subject.primaryAddress && c.primaryAddress) {
      const subjectNorm = normalizeParcelRef(subject.primaryAddress, "ADDRESS_ONLY");
      const candNorm = normalizeParcelRef(c.primaryAddress, "ADDRESS_ONLY");
      const overlap = scoreParcelMatch(subjectNorm, candNorm);
      if (overlap >= 0.6 && !existing.has(`${c.id}:SAME_BLOCK`)) {
        inferred.push({
          toParcelId: c.id,
          adjacencyKind: "SAME_BLOCK",
          reason: `address_overlap_${overlap.toFixed(2)}`,
          confidence: "LOW",
          approxDistanceFt: null,
        });
      }
    }
  }

  emitParcelMemoryAudit({
    action: "infer_adjacent_parcels",
    parcelId,
    decision: "inferred",
    factors: { count: inferred.length },
  });

  return { parcelId, inferred };
}

// Haversine great-circle distance in feet. Returns null if either input is null.
function haversineFeet(
  lat1: number | null, lng1: number | null,
  lat2: number | null, lng2: number | null
): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R_MILES = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_MILES * c * 5280;
}

// ── detectCorridorEmergence ──────────────────────────────────────────────────

/**
 * A "corridor emergence" is multiple parcels along a road / utility corridor
 * with active emergence signals (rezoning, utility extension, broker activity)
 * over a tight time window. The platform answers: "is this parcel part of a
 * larger linear-development push?"
 *
 * Heuristic: a parcel is corridor-emergent when it has ≥ 3 NEARBY / CORRIDOR
 * neighbors that each carry ≥ 1 entitlement signal in the last 365 days.
 *
 * Conservative — never auto-promotes adjacency rows to CORRIDOR, only flags
 * the pattern. PR-3 operator review handles promotion.
 */
export async function detectCorridorEmergence(
  parcelId: string,
  opts: { recentDays?: number; minMembers?: number } = {}
): Promise<CorridorDetectionResult> {
  const recentDays = opts.recentDays ?? 365;
  const minMembers = opts.minMembers ?? 3;
  const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

  const adjacencies = await prisma.parcelAdjacency.findMany({
    where: {
      fromParcelId: parcelId,
      adjacencyKind: { in: ["CORRIDOR", "NEARBY", "ACROSS_STREET", "SAME_BLOCK"] },
      reviewStatus: { not: "REJECTED" },
    },
    select: { toParcelId: true, adjacencyKind: true },
  });

  if (adjacencies.length === 0) {
    return {
      parcelId,
      isOnCorridor: false,
      corridorMembers: [],
      reason: "no_adjacencies",
    };
  }

  const neighborIds = adjacencies.map((a) => a.toParcelId);

  // Find which neighbors have entitlement-style ParcelSignal rows in the
  // recent window. Entitlement style = signalKind MARKET_SIGNAL with
  // attachReason mentioning rezoning/plat/variance/SUP/CUP, OR any signal
  // whose detachedAt is null and firstObservedAt > cutoff.
  const neighborSignals = await prisma.parcelSignal.findMany({
    where: {
      parcelId: { in: neighborIds },
      detachedAt: null,
      firstObservedAt: { gte: cutoff },
    },
    select: { parcelId: true, attachReason: true },
  });

  const ENTITLEMENT_RE = /(rezoning|sup|cup|variance|plat|site\s*plan|annex)/i;
  const activeNeighbors = new Set<string>();
  for (const sig of neighborSignals) {
    if (ENTITLEMENT_RE.test(sig.attachReason)) {
      activeNeighbors.add(sig.parcelId);
    }
  }

  const isOnCorridor = activeNeighbors.size >= minMembers;
  const reason = isOnCorridor
    ? `${activeNeighbors.size}_active_neighbors_in_${recentDays}d`
    : `only_${activeNeighbors.size}_active_neighbors`;

  emitParcelMemoryAudit({
    action: "detect_corridor_emergence",
    parcelId,
    decision: isOnCorridor ? "corridor_detected" : "no_corridor",
    factors: { activeNeighbors: activeNeighbors.size, total: neighborIds.length },
  });

  return {
    parcelId,
    isOnCorridor,
    corridorMembers: Array.from(activeNeighbors),
    reason,
  };
}

// ── detectSpeculativeCluster ─────────────────────────────────────────────────

/**
 * Speculative-cluster pattern: 2+ adjacent parcels owned by the same
 * developer/owner entity in the last N days WITHOUT corresponding active
 * construction signals. This is the classic "developer accumulating before
 * announcement" pattern.
 *
 * Heuristic: pull ParcelOwnershipPeriod rows for the subject and its
 * neighbors; if ≥ 2 share the same ownerEntityId AND none of those parcels
 * currently host an ACTIVE_CONSTRUCTION-state project, return positive.
 */
export async function detectSpeculativeCluster(
  parcelId: string,
  opts: { minMembers?: number; recentDays?: number } = {}
): Promise<SpeculativeClusterResult> {
  const minMembers = opts.minMembers ?? 2;
  const recentDays = opts.recentDays ?? 1825; // 5 years

  const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

  const adjacencies = await prisma.parcelAdjacency.findMany({
    where: {
      fromParcelId: parcelId,
      reviewStatus: { not: "REJECTED" },
    },
    select: { toParcelId: true },
  });

  const candidateIds = [parcelId, ...adjacencies.map((a) => a.toParcelId)];

  const ownerships = await prisma.parcelOwnershipPeriod.findMany({
    where: {
      parcelId: { in: candidateIds },
      ownerEntityId: { not: null },
      ownedFrom: { gte: cutoff },
    },
    select: { parcelId: true, ownerEntityId: true },
  });

  if (ownerships.length === 0) {
    return {
      parcelId,
      isSpeculativeCluster: false,
      clusterMembers: [],
      reason: "no_recent_ownerships",
    };
  }

  // Group parcels by ownerEntityId
  const byOwner = new Map<string, Set<string>>();
  for (const o of ownerships) {
    if (!o.ownerEntityId) continue;
    const set = byOwner.get(o.ownerEntityId) ?? new Set<string>();
    set.add(o.parcelId);
    byOwner.set(o.ownerEntityId, set);
  }

  // Pick the largest cluster that includes the subject parcel
  let bestCluster: string[] = [];
  for (const [, parcels] of byOwner) {
    if (parcels.has(parcelId) && parcels.size >= minMembers && parcels.size > bestCluster.length) {
      bestCluster = Array.from(parcels);
    }
  }

  if (bestCluster.length === 0) {
    return {
      parcelId,
      isSpeculativeCluster: false,
      clusterMembers: [],
      reason: "no_shared_owner_above_min",
    };
  }

  // Check construction-state for each cluster member — if any are
  // ACTIVE_CONSTRUCTION, it's not speculative anymore.
  const activeProjects = await prisma.parcelProject.findMany({
    where: {
      parcelId: { in: bestCluster },
      detachedAt: null,
      project: { lifecycleState: "ACTIVE_CONSTRUCTION" },
    },
    select: { parcelId: true },
  });

  if (activeProjects.length > 0) {
    return {
      parcelId,
      isSpeculativeCluster: false,
      clusterMembers: bestCluster,
      reason: "cluster_has_active_construction",
    };
  }

  emitParcelMemoryAudit({
    action: "detect_speculative_cluster",
    parcelId,
    decision: "cluster_detected",
    factors: { members: bestCluster.length },
  });

  return {
    parcelId,
    isSpeculativeCluster: true,
    clusterMembers: bestCluster,
    reason: `${bestCluster.length}_parcels_same_owner_no_active_construction`,
  };
}

// ── detectRepeatedDeveloperFootprint ─────────────────────────────────────────

/**
 * Repeated-developer-footprint pattern: the developer attached to a project
 * on THIS parcel has been the developer on N other parcels within the same
 * jurisdiction within the last K years. Strong signal that this developer
 * is operating a regional rollout — a key intelligence signal for
 * downstream pursuit prioritization.
 *
 * Reads via ProjectEntity (role=DEVELOPER) joined to ParcelProject. No
 * raw geometry needed.
 */
export async function detectRepeatedDeveloperFootprint(
  parcelId: string,
  opts: { recentDays?: number; minOtherParcels?: number } = {}
): Promise<RepeatedDeveloperFootprintResult> {
  const recentDays = opts.recentDays ?? 1825;
  const minOther = opts.minOtherParcels ?? 2;
  const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

  const subject = await prisma.parcel.findUnique({ where: { id: parcelId } });
  if (!subject) {
    return {
      parcelId,
      isRepeatedFootprint: false,
      developerEntityIds: [],
      otherParcelIds: [],
      reason: "parcel_not_found",
    };
  }

  // Developers attached to projects currently linked to THIS parcel.
  const subjectProjectLinks = await prisma.parcelProject.findMany({
    where: { parcelId, detachedAt: null },
    select: { projectId: true },
  });
  if (subjectProjectLinks.length === 0) {
    return {
      parcelId,
      isRepeatedFootprint: false,
      developerEntityIds: [],
      otherParcelIds: [],
      reason: "no_project_link",
    };
  }
  const subjectProjectIds = subjectProjectLinks.map((p) => p.projectId);

  const subjectDevs = await prisma.projectEntity.findMany({
    where: {
      projectId: { in: subjectProjectIds },
      role: "DEVELOPER",
      removed: false,
    },
    select: { entityId: true },
  });
  if (subjectDevs.length === 0) {
    return {
      parcelId,
      isRepeatedFootprint: false,
      developerEntityIds: [],
      otherParcelIds: [],
      reason: "no_developer_attached",
    };
  }

  const devIds = Array.from(new Set(subjectDevs.map((d) => d.entityId)));

  // Find other ProjectEntity rows for those developers in the same
  // jurisdiction within the recent window, on parcels other than this one.
  const otherDeveloperProjects = await prisma.projectEntity.findMany({
    where: {
      entityId: { in: devIds },
      role: "DEVELOPER",
      removed: false,
      attachedAt: { gte: cutoff },
      project: subject.jurisdiction
        ? { jurisdiction: subject.jurisdiction }
        : undefined,
    },
    select: { projectId: true, entityId: true },
  });
  const otherProjectIds = otherDeveloperProjects
    .map((p) => p.projectId)
    .filter((pid) => !subjectProjectIds.includes(pid));

  if (otherProjectIds.length === 0) {
    return {
      parcelId,
      isRepeatedFootprint: false,
      developerEntityIds: devIds,
      otherParcelIds: [],
      reason: "no_other_developer_projects",
    };
  }

  const otherParcelLinks = await prisma.parcelProject.findMany({
    where: {
      projectId: { in: otherProjectIds },
      detachedAt: null,
      parcelId: { not: parcelId },
    },
    select: { parcelId: true },
  });
  const otherParcelIds = Array.from(new Set(otherParcelLinks.map((p) => p.parcelId)));

  const isRepeated = otherParcelIds.length >= minOther;

  emitParcelMemoryAudit({
    action: "detect_repeated_developer_footprint",
    parcelId,
    decision: isRepeated ? "repeated_footprint" : "no_repeated_footprint",
    factors: {
      developers: devIds.length,
      otherParcels: otherParcelIds.length,
    },
  });

  return {
    parcelId,
    isRepeatedFootprint: isRepeated,
    developerEntityIds: devIds,
    otherParcelIds,
    reason: isRepeated
      ? `${otherParcelIds.length}_other_parcels_${devIds.length}_developers`
      : `only_${otherParcelIds.length}_other_parcels`,
  };
}
