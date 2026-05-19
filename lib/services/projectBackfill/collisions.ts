// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/collisions.ts
//  Phase MI-6 PR2 — Project-level collision detection.
//
//  Five detectors, all pure given their projection inputs. The execute()
//  layer fetches the relevant snapshots; these functions take the slices.
//  Mirrors MI-3 collisions.ts pattern for entities.
// ──────────────────────────────────────────────────────────────────────────────

import {
  scoreEntityMatch,
} from "@/lib/services/entityResolver";
import type { ProjectCollisionFinding } from "./types";

// Inputs are deliberately minimal record shapes so tests can construct them
// without Prisma.

export interface ProjectSnapshot {
  id: string;
  workingTitle: string;
  jurisdiction: string | null;
  reviewStatus: string;
  parcelIds: string[];
  developerIds: string[];
  signalScores: number[];        // attachScores of all attached, non-detached signals
  signalJurisdictions: string[]; // distinct jurisdictions across attached signals
}

// ── #1 likely_duplicate_pair ─────────────────────────────────────────────────
//
// Pairs of non-rejected projects with: matching parcel ID OR matching
// developer entity AND ≥ 0.85 working-title similarity.

const TITLE_DUPLICATE_THRESHOLD = 0.85;

export function findLikelyDuplicates(projects: ProjectSnapshot[]): ProjectCollisionFinding[] {
  const active = projects.filter((p) => p.reviewStatus !== "REJECTED" && p.reviewStatus !== "MERGED");
  const out: ProjectCollisionFinding[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      const parcelOverlap = a.parcelIds.some((p) => b.parcelIds.includes(p));
      const developerOverlap = a.developerIds.some((d) => b.developerIds.includes(d));

      if (!parcelOverlap && !developerOverlap) continue;

      const titleScore = scoreEntityMatch(
        normalizeTitle(a.workingTitle),
        normalizeTitle(b.workingTitle)
      );
      if (titleScore < TITLE_DUPLICATE_THRESHOLD && !parcelOverlap) continue;

      out.push({
        kind: "likely_duplicate_pair",
        projectIds: [a.id, b.id],
        description:
          `"${a.workingTitle}" and "${b.workingTitle}" share ` +
          (parcelOverlap ? "parcel(s)" : "") +
          (parcelOverlap && developerOverlap ? " + " : "") +
          (developerOverlap ? "developer" : "") +
          (titleScore >= TITLE_DUPLICATE_THRESHOLD
            ? ` + title similarity ${titleScore.toFixed(2)}`
            : ""),
        recommendedAction:
          "Operator decision: merge one into the other (MI-6 PR3 UI) or " +
          "confirm distinct (often phasing pattern: same developer + adjacent parcels).",
        evidence: { parcelOverlap, developerOverlap, titleScore },
      });
    }
  }
  return out;
}

// ── #2 over_merged_cluster ───────────────────────────────────────────────────
//
// Projects with ≥ N signals where the spread between min and max attach
// score is large (≥ 0.5), suggesting the cluster contains two distinct
// projects with one weakly-attached.

const MIN_SIGNALS_FOR_CLUSTER_CHECK = 6;
const ATTACH_SCORE_SPREAD_THRESHOLD = 0.5;

export function findOverMergedClusters(projects: ProjectSnapshot[]): ProjectCollisionFinding[] {
  const out: ProjectCollisionFinding[] = [];
  for (const p of projects) {
    if (p.signalScores.length < MIN_SIGNALS_FOR_CLUSTER_CHECK) continue;
    const min = Math.min(...p.signalScores);
    const max = Math.max(...p.signalScores);
    if (max - min < ATTACH_SCORE_SPREAD_THRESHOLD) continue;
    out.push({
      kind: "over_merged_cluster",
      projectIds: [p.id],
      description:
        `Project "${p.workingTitle}" has ${p.signalScores.length} signals ` +
        `with attach scores spanning ${min.toFixed(2)}–${max.toFixed(2)}. ` +
        `The weakly-attached signals may belong to a separate project.`,
      recommendedAction:
        "Operator: inspect the lowest-score signals; split into a new project " +
        "if they don't belong (MI-6 PR3 UI).",
      evidence: { minScore: min, maxScore: max, spread: max - min, signalCount: p.signalScores.length },
    });
  }
  return out;
}

// ── #3 weakly_related_signals ────────────────────────────────────────────────
//
// Project where the median attach score is below 0.4 — overall the
// aggregation is suspect.

const WEAK_MEDIAN_THRESHOLD = 0.4;
const MIN_SIGNALS_FOR_WEAK_CHECK = 3;

export function findWeaklyRelatedSignals(projects: ProjectSnapshot[]): ProjectCollisionFinding[] {
  const out: ProjectCollisionFinding[] = [];
  for (const p of projects) {
    if (p.signalScores.length < MIN_SIGNALS_FOR_WEAK_CHECK) continue;
    const sorted = [...p.signalScores].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    if (median >= WEAK_MEDIAN_THRESHOLD) continue;
    out.push({
      kind: "weakly_related_signals",
      projectIds: [p.id],
      description:
        `Project "${p.workingTitle}" has median attach score ` +
        `${median.toFixed(2)} (< ${WEAK_MEDIAN_THRESHOLD}). The aggregation is suspect.`,
      recommendedAction:
        "Operator: review all attached signals; consider rejecting the project " +
        "or splitting into smaller aggregates with stronger evidence.",
      evidence: { median, signalCount: p.signalScores.length },
    });
  }
  return out;
}

// ── #4 jurisdiction_drift ────────────────────────────────────────────────────
//
// Project where attached signals span more than 1 distinct jurisdiction.
// Sometimes valid (corridor projects, multi-county developments), often a
// sign of mis-attachment.

export function findJurisdictionDrift(projects: ProjectSnapshot[]): ProjectCollisionFinding[] {
  const out: ProjectCollisionFinding[] = [];
  for (const p of projects) {
    const distinct = new Set(p.signalJurisdictions.filter((j) => j && j.trim().length > 0));
    if (distinct.size <= 1) continue;
    out.push({
      kind: "jurisdiction_drift",
      projectIds: [p.id],
      description:
        `Project "${p.workingTitle}" has signals from ${distinct.size} distinct ` +
        `jurisdictions: ${[...distinct].slice(0, 5).join(", ")}. ` +
        "Often a sign of mis-attachment, occasionally valid for corridor projects.",
      recommendedAction:
        "Operator: confirm whether the project genuinely spans jurisdictions, " +
        "or split out the off-jurisdiction signals into a separate aggregate.",
      evidence: { jurisdictions: [...distinct] },
    });
  }
  return out;
}

// ── #5 parcel_divergence ─────────────────────────────────────────────────────
//
// Project with > 3 parcels OR parcels from > 1 parcelSource. Could be a
// legitimate multi-parcel assembly, or an aggregation that pulled in too
// much. Flagged so operator can confirm.

const PARCEL_COUNT_DIVERGENCE_THRESHOLD = 3;

export interface ProjectParcelSnapshot {
  id: string;
  workingTitle: string;
  reviewStatus: string;
  parcels: Array<{ parcelId: string; parcelSource: string }>;
}

export function findParcelDivergence(
  projects: ProjectParcelSnapshot[]
): ProjectCollisionFinding[] {
  const out: ProjectCollisionFinding[] = [];
  for (const p of projects) {
    if (p.reviewStatus === "REJECTED" || p.reviewStatus === "MERGED") continue;
    if (p.parcels.length < PARCEL_COUNT_DIVERGENCE_THRESHOLD) continue;
    const sources = new Set(p.parcels.map((x) => x.parcelSource));
    if (p.parcels.length < PARCEL_COUNT_DIVERGENCE_THRESHOLD + 1 && sources.size <= 1) continue;
    out.push({
      kind: "parcel_divergence",
      projectIds: [p.id],
      description:
        `Project "${p.workingTitle}" has ${p.parcels.length} parcels ` +
        `from ${sources.size} source(s). Verify this is intentional assembly.`,
      recommendedAction:
        "Operator: confirm multi-parcel assembly; otherwise split the project.",
      evidence: { parcelCount: p.parcels.length, parcelSources: [...sources] },
    });
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Run all detectors and return findings. Inputs are decoupled so the
 * execute() layer can fetch each projection from Prisma once per run.
 */
export function detectProjectCollisions(args: {
  projects: ProjectSnapshot[];
  parcelSnapshots: ProjectParcelSnapshot[];
}): ProjectCollisionFinding[] {
  return [
    ...findLikelyDuplicates(args.projects),
    ...findOverMergedClusters(args.projects),
    ...findWeaklyRelatedSignals(args.projects),
    ...findJurisdictionDrift(args.projects),
    ...findParcelDivergence(args.parcelSnapshots),
  ];
}
