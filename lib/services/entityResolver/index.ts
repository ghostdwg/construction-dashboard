// Phase MI-2 — public API for the Entity Resolution Engine.
//
// Callers should import from this barrel rather than reaching into individual
// modules so internal refactors stay opaque.

export { normalizeEntityName } from "./normalize";
export { scoreEntityMatch } from "./score";
export {
  resolveEntity,
  createCandidateEntity,
  queueReviewCandidate,
  type ResolverOptions,
  type ResolveEntityResult,
} from "./resolver";
export { emitAudit } from "./audit";
export { runLlmArbitration } from "./llmArbitration";
export {
  ENTITY_TYPES,
  REVIEW_STATES,
  CONFIDENCES,
  RESOLVER_VERSION,
  type EntityType,
  type ReviewState,
  type Confidence,
  type ResolverPass,
  type ResolverMatch,
  type ResolverAuditEntry,
  type EntityRecord,
  type AliasRecord,
} from "./types";
