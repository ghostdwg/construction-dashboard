// Phase O1.2 — public API for the observability layer.

export {
  AUDIT_SCHEMA_VERSION,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
  ACTOR_KINDS,
  LOKI_LABEL_FIELDS,
  DB_PERSISTED_CATEGORIES,
  SEVERITY_RANK,
  shouldPersistToDb,
  severityAtLeast,
  configuredMinSeverity,
  audiosSuppressed,
  type AuditCategory,
  type AuditSeverity,
  type ActorKind,
  type AuditEnvelope,
} from "./taxonomy";

export {
  currentCorrelationContext,
  withCorrelationContext,
  withCorrelationContextAsync,
  newCorrelationId,
  newReplayId,
  newRunnerId,
  newIngestionId,
  type CorrelationContext,
} from "./correlation";

export {
  emitAuditEvent,
  emitAuditEventNoAwait,
  type EmitAuditEventInput,
} from "./audit";

export {
  STANDARD_LATENCY_BUCKETS,
  recordAuditEmission,
  recordAuditPersistenceFailure,
  recordIngestionProcessed,
  recordIngestionDuration,
  recordResolverLatency,
  recordForecastDuration,
  recordCalibrationDuration,
  recordReplayDuration,
  recordRunnerCycle,
  recordRunnerCycleDuration,
  recordAlertFired,
  recordIngestionPipelineError,
  recordSignalSuppression,
  recordSignalClassification,
  recordRunnerSourceProcessed,
  recordRunnerScrapeFailure,
  setRunnerDueSources,
  setRunnerStaleSourceCount,
  recordForecastRecomputed,
  recordForecastFailure,
  recordForecastTrajectoryShift,
  setForecastHighEmergenceCount,
  setForecastOverriddenCount,
  recordAlertCandidate,
  recordAlertSuppressed,
  recordAlertPersisted,
  setAlertsUnreadCount,
  renderPrometheus,
  resetMetrics,
} from "./metrics";

export {
  runRunnerCycle,
  type RunnerCycleOptions,
  type RunnerCycleResult,
} from "./runner";
