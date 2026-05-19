// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/liveIngestion/audit.ts
//  Phase MI-5 — Structured ingestion audit emission.
//
//  Suppressible via INGESTION_AUDIT_QUIET=true.
// ──────────────────────────────────────────────────────────────────────────────

import type { IngestionAuditEntry } from "./types";

const AUDIT_PREFIX = "[live-ingestion]";

export function emitIngestionAudit(entry: IngestionAuditEntry): void {
  if (process.env.INGESTION_AUDIT_QUIET === "true") return;
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
