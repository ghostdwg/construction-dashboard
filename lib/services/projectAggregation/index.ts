// Phase MI-6 — public API for the Project Aggregate Engine.

export {
  LIFECYCLE_STATES,
  PROJECT_REVIEW_STATES,
  SIGNAL_KINDS,
  PROJECT_ENTITY_ROLES,
  TIMELINE_EVENT_TYPES,
  AGGREGATOR_VERSION,
  SCORE_THRESHOLDS,
  FACTOR_WEIGHTS,
  type LifecycleState,
  type ProjectReviewState,
  type SignalKind,
  type ProjectEntityRole,
  type TimelineEventType,
  type SignalInput,
  type ProjectContext,
  type SimilarityFactors,
  type SimilarityResult,
  type ContinuationDecision,
  type AggregatorActorContext,
} from "./types";

export { canTransition, isTerminal, suggestNextState } from "./lifecycle";

export {
  scoreParcelMatch,
  scoreDeveloperMatch,
  scoreEngineerMatch,
  scoreBrokerMatch,
  scoreJurisdictionMatch,
  scoreZoningContinuity,
  scoreUtilityExtension,
  scoreTemporalProximity,
  scoreTitleSimilarity,
  scoreAgendaContinuity,
  scoreContinuanceCount,
  scoreShellBuildingPattern,
} from "./heuristics";

export { scoreProjectSimilarity, scoreAgainstCandidates } from "./similarity";

export {
  createProjectAggregate,
  attachSignalToProject,
  attachEntityToProject,
  detectProjectContinuation,
  updateProjectProbability,
  transitionState,
} from "./aggregator";

export {
  inferRelatedEntities,
  inferRelatedParcels,
  type InferredEntity,
  type InferredParcel,
} from "./inference";

export { recordTimelineEvent, recordSignalAttached } from "./timeline";
export { emitAggregatorAudit } from "./audit";
