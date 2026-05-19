// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/collisions.ts
//  Phase MI-3 — Collision and false-merge detection.
//
//  After backfill completes, scan the Entity / EntityAlias tables for
//  patterns that suggest the resolver made a wrong choice or the corpus
//  exposed an ambiguity the resolver couldn't decide on. Each result is
//  a CollisionCandidate the operator's MI-4 review UI surfaces.
//
//  Pure-function design wherever possible: pass in arrays of entities /
//  aliases / relationships, return findings. The CLI layer calls Prisma
//  to fetch the inputs; the analysis is testable in isolation.
// ──────────────────────────────────────────────────────────────────────────────

import { scoreEntityMatch } from "@/lib/services/entityResolver";
import type { EntityRecord, AliasRecord } from "@/lib/services/entityResolver";
import type { CollisionCandidate } from "./types";

/** Same normalizedName, different entityType — the schema's @unique guarantees
 *  this can't happen, but operator-edited rows could land here in theory. */
export function findSharedNormalizedAcrossTypes(
  entities: EntityRecord[]
): CollisionCandidate[] {
  const byNorm = new Map<string, EntityRecord[]>();
  for (const e of entities) {
    if (e.reviewStatus === "REJECTED") continue;
    const bucket = byNorm.get(e.normalizedName) ?? [];
    bucket.push(e);
    byNorm.set(e.normalizedName, bucket);
  }
  const out: CollisionCandidate[] = [];
  for (const [normName, bucket] of byNorm) {
    if (bucket.length <= 1) continue;
    const types = new Set(bucket.map((e) => e.entityType));
    if (types.size > 1) {
      out.push({
        kind: "shared_normalized_form_across_types",
        entityIds: bucket.map((e) => e.id),
        description:
          `${bucket.length} entities share normalizedName="${normName}" ` +
          `across types [${[...types].join(", ")}]. Operator should disambiguate.`,
        recommendedAction:
          "Inspect each entity and decide whether to merge or keep distinct " +
          "(e.g., 'polk' might be Polk County Municipality AND Polk Inc Developer).",
      });
    }
  }
  return out;
}

/** Two distinct entities with canonical fuzzy similarity ≥ 0.92 — likely a
 *  resolver miss when one of them was created. */
export function findVeryClosePairs(
  entities: EntityRecord[],
  threshold = 0.92
): CollisionCandidate[] {
  const active = entities.filter((e) => e.reviewStatus !== "REJECTED");
  // Group by entityType — cross-type matches at high score are vanishingly
  // rare for our domain and would flood the queue.
  const byType = new Map<string, EntityRecord[]>();
  for (const e of active) {
    const bucket = byType.get(e.entityType) ?? [];
    bucket.push(e);
    byType.set(e.entityType, bucket);
  }
  const out: CollisionCandidate[] = [];
  for (const bucket of byType.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const score = scoreEntityMatch(bucket[i].normalizedName, bucket[j].normalizedName);
        if (score >= threshold) {
          out.push({
            kind: "very_close_canonical_pair",
            entityIds: [bucket[i].id, bucket[j].id],
            description:
              `"${bucket[i].canonicalName}" and "${bucket[j].canonicalName}" ` +
              `score ${score.toFixed(3)} similarity. Likely duplicates.`,
            recommendedAction:
              "Operator should verify and either merge (keep one canonical + " +
              "alias the other) or confirm distinct (no action; flag the case " +
              "to inform future normalizer adjustments).",
          });
        }
      }
    }
  }
  return out;
}

/** An alias whose normalizedAlias matches another entity's canonical
 *  normalizedName. Means the resolver could route the same input to two
 *  different entities depending on which table it hits first. */
export function findAliasLoops(
  entities: EntityRecord[],
  aliases: AliasRecord[]
): CollisionCandidate[] {
  const byNormName = new Map<string, EntityRecord>();
  for (const e of entities) {
    if (e.reviewStatus === "REJECTED") continue;
    byNormName.set(e.normalizedName, e);
  }
  const out: CollisionCandidate[] = [];
  for (const a of aliases) {
    const conflicting = byNormName.get(a.normalizedAlias);
    if (!conflicting) continue;
    if (conflicting.id === a.entityId) continue; // same entity — fine
    out.push({
      kind: "alias_loop",
      entityIds: [a.entityId, conflicting.id],
      description:
        `Alias "${a.alias}" on entity ${a.entityId} resolves to the same ` +
        `normalizedAlias="${a.normalizedAlias}" as canonical entity ` +
        `${conflicting.id} ("${conflicting.canonicalName}"). ` +
        "Pass 1 vs Pass 2 race depends on resolver ordering.",
      recommendedAction:
        "Either merge the two entities, or remove the alias if it was attached " +
        "to the wrong parent.",
    });
  }
  return out;
}

/** Clusters of ≥ N PENDING_REVIEW entities sharing fuzzy similarity neighborhoods.
 *  Signals the resolver hit a noisy corner that needs operator attention. */
export function findPendingReviewClusters(
  entities: EntityRecord[],
  minClusterSize = 5,
  similarityThreshold = 0.75
): CollisionCandidate[] {
  const pending = entities.filter((e) => e.reviewStatus === "PENDING_REVIEW");
  if (pending.length < minClusterSize) return [];

  // Simple union-find clustering by pairwise similarity
  const parent = new Map<string, string>();
  for (const e of pending) parent.set(e.id, e.id);
  function find(x: string): string {
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const s = scoreEntityMatch(pending[i].normalizedName, pending[j].normalizedName);
      if (s >= similarityThreshold) union(pending[i].id, pending[j].id);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const e of pending) {
    const root = find(e.id);
    const bucket = clusters.get(root) ?? [];
    bucket.push(e.id);
    clusters.set(root, bucket);
  }
  const out: CollisionCandidate[] = [];
  for (const ids of clusters.values()) {
    if (ids.length < minClusterSize) continue;
    out.push({
      kind: "pending_review_cluster",
      entityIds: ids,
      description:
        `${ids.length} PENDING_REVIEW entities within similarity ` +
        `${similarityThreshold.toFixed(2)} — likely a corpus hotspot where ` +
        "the resolver couldn't decide. Worth a single operator pass.",
      recommendedAction:
        "Open the manual review UI filtered by this cluster; bulk-merge or " +
        "bulk-reject; consider seeding a new watchlist canonical if a true " +
        "entity emerges.",
    });
  }
  return out;
}

/** Run all detectors. Returns a flat list ordered by severity. */
export function detectCollisions(
  entities: EntityRecord[],
  aliases: AliasRecord[]
): CollisionCandidate[] {
  return [
    ...findSharedNormalizedAcrossTypes(entities),
    ...findVeryClosePairs(entities),
    ...findAliasLoops(entities, aliases),
    ...findPendingReviewClusters(entities),
  ];
}
