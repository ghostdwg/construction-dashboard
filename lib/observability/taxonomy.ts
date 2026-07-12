// ──────────────────────────────────────────────────────────────────────────────
//  lib/observability/taxonomy.ts
//  Phase O1.2 — Canonical audit-event taxonomy.
//
//  The platform's existing 7 service audit emitters (entity-resolver,
//  project-aggregator, parcel-memory, emergence-forecast,
//  outcome-calibration, operator-workspace, live-ingestion) remain
//  unchanged — they continue emitting stdout JSON for Promtail/Loki to
//  scrape. This module defines a *canonical envelope* for NEW audit
//  emissions that need:
//
//    1. Cross-service correlation (a single user action might touch
//       3 services; we want to query "everything that happened in this
//       request")
//    2. Replay tracking (backfill / replay-validation runs)
//    3. DB-backed persistence beyond Loki retention (operator overrides,
//       migration runs, runner cycles)
//
//  Bump SCHEMA_VERSION when the envelope shape changes. Consumers
//  (dashboards, audit-replay tools) check the version to handle
//  format migrations gracefully.
// ──────────────────────────────────────────────────────────────────────────────

export const AUDIT_SCHEMA_VERSION = "1.0" as const;

// ── Categories ──────────────────────────────────────────────────────────────
//
// One category per top-level audit stream. Maps loosely to the existing 7
// service prefixes plus the operationalization categories that didn't have
// homes before.

export const AUDIT_CATEGORIES = [
  "entity_resolution",        // entity resolver decisions
  "relationship_resolution",  // RelationshipEdge → EntityRelationship resolution
  "project_attachment",       // project aggregator decisions
  "project_governance",       // project verify/reject/merge/transition
  "parcel_resolution",        // parcel resolver decisions
  "parcel_attachment",        // parcel→project linking, adjacency, corridor detect
  "parcel_pressure",          // pressure snapshot writes
  "forecast_generation",      // emergence engine fires
  "trajectory_classification",// trajectory state transitions
  "calibration_adjustment",   // outcome resolution + calibration recs/applies
  "ingestion_decision",       // live ingestion outcomes
  "alert_fire",               // alert rule fired
  "alert_review",             // operator acknowledged/dismissed/escalated alert
  "operator_override",        // operator-initiated mutation that overrides automation
  "merge_split",              // entity/project/parcel merge or split
  "replay_run",               // backfill / replay-validation cycle
  "migration_governance",     // migration apply, lint, replay
  "runner_cycle",             // scheduled forecast/calibration/briefing/alert runner
  "review_action",            // operator review queue actions (verify/reject/dispute)
  "ingestion_pipeline_error", // stdout-only fireAndForget failure path
  "system_health",            // backup verified, scraper failed, etc.
  "ai_prompt_scan",           // P2-A0 — shadow, non-blocking heuristic prompt scan (gateway.ts)
  "register_action",          // OPS1 tracked-item register: status transitions, close/waive, attachment upload, OAC promotion (human-only actions)
  "consultant_report",        // OPS3 Phase 1A — consultant report/revision/observation lifecycle + formal-response edits (human-only actions)
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

// ── Severities ──────────────────────────────────────────────────────────────

export const AUDIT_SEVERITIES = [
  "DEBUG",     // verbose; not routed to operator dashboards
  "INFO",      // normal operation
  "NOTICE",    // consequential decision (project created, calibration applied)
  "WARN",      // degraded but not failed
  "ERROR",     // failure
  "CRITICAL",  // operator action required
] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

// ── Actor kinds ─────────────────────────────────────────────────────────────

export const ACTOR_KINDS = ["operator", "system", "runner", "api", "anonymous"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

// ── Canonical envelope ──────────────────────────────────────────────────────
//
// Every NEW audit emission uses this shape. Existing services keep their
// service-specific shapes (Promtail extracts labels by prefix). Over time,
// services that need cross-service correlation can be migrated.

export interface AuditEnvelope {
  /** Envelope shape version. Bump on breaking changes. */
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  /** Canonical event category — drives downstream routing. */
  category: AuditCategory;
  /** Service-specific verb (e.g. "create_watchlist", "fire_alert"). */
  action: string;
  /** Severity drives dashboard prominence + on-call routing. */
  severity: AuditSeverity;
  /** RFC3339/ISO8601. Auto-filled by emitter if omitted. */
  timestamp: string;

  // ── Correlation envelope ───────────────────────────────────────────────────
  /** Request-scoped id (propagated via AsyncLocalStorage when available). */
  correlationId: string | null;
  /** Replay / backfill cycle id; null when not in a replay context. */
  replayId: string | null;
  /** MarketSourceDoc / ingestion batch id; null when not ingestion-related. */
  ingestionId: string | null;
  /** Scheduled runner cycle id; null when not a runner cycle. */
  runnerId: string | null;

  // ── Actor ──────────────────────────────────────────────────────────────────
  actor: {
    kind: ActorKind;
    userId: string | null;
    email: string | null;
  };

  // ── Subject ────────────────────────────────────────────────────────────────
  /** The subject the action operated on (loose-pointer). Null for system-wide events. */
  subject: {
    kind: string;       // PROJECT | PARCEL | CORRIDOR | JURISDICTION | DEVELOPER | ENTITY | OUTCOME | ...
    id: string;
  } | null;

  // ── Version snapshot ──────────────────────────────────────────────────────
  //
  // Engine versions captured at emit time — supports forward-compatible
  // re-evaluation when a version tag bumps.
  versions: {
    resolverVersion?: string;
    aggregatorVersion?: string;
    pressureVersion?: string;
    forecastVersion?: string;
    calibrationVersion?: string;
    workspaceVersion?: string;
    ingestionVersion?: string;
  };

  // ── Payload ────────────────────────────────────────────────────────────────
  /** Decision label — "matched", "fired", "created", "merged", etc. */
  decision: string | null;
  /** Human-readable reason log. Bounded array; not free-form prose. */
  reasonLog: string[];
  /** Free-form payload. Keep small (< 4KB) for Loki indexing. */
  payload: Record<string, unknown> | null;
}

// ── Loki label projection ──────────────────────────────────────────────────
//
// Promtail extracts these fields as Loki labels for fast filtering.
// Cardinality matters — keep this list small. Other fields land in the
// JSON body (searchable via LogQL but not indexed as labels).

export const LOKI_LABEL_FIELDS = [
  "category",
  "action",
  "severity",
  "actor_kind",
  "subject_kind",
] as const;

// ── Persistence routing ─────────────────────────────────────────────────────
//
// Which categories must persist to the AuditEvent DB table beyond Loki?
// Default-routed categories are emitted to BOTH stdout (Loki) AND the
// DB; others are stdout-only.
//
// Rule: any operator-driven mutation OR any cross-cycle event MUST persist
// to DB. High-volume engine events stay in Loki only.

export const DB_PERSISTED_CATEGORIES = new Set<AuditCategory>([
  "operator_override",
  "merge_split",
  "replay_run",
  "migration_governance",
  "runner_cycle",
  "review_action",
  "alert_review",
  "calibration_adjustment",    // operator-applied calibration writes only — emitter must filter
  "ingestion_pipeline_error",  // stdout-only failures elevated to DB
  "system_health",
  "register_action",           // OPS1 — operator-consequential register mutations persist forever
  "consultant_report",         // OPS3 Phase 1A — every consultant-report mutation is operator-driven; persists forever
]);

export function shouldPersistToDb(category: AuditCategory): boolean {
  return DB_PERSISTED_CATEGORIES.has(category);
}

// ── Severity rank (for filtering / alerting) ────────────────────────────────

export const SEVERITY_RANK: Record<AuditSeverity, number> = {
  DEBUG: 0,
  INFO: 1,
  NOTICE: 2,
  WARN: 3,
  ERROR: 4,
  CRITICAL: 5,
};

export function severityAtLeast(actual: AuditSeverity, threshold: AuditSeverity): boolean {
  return SEVERITY_RANK[actual] >= SEVERITY_RANK[threshold];
}

// ── Severity threshold for stdout emission ──────────────────────────────────
//
// Set OBSERVABILITY_AUDIT_LEVEL=NOTICE in production to drop DEBUG/INFO from
// stdout (Loki still receives them if you raise the level, but most
// deployments don't need them).

export function configuredMinSeverity(): AuditSeverity {
  const env = process.env.OBSERVABILITY_AUDIT_LEVEL?.toUpperCase();
  if (env && (AUDIT_SEVERITIES as readonly string[]).includes(env)) {
    return env as AuditSeverity;
  }
  return "INFO";
}

// ── Universal suppression ──────────────────────────────────────────────────
//
// OBSERVABILITY_AUDIT_QUIET=true suppresses ALL stdout emissions (DB
// persistence still happens). Useful for tests. Distinct from the legacy
// per-service *_AUDIT_QUIET vars which still work for back-compat.

export function audiosSuppressed(): boolean {
  return process.env.OBSERVABILITY_AUDIT_QUIET === "true";
}
