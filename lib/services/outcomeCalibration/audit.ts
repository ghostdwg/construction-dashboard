// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/outcomeCalibration/audit.ts
//  Phase MI-9 — Structured audit emission for outcome / calibration operations.
//
//  Single JSON line per action to stdout. Suppressible via
//  CALIBRATION_AUDIT_QUIET=true.
// ──────────────────────────────────────────────────────────────────────────────

const AUDIT_PREFIX = "[outcome-calibration]";

export function emitCalibrationAudit(payload: {
  action: string;
  subjectKind?: string;
  subjectId?: string;
  outcomeId?: string | null;
  resolutionId?: string | null;
  forecastSnapshotId?: string | null;
  decision?: string;
  reasonLog?: string[];
  actorUserId?: string | null;
  actorEmail?: string | null;
  factors?: Record<string, number | string | boolean | null>;
}): void {
  if (process.env.CALIBRATION_AUDIT_QUIET === "true") return;
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
