// Phase MI-3 — public API for the Entity Backfill pipeline.

export { parseWatchlist, materializeSeed, readWatchlist, WATCHLIST_DEFAULT_PATH } from "./seed";
export { buildPlan, type BackfillPlan } from "./plan";
export { runBackfill } from "./execute";
export { buildReport, formatReport } from "./report";
export {
  detectCollisions,
  findSharedNormalizedAcrossTypes,
  findVeryClosePairs,
  findAliasLoops,
  findPendingReviewClusters,
} from "./collisions";
export {
  readCheckpoint,
  writeCheckpoint,
  initialCheckpoint,
  checkpointMatchesRun,
} from "./checkpoint";
export type {
  BackfillOptions,
  BackfillMode,
  BackfillTier,
  BackfillTable,
  BackfillReport,
  WatchlistSeedEntry,
  CheckpointState,
  CollisionCandidate,
  ManualReviewRow,
} from "./types";
