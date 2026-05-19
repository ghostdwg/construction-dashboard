// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/resolver.ts
//  Phase MI-7 — Parcel Resolution Engine v1.
//
//  Deterministic-first matching pipeline for parcel references. Five passes,
//  in order:
//
//    Pass 1 — exact normalized canonicalRef match            → HIGH confidence
//    Pass 2 — exact normalized alias match                   → HIGH confidence
//    Pass 3 — fuzzy bigram similarity ≥ fuzzyThreshold (0.85) → MEDIUM
//    Pass 4 — fuzzy 0.70–0.85
//             (in resolveOrCreate mode) creates parcel at PENDING_REVIEW → LOW
//    Pass 5 — no candidates above review threshold
//             (in resolveOrCreate mode) creates parcel at LOW + reviewStatus
//             AUTO so future passes (or operators) can revisit it
//                                                            → LOW or NONE
//
//  Philosophy:
//    The resolver MUST be explainable, auditable, deterministic-first,
//    reviewable, low-cost, and stable over time. Every call returns a
//    structured ParcelResolverAuditEntry alongside the match so callers can
//    persist provenance. No LLMs — parcel-ref ambiguity is operator territory.
//
//  REJECTED parcels are excluded from all passes — operator-tombstoned.
//  MERGED parcels also act as exclusions (they're not the canonical row);
//  callers wanting the merge target should walk via Parcel.mergedInto.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { normalizeParcelRef, classifyParcelKind } from "./normalize";
import { scoreParcelMatch } from "./score";
import { emitParcelResolverAudit } from "./audit";
import {
  type ParcelKind,
  type ParcelConfidence,
  type ParcelResolverPass,
  type ParcelResolverMatch,
  type ParcelResolverAuditEntry,
  type ParcelRecord,
  type ParcelResolverInput,
  PARCEL_RESOLVER_VERSION,
} from "./types";

const HIGH_CONFIDENCE_FUZZY_THRESHOLD = 0.85;
const REVIEW_FUZZY_THRESHOLD = 0.7;
const AMBIGUITY_DELTA = 0.05;
const CANDIDATE_FETCH_LIMIT = 1000;

export interface ParcelResolverOptions {
  source?: string;
  fuzzyThreshold?: number;
  reviewThreshold?: number;
  ambiguityDelta?: number;
  /** When false, behaves as findParcel — never creates new rows. */
  create?: boolean;
}

export interface ResolveParcelResult {
  match: ParcelResolverMatch;
  audit: ParcelResolverAuditEntry;
  parcel: ParcelRecord | null;
  created: boolean;
}

function buildResult(
  input: ParcelResolverInput,
  normalized: string,
  pass: ParcelResolverPass,
  result: ParcelResolverAuditEntry["result"],
  parcel: ParcelRecord | null,
  confidence: ParcelConfidence,
  similarityScore: number | null,
  candidates: ParcelResolverMatch["candidates"],
  needsReview: boolean,
  reason: string,
  source: string,
  created: boolean
): ResolveParcelResult {
  const audit: ParcelResolverAuditEntry = {
    inputRef: input.rawRef,
    normalizedInput: normalized,
    pass,
    result,
    parcelId: parcel?.id ?? null,
    confidence,
    similarityScore,
    candidateIds: candidates.map((c) => c.id),
    resolverVersion: PARCEL_RESOLVER_VERSION,
    source,
    timestamp: new Date().toISOString(),
  };
  emitParcelResolverAudit(audit);
  return {
    match: {
      parcel,
      confidence,
      pass,
      similarityScore,
      needsReview,
      reason,
      candidates,
    },
    audit,
    parcel,
    created,
  };
}

/**
 * Resolve a free-text parcel reference into a canonical Parcel, creating
 * one if none exists (when `opts.create !== false`).
 *
 * For read-only resolution that never writes, pass `opts.create = false`.
 *
 * Optional `input.jurisdiction` narrows the candidate pool — strongly
 * recommended for fuzzy passes because an address like "5301 Main St" is
 * highly ambiguous without a city.
 */
export async function resolveParcel(
  input: ParcelResolverInput,
  opts: ParcelResolverOptions = {}
): Promise<ResolveParcelResult> {
  const fuzzyHi = opts.fuzzyThreshold ?? HIGH_CONFIDENCE_FUZZY_THRESHOLD;
  const reviewThr = opts.reviewThreshold ?? REVIEW_FUZZY_THRESHOLD;
  const ambDelta = opts.ambiguityDelta ?? AMBIGUITY_DELTA;
  const source = opts.source ?? input.source ?? "ingestion";
  const create = opts.create !== false;

  const kind = input.kind ?? classifyParcelKind(input.rawRef);
  const normalized = normalizeParcelRef(input.rawRef, kind);

  if (!normalized) {
    return buildResult(input, normalized, 5, "no_match", null, "LOW", null, [],
      false, "empty_or_unnormalizable_input", source, false);
  }

  const jurisdictionFilter = input.jurisdiction
    ? { jurisdiction: input.jurisdiction }
    : {};

  // ── Pass 1: exact normalizedRef match ────────────────────────────────────
  const pass1 = await prisma.parcel.findFirst({
    where: {
      normalizedRef: normalized,
      NOT: { reviewStatus: { in: ["REJECTED", "MERGED"] } },
      ...jurisdictionFilter,
    },
  });
  if (pass1) {
    return buildResult(input, normalized, 1, "matched", pass1 as ParcelRecord,
      "HIGH", null, [], false, "exact_normalized_ref", source, false);
  }

  // ── Pass 2: exact normalized alias match ─────────────────────────────────
  const pass2 = await prisma.parcelAlias.findFirst({
    where: { normalizedAlias: normalized },
    include: { parcel: true },
  });
  if (
    pass2 &&
    pass2.parcel &&
    pass2.parcel.reviewStatus !== "REJECTED" &&
    pass2.parcel.reviewStatus !== "MERGED" &&
    (!input.jurisdiction || pass2.parcel.jurisdiction === input.jurisdiction)
  ) {
    return buildResult(input, normalized, 2, "matched",
      pass2.parcel as ParcelRecord, "HIGH", null, [], false,
      "exact_normalized_alias", source, false);
  }

  // ── Pass 3/4/5: fuzzy similarity ─────────────────────────────────────────
  // Narrow by parcelKind when possible to reduce noise — an assessor id should
  // never fuzzy-match an address. Jurisdiction filter further narrows.
  const candidatePool = await prisma.parcel.findMany({
    where: {
      NOT: { reviewStatus: { in: ["REJECTED", "MERGED"] } },
      ...(kind && kind !== "UNKNOWN" ? { parcelKind: kind } : {}),
      ...jurisdictionFilter,
    },
    take: CANDIDATE_FETCH_LIMIT,
    orderBy: { updatedAt: "desc" },
  });

  const scored = candidatePool
    .map((c) => ({
      parcel: c as ParcelRecord,
      score: scoreParcelMatch(normalized, c.normalizedRef),
    }))
    .filter((s) => s.score >= reviewThr)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    if (!create) {
      return buildResult(input, normalized, 5, "no_match", null, "LOW", null,
        [], false, "no_candidates_above_review_threshold", source, false);
    }
    const created = await createCandidateParcel(input, kind, normalized,
      "LOW", "AUTO", source);
    return buildResult(input, normalized, 5, "created", created, "LOW", null,
      [], false, "auto_created_low_confidence", source, true);
  }

  const best = scored[0];
  const closeCandidates = scored.filter((s) => best.score - s.score <= ambDelta);
  const candidateOut = closeCandidates.map((s) => ({
    id: s.parcel.id,
    canonicalRef: s.parcel.canonicalRef,
    similarityScore: s.score,
  }));

  if (best.score >= fuzzyHi) {
    return buildResult(input, normalized, 3, "matched", best.parcel, "MEDIUM",
      best.score, candidateOut, false, `fuzzy_${best.score.toFixed(3)}`, source, false);
  }

  // Pass 4 — needs review.
  if (!create) {
    return buildResult(input, normalized, 4, "needs_review", best.parcel,
      "LOW", best.score, candidateOut, true,
      `fuzzy_${best.score.toFixed(3)}_needs_review`, source, false);
  }

  const created = await createCandidateParcel(input, kind, normalized, "LOW",
    "PENDING_REVIEW", source);
  return buildResult(input, normalized, 4, "created", created, "LOW",
    best.score, candidateOut, true,
    `fuzzy_${best.score.toFixed(3)}_pending_review`, source, true);
}

/**
 * Create a new Parcel row directly, bypassing the resolver passes.
 *
 * Used by:
 *   - Pass 4 and Pass 5 in resolveParcel (auto-created candidates)
 *   - MI-7 PR-2 backfill seeding
 *   - Operator UI manual creation (MI-7 PR-3)
 *
 * On unique-constraint violation (rare: another concurrent caller raced us
 * to create the same normalizedRef), refetches and returns the existing row.
 */
export async function createCandidateParcel(
  input: ParcelResolverInput,
  kind: ParcelKind,
  normalizedRef: string,
  confidence: ParcelConfidence,
  reviewStatus: "AUTO" | "AUTO_MATCHED" | "PENDING_REVIEW" | "VERIFIED",
  source: string
): Promise<ParcelRecord> {
  const canonicalRef = input.rawRef.trim();
  const assessorId = kind === "ASSESSOR" ? canonicalRef : null;
  const address = kind === "ADDRESS_ONLY" ? canonicalRef : null;
  const legal = kind === "LEGAL" ? canonicalRef : null;

  try {
    const parcel = await prisma.parcel.create({
      data: {
        canonicalRef,
        normalizedRef,
        parcelKind: kind,
        assessorParcelId: assessorId,
        primaryAddress: address,
        legalDescription: legal,
        jurisdiction: input.jurisdiction ?? null,
        state: input.state ?? null,
        confidence,
        reviewStatus,
        source,
      },
    });
    return parcel as ParcelRecord;
  } catch (err) {
    const existing = await prisma.parcel.findFirst({
      where: { normalizedRef },
    });
    if (existing) return existing as ParcelRecord;
    throw err;
  }
}

/**
 * Force a Parcel into PENDING_REVIEW state — used when an external signal
 * (operator manual flag, conflict in MI-7 PR-3 governance) wants to drop a
 * parcel back into the review queue.
 */
export async function queueParcelReview(parcelId: string): Promise<void> {
  await prisma.parcel.update({
    where: { id: parcelId },
    data: { reviewStatus: "PENDING_REVIEW" },
  });
}
