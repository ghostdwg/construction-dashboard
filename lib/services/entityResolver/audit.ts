// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/audit.ts
//  Phase MI-2 — Resolver audit emission.
//
//  Every resolveEntity() invocation produces a structured ResolverAuditEntry.
//  Callers receive the entry inline (as part of the result) so they can
//  persist it alongside their own domain rows.
//
//  This module also emits the entry to stdout as a single JSON line prefixed
//  with [entity-resolver] for grep-ability in container logs.
//
//  Future hardening (out of MI-2 scope):
//    - Add a ResolverAuditLog table for durable per-call audit. Useful once
//      MI-3 backfill starts producing volume; until then, stdout + caller-
//      persisted records are sufficient.
//    - Add OpenTelemetry span emission for distributed tracing.
//
//  Operator override: setting RESOLVER_AUDIT_QUIET=true suppresses stdout
//  emission (the in-result audit entry is still returned).
// ──────────────────────────────────────────────────────────────────────────────

import type { ResolverAuditEntry } from "./types";

const AUDIT_PREFIX = "[entity-resolver]";

export function emitAudit(entry: ResolverAuditEntry): void {
  if (process.env.RESOLVER_AUDIT_QUIET === "true") return;
  // Single-line JSON so it's easy to grep, parse, and ship to a log
  // aggregator without multi-line reassembly.
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
