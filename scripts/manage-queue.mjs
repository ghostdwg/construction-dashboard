#!/usr/bin/env node
// CLI to inspect + edit + cancel queued market_scrape jobs in Turso.
// Bridge tool until the in-app surface for queue management ships.
//
// Usage:
//   node scripts/manage-queue.mjs list                       # show queued jobs
//   node scripts/manage-queue.mjs cancel <jobId>             # cancel one job
//   node scripts/manage-queue.mjs cancel-all                 # cancel ALL queued market_scrape jobs
//   node scripts/manage-queue.mjs edit <jobId> --maxDocs 25  # edit maxDocs (or other override params)
//
// Edit params supported: --maxDocs, --dateFrom, --dateTo, --runAfter,
//                        --includeUndated, --prefilterMode, --prefilterModel

import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const cmd = process.argv[2];
const c = createClient({ url });

async function listQueued() {
  const rows = await c.execute(
    `SELECT j.id, j.status, j.relatedId, j.inputSummary,
            datetime(j.createdAt) AS created,
            datetime(j.runAfter) AS runAfter,
            s.name AS sourceName
     FROM BackgroundJob j
     LEFT JOIN MarketSource s ON s.id = j.relatedId
     WHERE j.jobType = 'market_scrape'
       AND j.status IN ('queued','running')
     ORDER BY j.runAfter ASC NULLS LAST, j.createdAt DESC`
  );
  if (rows.rows.length === 0) {
    console.log("No queued/running market_scrape jobs.");
    return;
  }
  for (const r of rows.rows) {
    const params = r.inputSummary ? JSON.parse(r.inputSummary) : {};
    console.log(`\n[${r.status}] ${r.id}`);
    console.log(`  source:   ${r.sourceName || "(missing)"} (${r.relatedId})`);
    console.log(`  runAfter: ${r.runAfter}`);
    console.log(`  created:  ${r.created}`);
    console.log(`  params:   maxDocs=${params.maxDocs ?? "(default 200)"} dateFrom=${params.dateFrom ?? "-"} dateTo=${params.dateTo ?? "-"} prefilter=${params.prefilterMode ?? "(default)"}`);
  }
}

async function cancelOne(id) {
  const r = await c.execute({
    sql: `UPDATE BackgroundJob
          SET status = 'cancelled', completedAt = CURRENT_TIMESTAMP, errorMessage = 'Cancelled via manage-queue.mjs'
          WHERE id = ? AND status IN ('queued','running')`,
    args: [id],
  });
  console.log(`Updated ${r.rowsAffected} row(s).`);
}

async function cancelAll() {
  const r = await c.execute(
    `UPDATE BackgroundJob
     SET status = 'cancelled', completedAt = CURRENT_TIMESTAMP, errorMessage = 'Canceled via manage-queue.mjs (bulk)'
     WHERE jobType = 'market_scrape' AND status IN ('queued','running')`
  );
  console.log(`Canceled ${r.rowsAffected} job(s).`);
}

function parseEditArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (!k.startsWith("--")) continue;
    const v = args[i + 1];
    out[k.slice(2)] = v;
    i++;
  }
  return out;
}

async function editOne(id, edits) {
  const cur = await c.execute({
    sql: `SELECT inputSummary, status FROM BackgroundJob WHERE id = ?`,
    args: [id],
  });
  if (cur.rows.length === 0) { console.error("Job not found."); process.exit(1); }
  if (cur.rows[0].status !== "queued") {
    console.error(`Refusing to edit a ${cur.rows[0].status} job — only 'queued' may be edited.`);
    process.exit(1);
  }
  const params = cur.rows[0].inputSummary ? JSON.parse(cur.rows[0].inputSummary) : {};

  let runAfterChange = null;
  for (const [k, raw] of Object.entries(edits)) {
    if (k === "runAfter") { runAfterChange = new Date(raw).toISOString(); continue; }
    if (k === "maxDocs") { params.maxDocs = Number(raw); continue; }
    if (k === "includeUndated") { params.includeUndated = raw === "true"; continue; }
    params[k] = raw;
  }

  const sets = ["inputSummary = ?"];
  const args = [JSON.stringify(params)];
  if (runAfterChange) { sets.push("runAfter = ?"); args.push(runAfterChange); }
  args.push(id);

  const r = await c.execute({
    sql: `UPDATE BackgroundJob SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
  console.log(`Updated ${r.rowsAffected} row(s).`);
  console.log("New params:", params);
  if (runAfterChange) console.log("New runAfter:", runAfterChange);
}

try {
  if (cmd === "list") {
    await listQueued();
  } else if (cmd === "cancel" && process.argv[3]) {
    await cancelOne(process.argv[3]);
  } else if (cmd === "cancel-all") {
    await cancelAll();
  } else if (cmd === "edit" && process.argv[3]) {
    await editOne(process.argv[3], parseEditArgs(process.argv.slice(4)));
  } else {
    console.log("Usage:");
    console.log("  node scripts/manage-queue.mjs list");
    console.log("  node scripts/manage-queue.mjs cancel <jobId>");
    console.log("  node scripts/manage-queue.mjs cancel-all");
    console.log("  node scripts/manage-queue.mjs edit <jobId> --maxDocs 25");
    process.exit(1);
  }
} finally {
  await c.close();
}
