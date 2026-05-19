// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/resolver.ts
//  Phase MI-2 — Entity Resolution Engine v1.
//
//  Deterministic-first matching pipeline. Six passes, in order:
//
//    Pass 1 — exact normalized canonical name match            → HIGH confidence
//    Pass 2 — exact normalized alias match                     → HIGH confidence
//    Pass 3 — fuzzy bigram similarity >= fuzzyThreshold (0.85) → MEDIUM
//    Pass 4 — fuzzy 0.70–0.85, with optional Pass 6 arbitration
//             defaults to needsReview=true and (in resolveOrCreate mode)
//             creates a new entity at PENDING_REVIEW                 → LOW
//    Pass 5 — no candidates above review threshold
//             (in resolveOrCreate mode) creates entity at LOW_CONFIDENCE
//                                                              → LOW or NONE
//    Pass 6 — OPTIONAL LLM arbitration when multiple Pass-4 candidates
//             score within ambiguityDelta of each other. Default OFF;
//             requires RESOLVER_AMBIGUITY_LLM=true env. See llmArbitration.ts.
//
//  Philosophy:
//    The resolver MUST be explainable, auditable, deterministic-first,
//    reviewable, low-cost, and stable over time. Every call returns a
//    structured ResolverAuditEntry alongside the match so callers can
//    persist provenance. LLM calls are arbitration only — never the
//    primary path.
//
//  REJECTED entities are excluded from all passes — operator-tombstoned.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "./normalize";
import { scoreEntityMatch } from "./score";
import { runLlmArbitration } from "./llmArbitration";
import { emitAudit } from "./audit";
import {
  type EntityType,
  type ReviewState,
  type Confidence,
  type ResolverPass,
  type ResolverMatch,
  type ResolverAuditEntry,
  type EntityRecord,
  RESOLVER_VERSION,
} from "./types";

const HIGH_CONFIDENCE_FUZZY_THRESHOLD = 0.85;
const REVIEW_FUZZY_THRESHOLD = 0.7;
const AMBIGUITY_DELTA = 0.05;
const CANDIDATE_FETCH_LIMIT = 1000; // safety cap for fuzzy candidate pool

export interface ResolverOptions {
  /** Provenance label for audit. Examples: "watchlist", "backfill",
   *  "ingestion:permit", "manual". Defaults to "ingestion". */
  source?: string;
  /** Override Pass 3 high-confidence threshold (default 0.85). */
  fuzzyThreshold?: number;
  /** Override Pass 4 review threshold (default 0.70). */
  reviewThreshold?: number;
  /** Override the ambiguity delta for Pass 6 (default 0.05). */
  ambiguityDelta?: number;
  /** Enable Pass 6 LLM arbitration. Requires RESOLVER_AMBIGUITY_LLM=true env.
   *  Even when enabled, MI-2 ships an arbitration stub. */
  enableLlmArbitration?: boolean;
  /** When false, resolveEntity behaves as findEntity — never creates new
   *  rows. Defaults to true (Pass 4 creates a PENDING_REVIEW row,
   *  Pass 5 creates a LOW_CONFIDENCE row). */
  create?: boolean;
}

export interface ResolveEntityResult {
  match: ResolverMatch;
  audit: ResolverAuditEntry;
  /** The Entity row associated with this resolution, or null when no entity
   *  was matched or created. Distinct from `match.entity` which is the
   *  trimmed UI-facing projection. */
  entity: EntityRecord | null;
  /** True when this call created a new Entity row (Pass 4 or Pass 5 in
   *  resolveOrCreate mode). */
  created: boolean;
}

/**
 * Resolve a free-text name into a canonical Entity, creating one if none
 * exists (when `opts.create !== false` AND `type` is provided).
 *
 * For read-only resolution that never writes, pass `opts.create = false` or
 * omit `type`.
 */
export async function resolveEntity(
  name: string,
  type: EntityType | null = null,
  opts: ResolverOptions = {}
): Promise<ResolveEntityResult> {
  const fuzzyHi = opts.fuzzyThreshold ?? HIGH_CONFIDENCE_FUZZY_THRESHOLD;
  const reviewThr = opts.reviewThreshold ?? REVIEW_FUZZY_THRESHOLD;
  const ambDelta = opts.ambiguityDelta ?? AMBIGUITY_DELTA;
  const source = opts.source ?? "ingestion";
  const create = opts.create !== false && type !== null;
  const timestamp = new Date().toISOString();
  const normalized = normalizeEntityName(name);

  function build(
    pass: ResolverPass,
    result: ResolverAuditEntry["result"],
    entity: EntityRecord | null,
    confidence: Confidence,
    similarityScore: number | null,
    candidates: ResolverMatch["candidates"],
    needsReview: boolean,
    reason: string,
    created: boolean
  ): ResolveEntityResult {
    const audit: ResolverAuditEntry = {
      inputName: name,
      inputType: type,
      normalizedInput: normalized,
      pass,
      result,
      entityId: entity?.id ?? null,
      confidence,
      similarityScore,
      candidateIds: candidates.map((c) => c.id),
      resolverVersion: RESOLVER_VERSION,
      source,
      timestamp,
    };
    emitAudit(audit);
    return {
      match: {
        entity: entity
          ? {
              id: entity.id,
              canonicalName: entity.canonicalName,
              entityType: entity.entityType,
              reviewStatus: entity.reviewStatus,
            }
          : null,
        confidence,
        pass,
        similarityScore,
        needsReview,
        reason,
        candidates,
      },
      audit,
      entity,
      created,
    };
  }

  if (!normalized) {
    return build(5, "no_match", null, "NONE", null, [], false,
      "empty_or_unnormalizable_input", false);
  }

  // ── Pass 1: exact normalizedName match ────────────────────────────────────
  const pass1Candidate = await prisma.entity.findFirst({
    where: {
      normalizedName: normalized,
      ...(type ? { entityType: type } : {}),
    },
  });
  if (pass1Candidate && pass1Candidate.reviewStatus !== "REJECTED") {
    return build(1, "matched", pass1Candidate as EntityRecord, "HIGH", null,
      [], false, "exact_normalized_name", false);
  }

  // ── Pass 2: exact normalizedAlias match ───────────────────────────────────
  const pass2Alias = await prisma.entityAlias.findFirst({
    where: { normalizedAlias: normalized },
    include: { entity: true },
  });
  if (
    pass2Alias &&
    pass2Alias.entity &&
    pass2Alias.entity.reviewStatus !== "REJECTED" &&
    (!type || pass2Alias.entity.entityType === type)
  ) {
    return build(2, "matched", pass2Alias.entity as EntityRecord, "HIGH",
      null, [], false, "exact_normalized_alias", false);
  }

  // ── Pass 3/4/5: fuzzy similarity ──────────────────────────────────────────
  const candidatePool = await prisma.entity.findMany({
    where: {
      NOT: { reviewStatus: "REJECTED" },
      ...(type ? { entityType: type } : {}),
    },
    take: CANDIDATE_FETCH_LIMIT,
    orderBy: { updatedAt: "desc" },
  });

  const scored = candidatePool
    .map((c) => ({
      entity: c as EntityRecord,
      score: scoreEntityMatch(normalized, c.normalizedName),
    }))
    .filter((s) => s.score >= reviewThr)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Pass 5 — no candidates above review threshold
    if (!create) {
      return build(5, "no_match", null, "NONE", null, [], false,
        "no_candidates_above_review_threshold", false);
    }
    const newEntity = await createCandidateEntity(
      name,
      type as EntityType,
      normalized,
      "LOW",
      "LOW_CONFIDENCE",
      source
    );
    return build(5, "created", newEntity, "LOW", null, [], false,
      "auto_created_low_confidence", true);
  }

  const best = scored[0];
  const closeCandidates = scored.filter((s) => best.score - s.score <= ambDelta);
  const candidateOut = closeCandidates.map((s) => ({
    id: s.entity.id,
    canonicalName: s.entity.canonicalName,
    similarityScore: s.score,
  }));

  if (best.score >= fuzzyHi) {
    // Pass 3 — high-confidence fuzzy match
    return build(3, "matched", best.entity, "MEDIUM", best.score,
      candidateOut, false, `fuzzy_${best.score.toFixed(3)}`, false);
  }

  // Pass 4 — needs review. Optionally try Pass 6 arbitration first.
  if (opts.enableLlmArbitration && closeCandidates.length > 1) {
    const arbitratedId = await runLlmArbitration({
      inputName: name,
      inputType: type,
      candidates: closeCandidates,
    });
    if (arbitratedId) {
      const arbitrated = closeCandidates.find((s) => s.entity.id === arbitratedId);
      if (arbitrated) {
        return build(6, "matched", arbitrated.entity, "MEDIUM",
          arbitrated.score, candidateOut, false, "llm_arbitrated", false);
      }
    }
  }

  // Pass 4 default: surface candidates, optionally create a PENDING_REVIEW row
  if (!create) {
    return build(4, "needs_review", best.entity, "LOW", best.score,
      candidateOut, true, `fuzzy_${best.score.toFixed(3)}_needs_review`, false);
  }

  const newEntity = await createCandidateEntity(
    name,
    type as EntityType,
    normalized,
    "LOW",
    "PENDING_REVIEW",
    source
  );
  return build(4, "created", newEntity, "LOW", best.score, candidateOut, true,
    `fuzzy_${best.score.toFixed(3)}_pending_review`, true);
}

/**
 * Create a new Entity row directly, bypassing the resolver passes.
 *
 * Used by:
 *   - Pass 4 and Pass 5 in resolveEntity (auto-created candidates)
 *   - MI-3 backfill seeding (watchlist materialization at VERIFIED status)
 *   - Operator UI manual creation (MI-4)
 *
 * On unique-constraint violation (rare: another concurrent caller raced us
 * to create the same normalizedName), refetches and returns the existing row.
 */
export async function createCandidateEntity(
  canonicalName: string,
  entityType: EntityType,
  normalizedName: string | null,
  confidence: Confidence,
  reviewStatus: ReviewState,
  source: string | undefined
): Promise<EntityRecord> {
  const normalized = normalizedName ?? normalizeEntityName(canonicalName);
  try {
    const entity = await prisma.entity.create({
      data: {
        canonicalName: canonicalName.trim(),
        normalizedName: normalized,
        entityType,
        confidence,
        reviewStatus,
        source: source ?? "resolver",
      },
    });
    return entity as EntityRecord;
  } catch (err) {
    // P2002 — unique constraint on normalizedName. Race with another caller
    // (or pre-existing REJECTED row with same normalizedName). Refetch and
    // return existing.
    const existing = await prisma.entity.findFirst({
      where: { normalizedName: normalized },
    });
    if (existing) return existing as EntityRecord;
    throw err;
  }
}

/**
 * Force an Entity into PENDING_REVIEW state — used when an external signal
 * (operator manual flag, AI low-confidence call, downstream conflict) wants
 * to drop an entity back into the review queue.
 */
export async function queueReviewCandidate(entityId: string): Promise<void> {
  await prisma.entity.update({
    where: { id: entityId },
    data: { reviewStatus: "PENDING_REVIEW" },
  });
}
