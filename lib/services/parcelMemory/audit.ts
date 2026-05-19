// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/audit.ts
//  Phase MI-7 — Structured audit emission for parcel memory operations.
//
//  Single JSON line per parcel-memory action to stdout. Suppressible via
//  PARCEL_AUDIT_QUIET=true.
// ──────────────────────────────────────────────────────────────────────────────

import type { ParcelResolverAuditEntry } from "./types";

const AUDIT_PREFIX = "[parcel-memory]";

export function emitParcelResolverAudit(entry: ParcelResolverAuditEntry): void {
  if (process.env.PARCEL_AUDIT_QUIET === "true") return;
  console.info(`${AUDIT_PREFIX} ${JSON.stringify({ action: "resolve", ...entry })}`);
}

export function emitParcelMemoryAudit(payload: {
  action: string;
  parcelId: string | null;
  decision?: string;
  score?: number;
  reasonLog?: string[];
  actorUserId?: string | null;
  actorEmail?: string | null;
  factors?: Record<string, number | string | boolean>;
}): void {
  if (process.env.PARCEL_AUDIT_QUIET === "true") return;
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
