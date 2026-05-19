#!/usr/bin/env node
// Phase O1.1 — Replay validation gate.
//
// Proves the platform's core integrity claim: the migration set replays
// cleanly from zero into a state that exactly matches prisma/schema.prisma.
//
// What this script does:
//   1. Provision a fresh ephemeral SQLite DB at $REPLAY_DB_PATH (default
//      /tmp/replay-validation.db) — deletes any prior file.
//   2. Run `prisma migrate deploy` against it. Expected: success on every
//      migration in prisma/migrations/.
//   3. Run `prisma migrate diff --from-migrations ... --to-schema ...`.
//      Expected: "No difference detected." Any reported drift is a fail.
//   4. Generate the Prisma client.
//   5. Open the resulting DB and assert key MI tables exist (Entity,
//      Project, Parcel, ForecastSnapshot, Outcome, AlertEvent, Watchlist).
//   6. Print a checksum of the migrations directory + a "REPLAY OK" line.
//
// Exit codes:
//   0 — replay validated (migrations apply cleanly, zero drift, key tables present)
//   1 — bad inputs / unexpected error
//   2 — replay applied but drift detected (the core integrity violation)
//   3 — replay failed mid-stream (migration broke partway)
//   4 — replay completed but a required table is missing
//
// Intended use:
//   - Local: `node scripts/replay-validation.mjs` before any PR
//   - CI: `node scripts/replay-validation.mjs` as a required check
//
// Never operates against staging or production — this is a local fresh-DB gate.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");
const SCHEMA_PATH = join(ROOT, "prisma", "schema.prisma");
const DB_PATH = process.env.REPLAY_DB_PATH ?? "/tmp/replay-validation.db";
const DATABASE_URL = `file:${DB_PATH}`;

// ── Required tables (one per ontology layer) ─────────────────────────────────
//
// If any of these are missing from the replayed DB, the cognition layer
// is broken even if migrations didn't error.
const REQUIRED_TABLES = [
  "Entity",               // MI-1
  "EntityAlias",          // MI-1
  "Project",              // MI-6
  "ProjectSignal",        // MI-6
  "ProjectProbabilitySnapshot", // MI-6
  "Parcel",               // MI-7
  "ParcelPressureSnapshot", // MI-7
  "ForecastSnapshot",     // MI-8
  "ForecastExplanation",  // MI-8
  "Outcome",              // MI-9
  "OutcomeResolution",    // MI-9
  "CalibrationSnapshot",  // MI-9
  "Watchlist",            // MI-10
  "AlertEvent",           // MI-10
  "BriefingDocument",     // MI-10
];

function log(...args) {
  console.log("[replay-validation]", ...args);
}
function fail(msg, code) {
  console.error(`[replay-validation] FAIL: ${msg}`);
  process.exit(code);
}

// ── Clean previous state ─────────────────────────────────────────────────────
if (existsSync(DB_PATH)) {
  try { unlinkSync(DB_PATH); } catch (err) { fail(`could not remove ${DB_PATH}: ${err.message}`, 1); }
}
// Also nuke shared-mode wal/shm sidecars
for (const ext of ["-journal", "-wal", "-shm"]) {
  if (existsSync(DB_PATH + ext)) {
    try { unlinkSync(DB_PATH + ext); } catch {}
  }
}

// ── List migrations + checksum ───────────────────────────────────────────────
let migrations;
try {
  migrations = readdirSync(MIGRATIONS_DIR)
    .filter((e) => /^\d/.test(e))
    .filter((e) => statSync(join(MIGRATIONS_DIR, e)).isDirectory())
    .sort();
} catch (err) {
  fail(`cannot read ${MIGRATIONS_DIR}: ${err.message}`, 1);
}

const setHash = createHash("sha256");
for (const name of migrations) {
  const sqlPath = join(MIGRATIONS_DIR, name, "migration.sql");
  try {
    const buf = readFileSync(sqlPath);
    setHash.update(name);
    setHash.update("\0");
    setHash.update(buf);
    setHash.update("\0");
  } catch (err) {
    fail(`cannot read ${sqlPath}: ${err.message}`, 1);
  }
}
const migrationSetChecksum = setHash.digest("hex");

log(`migrations on disk: ${migrations.length}`);
log(`migration set checksum: ${migrationSetChecksum.substring(0, 16)}...`);

// ── Step 1: prisma migrate deploy ────────────────────────────────────────────
log(`step 1: prisma migrate deploy against ${DATABASE_URL}`);
const deploy = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "migrate", "deploy"],
  {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  }
);
if (deploy.status !== 0) {
  console.error(deploy.stdout);
  console.error(deploy.stderr);
  fail(`prisma migrate deploy exited with code ${deploy.status}`, 3);
}
// Count successfully applied (Prisma prints "✔ … migrated").
const appliedMatches = (deploy.stdout.match(/Applying migration|migration\.sql/g) ?? []);
log(`migrate deploy succeeded (${migrations.length} migrations applied)`);

// ── Step 2: drift check ──────────────────────────────────────────────────────
log("step 2: prisma migrate diff (migrations vs schema)");
const diff = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema", "prisma/schema.prisma"],
  {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  }
);
if (diff.status !== 0) {
  console.error(diff.stdout);
  console.error(diff.stderr);
  fail(`prisma migrate diff exited with code ${diff.status}`, 1);
}
const diffOut = diff.stdout.trim();
if (!diffOut.includes("No difference detected.")) {
  console.error("\n--- drift output ---");
  console.error(diffOut);
  console.error("--- end ---\n");
  fail("schema and migration set disagree — see drift output above", 2);
}
log("drift check passed: no difference detected");

// ── Step 3: prisma generate ──────────────────────────────────────────────────
log("step 3: prisma generate");
const gen = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "generate"],
  {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  }
);
if (gen.status !== 0) {
  console.error(gen.stdout);
  console.error(gen.stderr);
  fail(`prisma generate exited with code ${gen.status}`, 1);
}
log("prisma client generated");

// ── Step 4: assert required tables exist ─────────────────────────────────────
//
// Try sources in order: node:sqlite (built-in on Node 22+), @libsql/client
// (already in deps), then sqlite3 CLI fallback. At least one MUST work in
// CI.
log("step 4: assert required ontology tables present");

let present = null;
try {
  const sqliteMod = await import("node:sqlite");
  const db = new sqliteMod.DatabaseSync(DB_PATH, { open: true });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  db.close();
  present = new Set(rows.map((r) => r.name));
  log("  (using node:sqlite)");
} catch {
  // node:sqlite unavailable, try @libsql/client
  try {
    const { createClient } = await import("@libsql/client");
    const c = createClient({ url: DATABASE_URL });
    const result = await c.execute("SELECT name FROM sqlite_master WHERE type='table'");
    await c.close();
    present = new Set(result.rows.map((r) => r.name));
    log("  (using @libsql/client)");
  } catch (err) {
    const sqliteCheck = spawnSync(
      process.platform === "win32" ? "sqlite3.exe" : "sqlite3",
      [DB_PATH, "SELECT name FROM sqlite_master WHERE type='table'"],
      { encoding: "utf8" }
    );
    if (sqliteCheck.status === 0) {
      present = new Set(sqliteCheck.stdout.split(/\s+/).filter(Boolean));
      log("  (using sqlite3 cli)");
    } else {
      fail(`no sqlite reader available: node:sqlite, @libsql/client, and sqlite3 cli all failed. last err: ${err.message}`, 1);
    }
  }
}

const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
if (missing.length > 0) fail(`required tables missing: ${missing.join(", ")}`, 4);
log(`  all ${REQUIRED_TABLES.length} required ontology tables present`);

// ── Done ─────────────────────────────────────────────────────────────────────
log("");
log("═══════════════════════════════════════════════════════════");
log(`  REPLAY OK — migrations=${migrations.length}, drift=none, tables=${REQUIRED_TABLES.length}`);
log(`  checksum=${migrationSetChecksum.substring(0, 16)}...`);
log("═══════════════════════════════════════════════════════════");

// Optional cleanup
if (process.env.REPLAY_KEEP_DB !== "true") {
  try { unlinkSync(DB_PATH); } catch {}
  for (const ext of ["-journal", "-wal", "-shm"]) {
    try { unlinkSync(DB_PATH + ext); } catch {}
  }
}

process.exit(0);
