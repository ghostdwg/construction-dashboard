#!/usr/bin/env -S node --import=tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/backfill-entity-graph.ts
//  Phase MI-3 — Historical Entity Backfill CLI.
//
//  Invocation (via npm script):
//    npm run backfill:entity-graph -- --tier=staging
//
//  Modes:
//    --dry-run           Build plan and exit. No DB writes.
//    --report-only       Generate the report from current DB state. No writes.
//    (default)           Execute full backfill.
//    --replay            Execute, ignoring prior resolverVersion attribution.
//
//  Options:
//    --tier=TIER         REQUIRED. development-parity | staging | production
//    --batch-size=N      Rows per batch (default 50)
//    --max-rows=N        Cap for testing (default unlimited)
//    --no-seed           Skip Phase A watchlist seed materialization
//    --checkpoint=PATH   Override checkpoint file path
//    --report-out=PATH   Override JSON report path
//    --verbose           Per-row resolution logs
//
//  Exit codes:
//    0   complete (or dry-run successful)
//    1   bad inputs / tier fence violation
//    2   mid-run failure (checkpoint written for resume)
//
//  Tier fence (Phase R6.6 alignment):
//    APP_ENV must be set and match the --tier flag. This prevents an
//    operator from accidentally running the production backfill against
//    a staging DB or vice versa.
// ──────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runBackfill,
  buildPlan,
  buildReport,
  formatReport,
  type BackfillMode,
  type BackfillOptions,
  type BackfillTier,
} from "@/lib/services/entityBackfill";

function fail(msg: string, code = 1): never {
  console.error(`[backfill] FATAL: ${msg}`);
  process.exit(code);
}

function parseArgv(): BackfillOptions {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length) : undefined;
  };
  const flag = (name: string): boolean => args.includes(`--${name}`);

  const tier = get("tier") as BackfillTier | undefined;
  if (!tier) fail("--tier=TIER is required (development-parity | staging | production)");
  if (!["development-parity", "staging", "production"].includes(tier)) {
    fail(`--tier must be one of: development-parity, staging, production. Got: ${tier}`);
  }

  // Tier fence: APP_ENV must match
  const appEnv = process.env.APP_ENV;
  if (!appEnv) fail("APP_ENV is required. Source the appropriate tier env file before invoking.");
  if (
    (tier === "production" && appEnv !== "production") ||
    (tier === "staging" && appEnv !== "staging") ||
    (tier === "development-parity" && appEnv !== "local" && appEnv !== "development-parity")
  ) {
    fail(`Tier fence: --tier=${tier} but APP_ENV=${appEnv}. Refusing to proceed — wrong-tier mutation would corrupt the wrong DB.`);
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

  return {
    mode,
    tier,
    batchSize,
    maxRows,
    tables: ["RelationshipEdge"], // MI-3 scope; MarketSignal phase is deferred
    checkpointPath: resolve(get("checkpoint") ?? "./entity-backfill-checkpoint.json"),
    reportPath: resolve(get("report-out") ?? "./entity-backfill-report.json"),
    noSeed: flag("no-seed"),
    verbose: flag("verbose"),
  };
}

async function main() {
  const opts = parseArgv();
  console.log(`[backfill] tier=${opts.tier} mode=${opts.mode} APP_ENV=${process.env.APP_ENV}`);
  console.log(`[backfill] checkpoint=${opts.checkpointPath}`);
  console.log(`[backfill] report=${opts.reportPath}`);

  if (opts.mode === "dry-run") {
    const { RESOLVER_VERSION } = await import("@/lib/services/entityResolver");
    const plan = await buildPlan(opts, RESOLVER_VERSION);
    console.log("\n=== Dry Run Plan ===");
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  let state;
  try {
    state = await runBackfill(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] Run failed: ${msg}`);
    console.error(`[backfill] Checkpoint preserved at ${opts.checkpointPath}.`);
    process.exit(2);
  }

  const report = await buildReport(state);
  writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("");
  console.log(formatReport(report));
  console.log(`\n[backfill] Full JSON report: ${opts.reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
