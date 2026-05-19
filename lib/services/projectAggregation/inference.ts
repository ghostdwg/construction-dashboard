// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/inference.ts
//  Phase MI-6 — Read-only inference helpers.
//
//  Given a Project ID, surface candidate entities and parcels by walking
//  the attached signals' source rows. Returns candidates the caller (UI /
//  operator) can choose to attach via attachEntityToProject / a parcel
//  attach equivalent.
//
//  These functions DO NOT mutate. They produce ranked suggestions only.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { ProjectEntityRole } from "./types";

export interface InferredEntity {
  entityId: string;
  canonicalName: string;
  entityType: string;
  suggestedRole: ProjectEntityRole;
  observedInSignals: number;       // how many ProjectSignals referenced this entity
  alreadyAttached: boolean;
  reasonLog: string[];
}

export interface InferredParcel {
  parcelId: string;
  parcelSource: string;
  address: string | null;
  jurisdiction: string | null;
  observedInSignals: number;
  alreadyAttached: boolean;
  reasonLog: string[];
}

/**
 * Walk a project's attached ProjectSignal rows. For each that points at a
 * RelationshipEdge, extract the from/to entity IDs and propose them as
 * inferred ProjectEntity attachments. For each that points at a MarketSignal,
 * read the signal metadata JSON (best-effort — many sources don't structure
 * entity data).
 *
 * Conservative: only suggests entities that appear in ≥1 attached signal
 * AND are not already attached as ProjectEntity. Operator decides via UI.
 */
export async function inferRelatedEntities(projectId: string): Promise<InferredEntity[]> {
  const projectSignals = await prisma.projectSignal.findMany({
    where: { projectId, detachedAt: null },
    select: { sourceRelationshipEdgeId: true, sourceMarketSignalId: true },
  });

  const edgeIds = projectSignals
    .map((s) => s.sourceRelationshipEdgeId)
    .filter((x): x is string => x !== null);

  if (edgeIds.length === 0) return [];

  const edges = await prisma.relationshipEdge.findMany({
    where: { id: { in: edgeIds } },
    select: {
      id: true,
      fromEntityId: true,
      fromType: true,
      toEntityId: true,
      toType: true,
    },
  });

  // Tally entity occurrences with their observed role (from RelationshipEdge.fromType/toType)
  const tally = new Map<
    string,
    { entityId: string; role: ProjectEntityRole; count: number; reasonLog: string[] }
  >();
  function bump(entityId: string | null, rawType: string, edgeId: string) {
    if (!entityId) return;
    const role = normalizeRole(rawType);
    const key = `${entityId}|${role}`;
    const cur = tally.get(key) ?? { entityId, role, count: 0, reasonLog: [] };
    cur.count += 1;
    cur.reasonLog.push(`co-occurred-in-edge:${edgeId.slice(0, 8)}`);
    tally.set(key, cur);
  }
  for (const e of edges) {
    bump(e.fromEntityId, e.fromType, e.id);
    bump(e.toEntityId, e.toType, e.id);
  }

  // Resolve entity metadata + filter against already-attached
  const candidateIds = [...new Set([...tally.values()].map((t) => t.entityId))];
  if (candidateIds.length === 0) return [];

  const [entities, alreadyAttached] = await Promise.all([
    prisma.entity.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, canonicalName: true, entityType: true },
    }),
    prisma.projectEntity.findMany({
      where: { projectId, entityId: { in: candidateIds }, removed: false },
      select: { entityId: true, role: true },
    }),
  ]);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const attachedSet = new Set(alreadyAttached.map((a) => `${a.entityId}|${a.role}`));

  return [...tally.values()]
    .map((t) => {
      const e = entityById.get(t.entityId);
      if (!e) return null;
      return {
        entityId: t.entityId,
        canonicalName: e.canonicalName,
        entityType: e.entityType,
        suggestedRole: t.role,
        observedInSignals: t.count,
        alreadyAttached: attachedSet.has(`${t.entityId}|${t.role}`),
        reasonLog: t.reasonLog,
      } as InferredEntity;
    })
    .filter((x): x is InferredEntity => x !== null)
    .sort((a, b) => b.observedInSignals - a.observedInSignals);
}

/**
 * Walk attached signals for parcel hints. In MI-6 PR1 we surface parcels
 * from RelationshipEdge.location free-text and MarketSignal.metadata JSON
 * (when parsable). Returns deduped suggestions ordered by occurrence count.
 *
 * NOTE: parcel ID parsing is intentionally conservative — only structured
 * patterns are treated as parcel IDs. Free-form addresses are surfaced
 * separately for operator review.
 */
export async function inferRelatedParcels(projectId: string): Promise<InferredParcel[]> {
  const projectSignals = await prisma.projectSignal.findMany({
    where: { projectId, detachedAt: null },
    select: {
      sourceRelationshipEdgeId: true,
      sourceMarketSignalId: true,
    },
  });

  const edgeIds = projectSignals
    .map((s) => s.sourceRelationshipEdgeId)
    .filter((x): x is string => x !== null);
  const signalIds = projectSignals
    .map((s) => s.sourceMarketSignalId)
    .filter((x): x is string => x !== null);

  const [edges, signals] = await Promise.all([
    edgeIds.length > 0
      ? prisma.relationshipEdge.findMany({
          where: { id: { in: edgeIds } },
          select: { location: true },
        })
      : Promise.resolve([] as Array<{ location: string | null }>),
    signalIds.length > 0
      ? prisma.marketSignal.findMany({
          where: { id: { in: signalIds } },
          select: { metadata: true },
        })
      : Promise.resolve([] as Array<{ metadata: string | null }>),
  ]);

  const tally = new Map<string, InferredParcel>();
  function bump(parcelId: string, parcelSource: string, address: string | null) {
    const key = `${parcelId}|${parcelSource}`;
    const cur =
      tally.get(key) ??
      ({
        parcelId,
        parcelSource,
        address,
        jurisdiction: null,
        observedInSignals: 0,
        alreadyAttached: false,
        reasonLog: [],
      } as InferredParcel);
    cur.observedInSignals += 1;
    cur.reasonLog.push(parcelSource);
    tally.set(key, cur);
  }

  for (const e of edges) {
    if (e.location) {
      const parsed = parseParcelFromText(e.location);
      if (parsed) bump(parsed, "relationship_edge_location", e.location);
    }
  }
  for (const s of signals) {
    if (!s.metadata) continue;
    try {
      const meta = JSON.parse(s.metadata) as Record<string, unknown>;
      const parcel = typeof meta.parcelId === "string" ? meta.parcelId
                   : typeof meta.parcel_id === "string" ? meta.parcel_id
                   : null;
      const address = typeof meta.address === "string" ? meta.address : null;
      if (parcel) bump(parcel, "market_signal_metadata", address);
    } catch {
      // Non-JSON metadata — skip silently
    }
  }

  if (tally.size === 0) return [];
  const candidates = [...tally.values()];
  const attached = await prisma.projectParcel.findMany({
    where: { projectId, parcelId: { in: candidates.map((c) => c.parcelId) } },
    select: { parcelId: true, parcelSource: true },
  });
  const attachedSet = new Set(attached.map((a) => `${a.parcelId}|${a.parcelSource}`));

  for (const c of candidates) {
    c.alreadyAttached = attachedSet.has(`${c.parcelId}|${c.parcelSource}`);
  }

  return candidates.sort((a, b) => b.observedInSignals - a.observedInSignals);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PARCEL_PATTERN = /\b(\d{10,16})\b/; // common assessor parcel number length range

function parseParcelFromText(s: string): string | null {
  const m = s.match(PARCEL_PATTERN);
  return m ? m[1] : null;
}

function normalizeRole(raw: string): ProjectEntityRole {
  const k = raw.toUpperCase().trim();
  if (k === "DEVELOPER") return "DEVELOPER";
  if (k === "OWNER") return "OWNER";
  if (k === "GC") return "GC";
  if (k === "ARCHITECT") return "ARCHITECT";
  if (k === "ENGINEER") return "ENGINEER";
  if (k === "BROKER") return "BROKER";
  if (k === "TENANT") return "TENANT";
  if (k === "LENDER") return "LENDER";
  if (k === "MUNICIPALITY") return "MUNICIPALITY";
  if (k === "AGENCY") return "AGENCY";
  return "OTHER";
}
