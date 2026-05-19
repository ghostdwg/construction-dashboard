// ──────────────────────────────────────────────────────────────────────────────
//  scripts/backfill-project-graph.ts
//  Phase MI-6 PR2 — Historical Project Aggregate Formation CLI.
//
//  Modes:
//    --dry-run            Plan + exit. No DB writes.
//    --report-only        Report from current DB state. No writes.
//    (default)            Execute full backfill.
//    --replay             Execute, ignoring prior signal-attachments.
//
//  Options:
//    --tier=TIER          REQUIRED. development-parity | staging | production
//    --batch-size=N       default 50
//    --max-rows=N         default unlimited
//    --sources=...        CSV subset of [RelationshipEdge,MarketLead,MarketSignal]
//                         default all three
//    --attach-threshold=N override ATTACH_AUTO (default 0.80)
//    --review-threshold=N override REVIEW (default 0.55)
//    --checkpoint=PATH    default ./project-backfill-checkpoint.json
//    --report-out=PATH    default ./project-backfill-report.json
//    --skip-report        skip the post-run report generation
//    --verbose            per-row decision logs
//
//  Exit codes:
//    0   complete (or dry-run successful)
//    1   bad inputs / tier fence violation
//    2   mid-run failure (checkpoint preserved for resume)
//
//  Tier fence: --tier must match process.env.APP_ENV.
// ──────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runProjectBackfill,
  buildPlan,
  buildReport,
  formatReport,
  type BackfillMode,
  type BackfillSource,
  type BackfillTier,
  type ProjectBackfillOptions,
} from "@/lib/services/projectBackfill";
import { AGGREGATOR_VERSION } from "@/lib/services/projectAggregation";

function fail(msg: string, code = 1): never {
  console.error(`[project-backfill] FATAL: ${msg}`);
  process.exit(code);
}

function parseArgv(): ProjectBackfillOptions {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const prefix = `--${name}=`;
    const m = args.find((a) => a.startsWith(prefix));
    return m ? m.slice(prefix.length) : undefined;
  };
  const flag = (name: string) => args.includes(`--${name}`);

  const tier = get("tier") as BackfillTier | undefined;
  if (!tier) fail("--tier=TIER is required (development-parity | staging | production)");
  if (!["development-parity", "staging", "production"].includes(tier)) {
    fail(`--tier must be one of: development-parity, staging, production. Got: ${tier}`);
  }
  const appEnv = process.env.APP_ENV;
  if (!appEnv) fail("APP_ENV is required (source the tier env file).");
  if (
    (tier === "production" && appEnv !== "production") ||
    (tier === "staging" && appEnv !== "staging") ||
    (tier === "development-parity" && appEnv !== "local" && appEnv !== "development-parity")
  ) {
    fail(`Tier fence: --tier=${tier} but APP_ENV=${appEnv}. Refusing.`);
  }

  let mode: BackfillMode = "execute";
  if (flag("dry-run")) mode = "dry-run";
  else if (flag("report-only")) mode = "report-only";
  else if (flag("replay")) mode = "replay";

  const batchSize = Number(get("batch-size") ?? "50");
  if (!Number.isFinite(batchSize) || batchSize < 1) fail("--batch-size must be a positive integer");

  const maxRowsStr = get("max-rows");
  const maxRows = maxRowsStr ? Number(maxRowsStr) : null;
  if (maxRows !== null && (!Number.isFinite(maxRows) || maxRows < 1)) {
    fail("--max-rows must be a positive integer if provided");
  }

  const sourcesStr = get("sources");
  const allSources: BackfillSource[] = ["RelationshipEdge", "MarketLead", "MarketSignal"];
  let sources: BackfillSource[] = allSources;
  if (sourcesStr) {
    sources = sourcesStr
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is BackfillSource => allSources.includes(s as BackfillSource));
    if (sources.length === 0) fail("--sources had no valid entries");
  }

  const attachThr = get("attach-threshold");
  const reviewThr = get("review-threshold");

  return {
    mode,
    tier,
    batchSize,
    maxRows,
    sources,
    checkpointPath: resolve(get("checkpoint") ?? "./project-backfill-checkpoint.json"),
    reportPath: resolve(get("report-out") ?? "./project-backfill-report.json"),
    attachAutoThreshold: attachThr ? Number(attachThr) : undefined,
    reviewThreshold: reviewThr ? Number(reviewThr) : undefined,
    skipReport: flag("skip-report"),
    verbose: flag("verbose"),
  };
}

async function main() {
  const opts = parseArgv();
  console.log(`[project-backfill] tier=${opts.tier} mode=${opts.mode} APP_ENV=${process.env.APP_ENV}`);
  console.log(`[project-backfill] sources=${opts.sources.join(",")} aggregator=${AGGREGATOR_VERSION}`);
  console.log(`[project-backfill] checkpoint=${opts.checkpointPath}`);
  console.log(`[project-backfill] report=${opts.reportPath}`);

  if (opts.mode === "dry-run") {
    const plan = await buildPlan(opts, AGGREGATOR_VERSION);
    console.log("\n=== Project Backfill Plan ===");
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  let state;
  try {
    state = await runProjectBackfill(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[project-backfill] Run failed: ${msg}`);
    console.error(`[project-backfill] Checkpoint preserved at ${opts.checkpointPath}.`);
    process.exit(2);
  }

  if (opts.skipReport) {
    console.log("[project-backfill] --skip-report set; finished without report.");
    return;
  }

  const report = await buildReport(state);
  writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("");
  console.log(formatReport(report));
  console.log(`\n[project-backfill] Full JSON report: ${opts.reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
