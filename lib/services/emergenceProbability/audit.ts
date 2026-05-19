// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/audit.ts
//  Phase MI-8 — Structured audit emission for forecast engine operations.
//
//  Single JSON line per forecast action to stdout. Suppressible via
//  FORECAST_AUDIT_QUIET=true.
// ──────────────────────────────────────────────────────────────────────────────

const AUDIT_PREFIX = "[emergence-forecast]";

export function emitForecastAudit(payload: {
  action: string;
  subjectKind: string;
  subjectId: string;
  decision?: string;
  score?: number;
  acceleration?: number;
  trajectoryState?: string;
  reasonLog?: string[];
  actorUserId?: string | null;
  actorEmail?: string | null;
  factors?: Record<string, number | string | boolean>;
}): void {
  if (process.env.FORECAST_AUDIT_QUIET === "true") return;
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
