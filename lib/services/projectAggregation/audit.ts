// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/audit.ts
//  Phase MI-6 — Structured audit emission.
//
//  Single JSON line per aggregator action to stdout. Suppressible via
//  PROJECT_AUDIT_QUIET=true.
// ──────────────────────────────────────────────────────────────────────────────

const AUDIT_PREFIX = "[project-aggregator]";

export function emitAggregatorAudit(payload: {
  action: string;
  projectId: string | null;
  decision?: string;
  score?: number;
  reasonLog?: string[];
  actorUserId?: string | null;
  actorEmail?: string | null;
  // Factors are heterogeneous (numbers + lifecycle string + version tag).
  factors?: Record<string, number | string>;
}): void {
  if (process.env.PROJECT_AUDIT_QUIET === "true") return;
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(entry)}`);
}
