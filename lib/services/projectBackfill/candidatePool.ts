// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/candidatePool.ts
//  Phase MI-6 PR2 — Candidate Project filtering before similarity scoring.
//
//  Brute-force "score everything" is O(signals × projects). For early-MI
//  volumes the corpus is small enough that this is cheap, but the
//  architecture has to scale to thousands of projects.
//
//  Strategy: pre-filter candidates by parcel-overlap OR jurisdiction-match
//  OR temporal proximity (occurredAt within window). Then score the
//  reduced set. Conservative — false negatives produce extra new
//  projects, which the operator's review queue (MI-6 PR3) can merge.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type {
  ProjectContext,
  ProjectEntityRole,
  SignalInput,
} from "@/lib/services/projectAggregation";

const CANDIDATE_LIMIT = 50;
const TEMPORAL_WINDOW_DAYS = 365;
const RECENT_TAG_WINDOW_SIGNALS = 25;

// Empty role buckets used when projecting an entity-by-role map.
function emptyRoleMap(): Record<ProjectEntityRole, string[]> {
  return {
    DEVELOPER: [], OWNER: [], GC: [], ARCHITECT: [], ENGINEER: [],
    BROKER: [], TENANT: [], LENDER: [], MUNICIPALITY: [], AGENCY: [], OTHER: [],
  };
}

/**
 * Build a filtered candidate pool for a signal. Returns up to CANDIDATE_LIMIT
 * Project IDs that share at least one of:
 *   - any parcel ID via ProjectParcel
 *   - the signal's jurisdiction
 *   - a temporal window of TEMPORAL_WINDOW_DAYS around signal.occurredAt
 *
 * Excludes REJECTED, MERGED, ABANDONED, COMPLETED projects (we never
 * attach new historical signals to wrapped-up aggregates; operator
 * un-rejects manually if needed).
 */
export async function fetchCandidateProjectIds(signal: SignalInput): Promise<string[]> {
  const t0 = signal.occurredAt.getTime();
  const windowMs = TEMPORAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowStart = new Date(t0 - windowMs);
  const windowEnd = new Date(t0 + windowMs);

  const ineligible = ["REJECTED", "MERGED"];
  const ineligibleStates = ["ABANDONED", "COMPLETED"];

  const ors: Array<Record<string, unknown>> = [];

  if (signal.parcelIds.length > 0) {
    ors.push({ parcels: { some: { parcelId: { in: signal.parcelIds } } } });
  }
  if (signal.jurisdiction) {
    ors.push({ jurisdiction: signal.jurisdiction });
  }
  // Temporal-window fallback when no parcel / jurisdiction hint.
  ors.push({
    AND: [
      { firstSignalAt: { lte: windowEnd } },
      { lastSignalAt: { gte: windowStart } },
    ],
  });

  const rows = await prisma.project.findMany({
    where: {
      AND: [
        { reviewStatus: { notIn: ineligible } },
        { lifecycleState: { notIn: ineligibleStates } },
        { OR: ors },
      ],
    },
    select: { id: true },
    take: CANDIDATE_LIMIT,
    orderBy: { lastSignalAt: "desc" },
  });

  return rows.map((r) => r.id);
}

/**
 * Project an existing Project's persisted state into a ProjectContext for
 * scoring. Fetches the project + its attached entities/parcels/recent signals
 * with bounded queries.
 */
export async function buildProjectContext(projectId: string): Promise<ProjectContext | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;

  const [entities, parcels, recentSignals, continuanceCount] = await Promise.all([
    prisma.projectEntity.findMany({
      where: { projectId, removed: false },
      select: { entityId: true, role: true },
    }),
    prisma.projectParcel.findMany({
      where: { projectId },
      select: { parcelId: true },
    }),
    prisma.projectSignal.findMany({
      where: { projectId, detachedAt: null },
      select: { factorJson: true, attachReason: true },
      orderBy: { attachedAt: "desc" },
      take: RECENT_TAG_WINDOW_SIGNALS,
    }),
    prisma.projectSignal.count({
      where: {
        projectId,
        detachedAt: null,
        OR: [
          { attachReason: { contains: "continued" } },
          { attachReason: { contains: "tabled" } },
        ],
      },
    }),
  ]);

  const entityIdsByRole = emptyRoleMap();
  for (const e of entities) {
    const role = e.role as ProjectEntityRole;
    if (role in entityIdsByRole) entityIdsByRole[role].push(e.entityId);
  }

  // Extract tags from attached signals' factorJson when present.
  const recentTags = new Set<string>();
  for (const s of recentSignals) {
    if (s.attachReason) recentTags.add(s.attachReason.toLowerCase());
    if (s.factorJson) {
      try {
        const parsed = JSON.parse(s.factorJson) as { tags?: string[] };
        if (Array.isArray(parsed.tags)) {
          for (const t of parsed.tags) recentTags.add(t);
        }
      } catch {
        // ignore non-JSON factorJson
      }
    }
  }

  // Shell-building pattern detector — present when project has industrial
  // parcels + engineer attached without owner.
  const hasShellBuildingPattern =
    parcels.length > 0 &&
    entityIdsByRole.ENGINEER.length > 0 &&
    entityIdsByRole.OWNER.length === 0 &&
    [...recentTags].some((t) => /industrial|m-?[12]|distribution|warehouse/.test(t));

  return {
    id: project.id,
    workingTitle: project.workingTitle,
    jurisdiction: project.jurisdiction,
    lifecycleState: project.lifecycleState as ProjectContext["lifecycleState"],
    firstSignalAt: project.firstSignalAt,
    lastSignalAt: project.lastSignalAt,
    parcelIds: parcels.map((p) => p.parcelId),
    entityIdsByRole,
    recentTags: [...recentTags],
    continuanceCount,
    hasShellBuildingPattern,
  };
}
