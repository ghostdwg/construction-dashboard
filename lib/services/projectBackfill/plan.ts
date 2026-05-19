// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/plan.ts
//  Phase MI-6 PR2 — Read-only dry-run preview.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { ProjectBackfillOptions } from "./types";

export interface ProjectBackfillPlan {
  tier: string;
  mode: string;
  aggregatorVersion: string;
  totals: {
    relationshipEdgeRows: number;
    relationshipEdgeAlreadyAttached: number;
    marketLeadRows: number;
    marketLeadAlreadyAttached: number;
    marketSignalRows: number;
    marketSignalAlreadyAttached: number;
    existingProjects: number;
  };
  estimatedRowsToProcess: number;
  estimatedBatches: number;
  notes: string[];
}

export async function buildPlan(
  opts: ProjectBackfillOptions,
  aggregatorVersion: string
): Promise<ProjectBackfillPlan> {
  const notes: string[] = [];

  const [
    edgeTotal,
    edgeAttached,
    leadTotal,
    leadAttached,
    signalTotal,
    signalAttached,
    projectTotal,
  ] = await Promise.all([
    prisma.relationshipEdge.count(),
    prisma.projectSignal.count({ where: { signalKind: "RELATIONSHIP_EDGE", detachedAt: null } }),
    prisma.marketLead.count(),
    prisma.projectSignal.count({ where: { signalKind: "MARKET_LEAD", detachedAt: null } }),
    prisma.marketSignal.count(),
    prisma.projectSignal.count({ where: { signalKind: "MARKET_SIGNAL", detachedAt: null } }),
    prisma.project.count(),
  ]);

  const sourcesEnabled = new Set(opts.sources);
  const toProcess =
    (sourcesEnabled.has("RelationshipEdge") ? Math.max(0, edgeTotal - (opts.mode === "replay" ? 0 : edgeAttached)) : 0) +
    (sourcesEnabled.has("MarketLead") ? Math.max(0, leadTotal - (opts.mode === "replay" ? 0 : leadAttached)) : 0) +
    (sourcesEnabled.has("MarketSignal") ? Math.max(0, signalTotal - (opts.mode === "replay" ? 0 : signalAttached)) : 0);
  const capped = opts.maxRows ? Math.min(toProcess, opts.maxRows) : toProcess;

  if (projectTotal === 0) notes.push("Project table empty — Phase B will create the first Project Aggregates.");
  if (edgeAttached > 0 && opts.mode !== "replay") {
    notes.push(`${edgeAttached} RelationshipEdge rows already attached. Use --replay to re-aggregate.`);
  }
  if (signalAttached > 0 && opts.mode !== "replay") {
    notes.push(`${signalAttached} MarketSignal rows already attached. Use --replay to re-aggregate.`);
  }
  if (edgeTotal === 0 && leadTotal === 0 && signalTotal === 0) {
    notes.push("WARNING: corpus is empty — no signals to aggregate.");
  }

  return {
    tier: opts.tier,
    mode: opts.mode,
    aggregatorVersion,
    totals: {
      relationshipEdgeRows: edgeTotal,
      relationshipEdgeAlreadyAttached: edgeAttached,
      marketLeadRows: leadTotal,
      marketLeadAlreadyAttached: leadAttached,
      marketSignalRows: signalTotal,
      marketSignalAlreadyAttached: signalAttached,
      existingProjects: projectTotal,
    },
    estimatedRowsToProcess: capped,
    estimatedBatches: Math.ceil(capped / opts.batchSize),
    notes,
  };
}
