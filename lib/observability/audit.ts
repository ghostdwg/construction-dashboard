// ──────────────────────────────────────────────────────────────────────────────
//  lib/observability/audit.ts
//  Phase O1.2 — Canonical audit emitter with correlation + DB persistence.
//
//  Fan-out architecture:
//
//        emitAuditEvent(envelope)
//             │
//             ├── stdout JSON line  (always; suppressed by OBSERVABILITY_AUDIT_QUIET)
//             │   ──→ Promtail scrapes ──→ Loki (90d hot, 1y cold via S3)
//             │
//             └── DB AuditEvent row (only when category is in DB_PERSISTED_CATEGORIES)
//                 ──→ persists forever (operator-queryable)
//
//  The existing 7 service emitters (entity-resolver, project-aggregator,
//  parcel-memory, emergence-forecast, outcome-calibration,
//  operator-workspace, live-ingestion) keep their service-specific shapes.
//  Promtail scrapes them by prefix and extracts labels. This module is for
//  NEW emissions that need correlation, replay tracking, or DB persistence.
//
//  Service-specific emitters CAN opt into this canonical path by calling
//  emitAuditEvent(...) ALONGSIDE their existing emitAudit(...) call —
//  giving them DB-backed persistence + correlation IDs without changing
//  their public API. See operatorWorkspace/audit.ts for the POC.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { recordAuditEmission, recordAuditPersistenceFailure } from "./metrics";
import {
  type AuditCategory,
  type AuditSeverity,
  type AuditEnvelope,
  AUDIT_SCHEMA_VERSION,
  configuredMinSeverity,
  audiosSuppressed,
  severityAtLeast,
  shouldPersistToDb,
} from "./taxonomy";
import { currentCorrelationContext } from "./correlation";

const AUDIT_PREFIX = "[audit]";

export interface EmitAuditEventInput {
  category: AuditCategory;
  action: string;
  severity?: AuditSeverity;
  decision?: string;
  reasonLog?: string[];
  subject?: { kind: string; id: string } | null;
  actor?: {
    kind?: "operator" | "system" | "runner" | "api" | "anonymous";
    userId?: string | null;
    email?: string | null;
  };
  /** Engine version snapshot — copy from FORECAST_VERSION etc. */
  versions?: AuditEnvelope["versions"];
  payload?: Record<string, unknown>;
  /** Override correlation ids when AsyncLocalStorage isn't sufficient. */
  correlationId?: string | null;
  replayId?: string | null;
  ingestionId?: string | null;
  runnerId?: string | null;
  /** Force DB persistence even if category is not in default DB-persisted set.
   *  Use sparingly — most operator-relevant events are already routed. */
  forceDbPersist?: boolean;
  /** Skip DB persistence even if category would normally persist. Reserved
   *  for benchmark/test paths. */
  skipDbPersist?: boolean;
}

/** Build the canonical envelope from emitter input (correlation-context aware). */
export function buildAuditEnvelope(input: EmitAuditEventInput): AuditEnvelope {
  const ctx = currentCorrelationContext();
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    category: input.category,
    action: input.action,
    severity: input.severity ?? "INFO",
    timestamp: new Date().toISOString(),
    correlationId: input.correlationId ?? ctx.correlationId ?? null,
    replayId: input.replayId ?? ctx.replayId ?? null,
    ingestionId: input.ingestionId ?? ctx.ingestionId ?? null,
    runnerId: input.runnerId ?? ctx.runnerId ?? null,
    actor: {
      kind: input.actor?.kind ?? ctx.actorKind ?? "system",
      userId: input.actor?.userId ?? ctx.actorUserId ?? null,
      email: input.actor?.email ?? ctx.actorEmail ?? null,
    },
    subject: input.subject ?? null,
    versions: input.versions ?? {},
    decision: input.decision ?? null,
    reasonLog: input.reasonLog ?? [],
    payload: input.payload ?? null,
  };
}

/** Minimal client shape needed to persist an AuditEvent row — satisfied by
 *  both the shared prisma client and an interactive-transaction client. */
export type AuditEventWriter = {
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

/**
 * Persist one envelope as an AuditEvent row via the given client. THROWS on
 * failure — callers choose the failure policy. Inside a transaction this is
 * the FAIL-CLOSED path: a failed audit write rolls the whole mutation back
 * (GroundWorX audit policy — audit may never fail open for accountability-
 * relevant mutations).
 */
export async function persistAuditEnvelope(
  db: AuditEventWriter,
  envelope: AuditEnvelope
): Promise<void> {
  await db.auditEvent.create({
    data: {
      category: envelope.category,
      action: envelope.action,
      severity: envelope.severity,
      subjectKind: envelope.subject?.kind ?? null,
      subjectId: envelope.subject?.id ?? null,
      actorUserId: envelope.actor.userId,
      actorEmail: envelope.actor.email,
      actorKind: envelope.actor.kind,
      correlationId: envelope.correlationId,
      replayId: envelope.replayId,
      ingestionId: envelope.ingestionId,
      runnerId: envelope.runnerId,
      schemaVersion: envelope.schemaVersion,
      versionTagsJson:
        Object.keys(envelope.versions).length > 0
          ? JSON.stringify(envelope.versions)
          : null,
      decision: envelope.decision,
      reasonLog:
        envelope.reasonLog.length > 0 ? JSON.stringify(envelope.reasonLog) : null,
      payloadJson: envelope.payload ? JSON.stringify(envelope.payload) : null,
    },
  });
}

/** Stdout/metrics fan-out for an envelope. Call AFTER the owning transaction
 *  commits so the Loki stream never reports a rolled-back mutation. */
export function emitAuditEnvelopeStdout(envelope: AuditEnvelope): void {
  const minLevel = configuredMinSeverity();
  if (!audiosSuppressed() && severityAtLeast(envelope.severity, minLevel)) {
    // Single-line JSON; Promtail extracts labels via pipeline_stages.
    console.info(`${AUDIT_PREFIX} ${JSON.stringify(envelope)}`);
  }
  recordAuditEmission(envelope.category, envelope.severity);
}

export async function emitAuditEvent(input: EmitAuditEventInput): Promise<void> {
  const envelope = buildAuditEnvelope(input);

  // ── Stdout fan-out ──────────────────────────────────────────────────────
  emitAuditEnvelopeStdout(envelope);

  // ── DB persistence fan-out ──────────────────────────────────────────────
  const shouldPersist = input.skipDbPersist
    ? false
    : input.forceDbPersist || shouldPersistToDb(envelope.category);

  if (shouldPersist) {
    try {
      await persistAuditEnvelope(prisma, envelope);
    } catch (err) {
      // Legacy fail-open path (telemetry-grade events): persistence must
      // never break the calling service. Accountability-relevant mutations
      // do NOT use this path — they persist via persistAuditEnvelope inside
      // their own transaction, where a failure rolls the mutation back.
      recordAuditPersistenceFailure(envelope.category);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `${AUDIT_PREFIX} CRITICAL audit-persist-failed category=${envelope.category} action=${envelope.action} err=${errMsg}`
      );
    }
  }
}

/** Sync-safe wrapper. Returns immediately; persistence happens async. Use
 *  this from hot paths that can't await. Errors are swallowed (logged). */
export function emitAuditEventNoAwait(input: EmitAuditEventInput): void {
  emitAuditEvent(input).catch((err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`${AUDIT_PREFIX} CRITICAL emit-failed err=${errMsg}`);
  });
}
