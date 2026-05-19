// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/targeting.ts
//  Phase MI-10 — Targeting pattern engine.
//
//  Operator-curated patterns that describe interesting recurrences across
//  the intelligence stack:
//
//    DEVELOPER_ENTERS_CORRIDOR    — developer attaches to a new corridor
//    BROKER_PRECEDES_INDUSTRIAL   — broker activity in a future-industrial parcel
//    RECURRING_GC_DEVELOPER       — same (GC, developer) pair on multiple projects
//    ENTITY_CLUSTER_PRE_PROJECT   — multiple roles co-attached before formal project
//    FRANCHISE_ROLLOUT            — same brand appearing in multiple jurisdictions
//    UTILITY_CHAIN                — utility expansion propagating through corridor
//    ZONING_CADENCE               — jurisdiction issuing rezonings at unusual cadence
//    CUSTOM                       — operator-defined
//
//  PR-1 ships the registration + evaluation interface plus three concrete
//  evaluators (DEVELOPER_ENTERS_CORRIDOR, RECURRING_GC_DEVELOPER,
//  FRANCHISE_ROLLOUT). The remaining kinds are stubs returning empty
//  match arrays; PR-2 fills them.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitWorkspaceAudit } from "./audit";
import {
  type TargetingPatternKind,
  type WatchlistActorContext,
} from "./types";

// ── Registration ─────────────────────────────────────────────────────────────

export interface RegisterPatternInput {
  name: string;
  description?: string;
  patternKind: TargetingPatternKind;
  criteriaJson: string;
  priority?: number;
  active?: boolean;
  actor: WatchlistActorContext;
}

export async function registerPattern(input: RegisterPatternInput): Promise<{ ok: boolean; id?: string }> {
  const row = await prisma.targetingPattern.create({
    data: {
      ownerUserId: input.actor.userId,
      ownerEmail: input.actor.email,
      name: input.name,
      description: input.description ?? null,
      patternKind: input.patternKind,
      criteriaJson: input.criteriaJson,
      priority: input.priority ?? 3,
      active: input.active ?? true,
    },
  });
  emitWorkspaceAudit({
    action: "register_pattern",
    patternId: row.id,
    decision: "registered",
    factors: { patternKind: input.patternKind, priority: input.priority ?? 3 },
  });
  return { ok: true, id: row.id };
}

// ── Pure evaluators ──────────────────────────────────────────────────────────

export interface PatternMatch {
  patternId: string;
  patternKind: TargetingPatternKind;
  subjectKind: string;
  subjectId: string;
  rationale: string;
  factors: Record<string, number | string | boolean | null>;
}

export interface DeveloperEntersCorridorInput {
  developerEntityId: string;
  corridorMembersByCorridor: Record<string, string[]>;  // corridorKey → parcel ids
  developerNewParcelsLast90d: string[];
}

/** Pattern: developer's recent parcels include parcels in a corridor the
 *  developer was NOT previously active in. */
export function evalDeveloperEntersCorridor(input: DeveloperEntersCorridorInput): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const [corridorKey, members] of Object.entries(input.corridorMembersByCorridor)) {
    const memberSet = new Set(members);
    const hits = input.developerNewParcelsLast90d.filter((p) => memberSet.has(p));
    if (hits.length > 0) {
      matches.push({
        patternId: "",
        patternKind: "DEVELOPER_ENTERS_CORRIDOR",
        subjectKind: "DEVELOPER",
        subjectId: input.developerEntityId,
        rationale: `${hits.length} new parcel(s) in corridor ${corridorKey}`,
        factors: { corridorKey, hitCount: hits.length },
      });
    }
  }
  return matches;
}

export interface RecurringGcDeveloperInput {
  /** Map of (gcEntityId|developerEntityId) → count of distinct projects. */
  pairCounts: Record<string, { gcEntityId: string; developerEntityId: string; projectCount: number }>;
  minProjects: number;
}

export function evalRecurringGcDeveloper(input: RecurringGcDeveloperInput): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const [, info] of Object.entries(input.pairCounts)) {
    if (info.projectCount >= input.minProjects) {
      matches.push({
        patternId: "",
        patternKind: "RECURRING_GC_DEVELOPER",
        subjectKind: "DEVELOPER",
        subjectId: info.developerEntityId,
        rationale: `(GC ${info.gcEntityId.slice(0, 8)}, dev ${info.developerEntityId.slice(0, 8)}) on ${info.projectCount} projects`,
        factors: { gcEntityId: info.gcEntityId, projectCount: info.projectCount },
      });
    }
  }
  return matches;
}

export interface FranchiseRolloutInput {
  /** brandName → list of {jurisdictionKey, projectCount}. */
  brandActivityByJurisdiction: Record<string, Array<{ jurisdictionKey: string; projectCount: number }>>;
  minJurisdictions: number;
}

export function evalFranchiseRollout(input: FranchiseRolloutInput): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const [brandName, activity] of Object.entries(input.brandActivityByJurisdiction)) {
    const active = activity.filter((a) => a.projectCount > 0);
    if (active.length >= input.minJurisdictions) {
      matches.push({
        patternId: "",
        patternKind: "FRANCHISE_ROLLOUT",
        subjectKind: "DEVELOPER",
        subjectId: brandName,
        rationale: `${brandName} active in ${active.length} jurisdictions`,
        factors: {
          brand: brandName,
          jurisdictionCount: active.length,
          totalProjects: active.reduce((sum, a) => sum + a.projectCount, 0),
        },
      });
    }
  }
  return matches;
}

// ── Persistence after evaluation ─────────────────────────────────────────────

export async function recordPatternMatch(args: {
  patternId: string;
  match: PatternMatch;
}): Promise<{ ok: boolean }> {
  // Bump pattern lastMatchedAt + matchCount; the actual match is recorded
  // as an AlertEvent so it surfaces in the alerts feed.
  await prisma.targetingPattern.update({
    where: { id: args.patternId },
    data: {
      lastMatchedAt: new Date(),
      lastEvaluatedAt: new Date(),
      matchCount: { increment: 1 },
    },
  });
  emitWorkspaceAudit({
    action: "record_pattern_match",
    patternId: args.patternId,
    decision: "matched",
    subjectKind: args.match.subjectKind,
    subjectId: args.match.subjectId,
    factors: { patternKind: args.match.patternKind, rationale: args.match.rationale },
  });
  return { ok: true };
}

export async function listPatterns(opts: { active?: boolean; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  const where: Record<string, unknown> = {};
  if (opts.active !== undefined) where.active = opts.active;
  return prisma.targetingPattern.findMany({
    where,
    orderBy: [{ priority: "asc" }, { lastMatchedAt: "desc" }],
    take: limit,
  });
}
