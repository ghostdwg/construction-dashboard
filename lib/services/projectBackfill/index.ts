// Phase MI-6 PR2 — public API for project-aggregation backfill.

export {
  relationshipEdgeToSignalInput,
  marketLeadToSignalInput,
  marketSignalToSignalInput,
  type RelationshipEdgeRow,
  type MarketLeadRow,
  type MarketSignalRow,
} from "./signalSources";

export {
  fetchCandidateProjectIds,
  buildProjectContext,
} from "./candidatePool";

export {
  initialCheckpoint,
  readCheckpoint,
  writeCheckpoint,
  checkpointCompatible,
} from "./checkpoint";

export { buildPlan, type ProjectBackfillPlan } from "./plan";

export {
  detectProjectCollisions,
  findLikelyDuplicates,
  findOverMergedClusters,
  findWeaklyRelatedSignals,
  findJurisdictionDrift,
  findParcelDivergence,
  type ProjectSnapshot,
  type ProjectParcelSnapshot,
} from "./collisions";

export { runProjectBackfill } from "./execute";
export { buildReport, formatReport } from "./report";

export type {
  ProjectBackfillOptions,
  BackfillMode,
  BackfillTier,
  BackfillSource,
  CheckpointState,
  ProjectBackfillReport,
  ProjectCollisionFinding,
  PerSignalOutcome,
} from "./types";
