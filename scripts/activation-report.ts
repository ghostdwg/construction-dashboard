#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/activation-report.ts
//  Phase O2.2 PR6 — Single-command first-live activation audit.
//
//  Usage:
//    tsx scripts/activation-report.ts                # human-readable
//    tsx scripts/activation-report.ts --json         # machine-readable
//
//  Use during + after staging activation to verify:
//    * sources are seeded + healthy
//    * runner is firing
//    * ingestion is producing rows
//    * suppression is hygienically tuned (not over-dropping)
//    * project aggregation is starting to form
// ──────────────────────────────────────────────────────────────────────────────

import { buildActivationReport, type ActivationReport } from "@/lib/services/marketIntelligence/activationReport";

const args = process.argv.slice(2);
const isJson = args.includes("--json");

function fmtAge(d: Date | null): string {
  if (!d) return "—";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderHuman(r: ActivationReport): string {
  const lines: string[] = [];
  const rule = "─".repeat(72);
  lines.push(rule);
  lines.push(`  NEUROGLITCH ACTIVATION REPORT  ·  generated ${r.generatedAt.toISOString()}`);
  lines.push(rule);
  lines.push("");

  // ── Source health ────────────────────────────────────────────────────────
  lines.push("SOURCE STATUS");
  if (r.sourceStatus.length === 0) {
    lines.push("  (no sources seeded — run `npm run seed:market-sources`)");
  } else {
    for (const s of r.sourceStatus) {
      lines.push(`  ${s.publishStatus.padEnd(16)} active=${String(s.isActive).padEnd(5)} count=${s.count}`);
    }
  }
  lines.push("");

  // ── Cadence confidence ───────────────────────────────────────────────────
  lines.push("CADENCE-CONFIDENCE DISTRIBUTION");
  const c = r.cadenceConfidenceDistribution;
  lines.push(`  HIGH=${c.high}   MEDIUM=${c.medium}   LOW=${c.low}   (none-yet)=${c.none}`);
  lines.push("");

  // ── Runners ──────────────────────────────────────────────────────────────
  lines.push("RUNNER CYCLES (last 24h)");
  for (const r2 of r.runnerCycles) {
    lines.push(`  ${r2.cycleName}`);
    lines.push(`    total24h=${r2.totalLast24h}  ok=${r2.succeeded24h}  fail=${r2.failed24h}  stale=${r2.staleLeases}`);
    lines.push(`    last=${fmtAge(r2.lastCycleAt)} (status=${r2.lastCycleStatus ?? "—"}, dur=${r2.lastCycleDurationMs ?? "—"}ms)`);
    if (r2.lastCycleError) lines.push(`    last-error: ${r2.lastCycleError.slice(0, 100)}`);
  }
  lines.push("");

  // ── Ingestion throughput ─────────────────────────────────────────────────
  lines.push("INGESTION THROUGHPUT");
  const t = r.ingestionThroughput;
  lines.push(`  signals: 1h=${t.signalsLast1h}  24h=${t.signalsLast24h}  7d=${t.signalsLast7d}`);
  lines.push(`  classification (24h): HIGH=${t.highEmergence24h}  MED=${t.mediumEmergence24h}  LOW=${t.lowEmergence24h}`);
  lines.push(`  suppression ratio (24h, db-side): ${r.suppressionRatio24h == null ? "—" : (r.suppressionRatio24h * 100).toFixed(1) + "%"}`);
  lines.push("");

  // ── Top jurisdictions ────────────────────────────────────────────────────
  lines.push("TOP JURISDICTIONS (last 7d)");
  if (r.topJurisdictions7d.length === 0) {
    lines.push("  (no signals yet — runner hasn't found anything)");
  } else {
    for (const j of r.topJurisdictions7d) {
      lines.push(`  ${j.jurisdiction.padEnd(36)} 24h=${String(j.signalsLast24h).padStart(4)}  7d=${j.signalsLast7d}`);
    }
  }
  lines.push("");

  // ── Project formation ────────────────────────────────────────────────────
  lines.push("PROJECT FORMATION");
  const p = r.projectFormation;
  lines.push(`  projects: 24h=${p.projectsCreatedLast24h}  7d=${p.projectsCreatedLast7d}`);
  lines.push(`  ingestion-attributed (7d): ${p.ingestionAttributedProjects7d}`);
  lines.push(`  probability snapshots (24h): ${p.probabilitySnapshots24h}`);
  lines.push("");

  // ── Top emergent signals ─────────────────────────────────────────────────
  lines.push("TOP EMERGENT SIGNALS (last 24h)");
  if (r.topEmergentSignals24h.length === 0) {
    lines.push("  (none yet)");
  } else {
    for (const s of r.topEmergentSignals24h) {
      const score = s.heuristicsScore != null ? s.heuristicsScore.toFixed(2) : "—";
      lines.push(`  [${(s.heuristicsClassification ?? "?").padEnd(16)}] score=${score}  ${(s.signalSubtype ?? "?").padEnd(20)}  ${s.headline.slice(0, 60)}`);
    }
  }
  lines.push("");

  // ── Stale sources ────────────────────────────────────────────────────────
  if (r.staleSources.length > 0) {
    lines.push("STALE / OPERATOR_REVIEW SOURCES");
    for (const s of r.staleSources) {
      lines.push(`  ${s.jurisdiction.padEnd(20)} ${s.name.slice(0, 40).padEnd(40)} empty-runs=${s.consecutiveEmptyRuns}  last-empty=${fmtAge(s.lastEmptyRunAt)}`);
    }
    lines.push("");
  }

  // ── Forecast activity (PR7) ──────────────────────────────────────────────
  const f = r.forecastActivity;
  lines.push("FORECAST ACTIVITY (PR7)");
  lines.push(`  last forecast-daily cycle: ${fmtAge(f.lastForecastCycleAt)} (status=${f.lastForecastCycleStatus ?? "—"})`);
  lines.push(`  snapshots: 24h=${f.forecastSnapshotsLast24h}  7d=${f.forecastSnapshotsLast7d}`);
  lines.push(`  trajectory shifts (24h): ${f.trajectoryShifts24h}`);
  lines.push(`  HIGH-emergence: projects=${f.highEmergenceProjects}  parcels=${f.highEmergenceParcels}`);
  lines.push(`  new HIGH (24h): ${f.newHighEmergence24h}`);
  lines.push(`  operator overrides (lifetime): ${f.overriddenForecasts}`);
  if (f.biggestTrajectoryShifts24h.length > 0) {
    lines.push("  biggest 24h trajectory shifts:");
    for (const s of f.biggestTrajectoryShifts24h.slice(0, 5)) {
      const arrow = s.fromState ? `${s.fromState}→${s.toState}` : `(new) ${s.toState}`;
      lines.push(`    ${s.subjectKind.padEnd(8)} ${s.subjectId.slice(0, 16).padEnd(16)} ${arrow.padEnd(28)} Δ=${s.delta.toFixed(3)}`);
    }
  }
  if (f.topEmergenceProjects.length > 0) {
    lines.push("  top HIGH-emergence projects:");
    for (const p of f.topEmergenceProjects.slice(0, 5)) {
      lines.push(`    ${p.score.toFixed(3)} ${p.confidence.padEnd(7)} ${(p.workingTitle ?? p.projectId).slice(0, 60)}`);
    }
  }
  lines.push("");

  // ── Alert activity (PR8) ─────────────────────────────────────────────────
  const a = r.alertActivity;
  lines.push("ALERT ACTIVITY (PR8)");
  lines.push(`  last alert-eval cycle: ${fmtAge(a.lastAlertEvalCycleAt)} (status=${a.lastAlertEvalCycleStatus ?? "—"})`);
  lines.push(`  alerts: 24h=${a.alertsLast24h}  7d=${a.alertsLast7d}`);
  lines.push(`  unread total: ${a.unreadCount}`);
  if (Object.keys(a.unreadBySeverity).length > 0) {
    const parts = Object.entries(a.unreadBySeverity).map(([k, v]) => `${k}=${v}`).join("  ");
    lines.push(`    unread by severity: ${parts}`);
  }
  if (a.dismissedRatio7d != null) {
    lines.push(`  dismissed ratio (7d): ${(a.dismissedRatio7d * 100).toFixed(1)}%`);
  }
  if (Object.keys(a.byTriggerKind24h).length > 0) {
    lines.push("  alerts by trigger kind (24h):");
    for (const [kind, count] of Object.entries(a.byTriggerKind24h)) {
      lines.push(`    ${kind.padEnd(36)} ${count}`);
    }
  }
  if (a.topJurisdictions24h.length > 0) {
    lines.push("  top alerting jurisdictions (24h):");
    for (const j of a.topJurisdictions24h.slice(0, 5)) {
      lines.push(`    ${j.jurisdiction.padEnd(28)} ${j.count}`);
    }
  }
  if (a.recentAlerts.length > 0) {
    lines.push("  most recent alerts:");
    for (const al of a.recentAlerts.slice(0, 8)) {
      const tag = (al.runnerTriggerKind ?? "?").slice(0, 32);
      lines.push(`    [${al.severity.padEnd(9)}] ${tag.padEnd(32)} ${al.headline.slice(0, 60)}`);
    }
  }
  lines.push("");

  lines.push(rule);
  return lines.join("\n");
}

async function main(): Promise<number> {
  const report = await buildActivationReport();
  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHuman(report));
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[activation-report] FATAL", err);
    process.exit(1);
  });
