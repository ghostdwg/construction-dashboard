// Phase MI-7 — public API for parcel memory + spatial emergence intelligence.

export {
  PARCEL_KINDS,
  PARCEL_REVIEW_STATES,
  PARCEL_CONFIDENCES,
  PARCEL_ALIAS_KINDS,
  PARCEL_ADJACENCY_KINDS,
  PARCEL_SIGNAL_KINDS,
  PARCEL_UTILITY_KINDS,
  PARCEL_UTILITY_AVAILABILITY,
  PARCEL_ZONING_KINDS,
  PARCEL_RESOLVER_VERSION,
  PRESSURE_VERSION,
  PRESSURE_FACTOR_WEIGHTS,
  PRESSURE_RECENCY_HALF_LIFE_DAYS,
  type ParcelKind,
  type ParcelReviewState,
  type ParcelConfidence,
  type ParcelAliasKind,
  type ParcelAdjacencyKind,
  type ParcelSignalKind,
  type ParcelUtilityKind,
  type ParcelUtilityAvailability,
  type ParcelZoningKind,
  type ParcelResolverPass,
  type ParcelRecord,
  type ParcelAliasRecord,
  type ParcelResolverInput,
  type ParcelResolverMatch,
  type ParcelResolverAuditEntry,
  type ParcelPressureInput,
  type ParcelPressureFactors,
  type ParcelPressureResult,
  type ParcelMemoryActorContext,
  type AdjacencyInferenceInput,
  type CorridorDetectionResult,
  type SpeculativeClusterResult,
  type RepeatedDeveloperFootprintResult,
} from "./types";

export { normalizeParcelRef, classifyParcelKind } from "./normalize";
export { scoreParcelMatch as scoreParcelSimilarity } from "./score";

export {
  resolveParcel,
  createCandidateParcel,
  queueParcelReview,
  type ParcelResolverOptions,
  type ResolveParcelResult,
} from "./resolver";

export {
  attachProjectToParcel,
  inferAdjacentParcels,
  detectCorridorEmergence,
  detectSpeculativeCluster,
  detectRepeatedDeveloperFootprint,
  type AttachProjectToParcelInput,
  type AttachProjectToParcelResult,
  type InferAdjacentParcelsOptions,
  type InferAdjacencyResult,
} from "./spatial";

export {
  computePressure,
  collectPressureInput,
  recordPressureSnapshot,
  computeRecencyMultiplier,
  scoreDeveloperRecurrence,
  scoreBrokerRecurrence,
  scoreEntitlementActivity,
  scoreUtilityExpansion,
  scoreContinuancePressure,
  scoreNeighborPressure,
  scoreShellClusterProximity,
  scoreOwnershipChurn,
  scoreInfrastructureInvestment,
  scoreCorridorAdjacency,
  type RecordPressureSnapshotOptions,
  type RecordPressureSnapshotResult,
} from "./pressure";

export {
  emitParcelResolverAudit,
  emitParcelMemoryAudit,
} from "./audit";
