// Phase O1.4 — public API for runner orchestration.

export {
  RUNNER_WINDOW_GRANULARITIES,
  RUNNER_LEASE_STATES,
  type RunnerWindowGranularity,
  type RunnerLeaseState,
  type RunnerDefinition,
  type RunnerContext,
  type RunCycleOptions,
  type RunCycleResult,
  type RunnerInstanceId,
} from "./types";

export {
  deriveWindow,
  type WindowBounds,
} from "./windowKey";

export {
  claimLease,
  heartbeatLease,
  finalizeLease,
  findStaleLeases,
  markLeaseStale,
  recentLeases,
  currentInstance,
  instanceLabel,
  type ClaimedLease,
  type ClaimLeaseResult,
} from "./lease";

export { runCycle } from "./dispatcher";

export {
  registerRunner,
  getRunner,
  listRunners,
} from "./registry";
