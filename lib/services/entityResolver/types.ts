// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/types.ts
//  Phase MI-2 — Entity Resolution Engine v1 types and pseudo-enums.
//
//  Pseudo-enums are exported as `as const` arrays + derived union types so:
//   - Prisma schema columns can stay TEXT (no migration needed to add values)
//   - app code gets compile-time exhaustiveness
//   - JSON/AI payloads can validate against the array at runtime
// ──────────────────────────────────────────────────────────────────────────────

export const ENTITY_TYPES = [
  "Developer",
  "Owner",
  "Broker",
  "GC",
  "Architect",
  "Engineer",
  "Municipality",
  "Tenant",
  "Lender",
  "Agency",
  "Unknown",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const REVIEW_STATES = [
  "VERIFIED",        // operator-confirmed canonical entity
  "AUTO_MATCHED",    // resolver attached this row via Pass 1/2/3
  "PENDING_REVIEW",  // Pass 4 — fuzzy match below confidence threshold; needs operator
  "LOW_CONFIDENCE",  // Pass 5 — auto-created without any candidate; needs operator eventually
  "REJECTED",        // operator rejected; resolver skips on future passes
  "AUTO",            // legacy default from MI-1 schema; treated as "unmoderated; resolver may touch"
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export type ResolverPass = 1 | 2 | 3 | 4 | 5 | 6;

// Bumps when normalize.ts rules change OR resolver pass behavior changes.
// Future backfill (MI-3) records this on RelationshipEdge.resolverVersion so
// past resolutions can be selectively re-evaluated.
export const RESOLVER_VERSION = "v1" as const;

// ─── Wire shapes ─────────────────────────────────────────────────────────────

export interface EntityRecord {
  id: string;
  canonicalName: string;
  normalizedName: string;
  entityType: string;
  reviewStatus: string;
  confidence: string;
  source: string | null;
}

export interface AliasRecord {
  id: string;
  entityId: string;
  alias: string;
  normalizedAlias: string;
  confidence: string;
}

export interface ScoredCandidate {
  entity: EntityRecord;
  score: number;
}

export interface ResolverMatchEntity {
  id: string;
  canonicalName: string;
  entityType: string;
  reviewStatus: string;
}

export interface ResolverMatch {
  // Best-resolved entity or null if no resolution was made.
  entity: ResolverMatchEntity | null;
  confidence: Confidence;
  pass: ResolverPass;
  // Fuzzy similarity score in [0,1] for Pass 3/4, null for exact matches and no-match.
  similarityScore: number | null;
  // True when the caller should defer commit to operator review (Pass 4).
  needsReview: boolean;
  // Human-readable trace for the audit log: "exact_normalized_name" |
  // "exact_normalized_alias" | "fuzzy_0.873" | "fuzzy_0.741_needs_review" |
  // "auto_created_low_confidence" | "no_candidates_above_review_threshold" |
  // "llm_arbitrated" | "empty_or_unnormalizable_input" | ...
  reason: string;
  // For Pass 3/4, populated with all candidates within `ambiguityDelta` of the
  // best score — surfaces the disambiguation choice to the operator/UI.
  candidates: Array<{
    id: string;
    canonicalName: string;
    similarityScore: number;
  }>;
}

export interface ResolverAuditEntry {
  inputName: string;
  inputType: EntityType | null;
  normalizedInput: string;
  pass: ResolverPass;
  result: "matched" | "created" | "no_match" | "needs_review";
  entityId: string | null;
  confidence: Confidence;
  similarityScore: number | null;
  candidateIds: string[];
  resolverVersion: typeof RESOLVER_VERSION;
  source: string;
  timestamp: string;
}
