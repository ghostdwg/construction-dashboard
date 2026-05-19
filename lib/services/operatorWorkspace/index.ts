// Phase MI-10 — public API for the Operator Workspace.

export {
  WATCHLIST_SUBJECT_KINDS,
  WATCHLIST_VISIBILITIES,
  WATCHLIST_ATTACH_REASONS,
  ALERT_TRIGGER_KINDS,
  ALERT_SEVERITIES,
  ALERT_REVIEW_STATES,
  ALERT_DELIVERY_CHANNELS,
  BRIEFING_KINDS,
  BRIEFING_STATUSES,
  BRIEFING_SECTION_KINDS,
  TARGETING_PATTERN_KINDS,
  ALERT_EXPLANATION_KINDS,
  WORKSPACE_LAYOUTS,
  ALERT_SUBJECT_KINDS,
  WORKSPACE_VERSION,
  SEVERITY_FLOORS,
  DEFAULT_SEVERITY_FLOOR,
  DEFAULT_ALERT_COOLDOWN_MINUTES,
  severityRank,
  type WatchlistSubjectKind,
  type WatchlistVisibility,
  type WatchlistAttachReason,
  type AlertTriggerKind,
  type AlertSeverity,
  type AlertReviewState,
  type AlertDeliveryChannel,
  type BriefingKind,
  type BriefingStatus,
  type BriefingSectionKind,
  type TargetingPatternKind,
  type AlertExplanationKind,
  type WorkspaceLayout,
  type AlertSubjectKind,
  type WatchlistActorContext,
  type AlertRuleCriteria,
  type IntelligenceSurfaceItem,
  type IntelligenceSurfaceResult,
  type BriefingGeneratorInput,
  type BriefingGeneratorSection,
  type BriefingGeneratorResult,
  type AlertEvaluationContext,
  type AlertEvaluationResult,
} from "./types";

export {
  createWatchlist,
  updateWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  listWatchlists,
  getWatchlist,
  type CreateWatchlistInput,
  type UpdateWatchlistInput,
  type AddWatchlistItemInput,
  type RemoveWatchlistItemInput,
  type ListWatchlistsOptions,
} from "./watchlist";

export {
  evaluateAlertRule,
  createAlertRule,
  recordAlertEvent,
  reviewAlertEvent,
  type CreateAlertRuleInput,
  type RecordAlertEventInput,
  type AlertReviewActionInput,
} from "./alerts";

export {
  generateBriefing,
  persistBriefing,
  type PersistBriefingInput,
} from "./briefing";

export {
  registerPattern,
  evalDeveloperEntersCorridor,
  evalRecurringGcDeveloper,
  evalFranchiseRollout,
  recordPatternMatch,
  listPatterns,
  type RegisterPatternInput,
  type DeveloperEntersCorridorInput,
  type RecurringGcDeveloperInput,
  type FranchiseRolloutInput,
  type PatternMatch,
} from "./targeting";

export {
  surfaceEmergingNow,
  surfaceAcceleratingCorridors,
  surfaceJurisdictionAcceleration,
  surfaceRepeatedDeveloperMovement,
  surfaceHighConfidenceForecasts,
  surfaceTimelinePullIn,
  surfaceSpeculativeShell,
  surfaceUtilityPropagation,
  surfaceBrokerClustering,
  summarizeWorkspaceSurfaces,
} from "./intelligenceSurfaces";

export { emitWorkspaceAudit } from "./audit";
