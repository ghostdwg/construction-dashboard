// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/audit.ts
//  Phase MI-10 — Structured audit emission for workspace operations.
//
//  Single JSON line per action to stdout. Suppressible via
//  WORKSPACE_AUDIT_QUIET=true.
// ──────────────────────────────────────────────────────────────────────────────

const AUDIT_PREFIX = "[operator-workspace]";

export function emitWorkspaceAudit(payload: {
  action: string;
  surfaceKind?: string;
  watchlistId?: string;
  alertRuleId?: string;
  alertEventId?: string;
  briefingId?: string;
  patternId?: string;
  subjectKind?: string;
  subjectId?: string;
  decision?: string;
  severity?: string;
  reasonLog?: string[];
  actorUserId?: string | null;
  actorEmail?: string | null;
  factors?: Record<string, number | string | boolean | null>;
}): void {
  if (process.env.WORKSPACE_AUDIT_QUIET === "true") return;
  const entry = { timestamp: new Date().toISOString(), ...payload };
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
