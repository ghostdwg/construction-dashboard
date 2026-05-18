#!/usr/bin/env node
// Apply pending Prisma migrations to a Turso (libSQL) database.
//
// This is the ONLY governed path for applying schema changes to Turso. The
// Prisma migrate CLI does not speak libsql:// (P1013) and is fenced away
// from libsql:// by prisma.config.ts (Phase R6.5). This runner reads
// prisma/migrations/, applies pending migrations via @libsql/client, and
// records rows in _prisma_migrations with sha256 checksums in Prisma's
// exact column format — so `prisma migrate status` against a SQLite target
// remains consistent.
//
// Lineage: original implementation authored 2026-05-16 on feat/market-intelligence
// at commit 2030909 ("fix(deploy): drop auto-migrate at boot, add libsql-aware
// migrator script"). Lifted into the active R-series tree at Phase R6.6 with
// the following additions:
//   - APP_ENV tier fence (refuse wrong-tier DATABASE_URL before connecting)
//   - fresh-DB bootstrap of _prisma_migrations (original crashed on empty DB)
//   - partial-state surfacing (rows recorded as started-but-not-finished)
//
// Usage:
//   APP_ENV=staging    DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
//     node scripts/apply-turso-migrations.mjs
//   APP_ENV=production DATABASE_URL=libsql://groundworx-prod-...?authToken=... \
//     node scripts/apply-turso-migrations.mjs
//   APP_ENV=staging    DATABASE_URL=... \
//     node scripts/apply-turso-migrations.mjs --dry-run
//
// Tier fence (Phase R6.6):
//   APP_ENV must be set and one of: development-parity | staging | production
//   APP_ENV=staging            → DATABASE_URL must contain "groundworx-staging"
//   APP_ENV=production         → DATABASE_URL must contain "groundworx-prod"
//   APP_ENV=development-parity → DATABASE_URL must contain "groundworx-dev-"
//   Mismatches refuse to proceed BEFORE opening a connection.
//
// Local SQLite dev (APP_ENV=development) does NOT use this runner — use
// `prisma migrate dev` against file:./dev.db instead. See runtime/runbooks/
// turso-migrations.md for the full procedure.
//
// Exit codes:
//   0 — applied (or nothing to do, or --dry-run)
//   1 — bad inputs (no APP_ENV, invalid APP_ENV, no DATABASE_URL, tier mismatch, no migrations dir)
//   2 — a migration failed mid-run (DB may be in partial state, inspect logs)

import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "prisma", "migrations");
const DRY_RUN = process.argv.includes("--dry-run");

const TIER_RULES = {
  "development-parity": {
    urlMustContain: "groundworx-dev-",
    label: "dev-parity Turso DB (groundworx-dev-<initials>)",
  },
  staging: {
    urlMustContain: "groundworx-staging",
    label: "staging Turso DB (groundworx-staging-*)",
  },
  production: {
    urlMustContain: "groundworx-prod",
    label: "production Turso DB (groundworx-prod-*)",
  },
};

function fail(msg, code = 1) {
  console.error(`[apply-turso-migrations] FATAL: ${msg}`);
  process.exit(code);
}

// --- Tier fence (Phase R6.6) ----------------------------------------------
const appEnv = process.env.APP_ENV;
if (!appEnv) {
  fail(
    "APP_ENV is required. Set to one of: development-parity, staging, production.\n" +
      "  The Turso migration runner refuses to run without an explicit tier declaration.\n" +
      "  For local SQLite dev, use `prisma migrate dev` against file:./dev.db instead."
  );
}

const rule = TIER_RULES[appEnv];
if (!rule) {
  fail(
    `APP_ENV=${appEnv} is not a valid tier for the Turso runner.\n` +
      "  Allowed: development-parity | staging | production.\n" +
      "  (APP_ENV=development uses local SQLite and `prisma migrate dev`, not this runner.)"
  );
}

const url = process.env.DATABASE_URL;
if (!url) {
  fail("DATABASE_URL not set. Source the appropriate tier env file before invoking.");
}

if (!url.includes(rule.urlMustContain)) {
  fail(
    `Tier mismatch: APP_ENV=${appEnv} requires DATABASE_URL to identify the ${rule.label}\n` +
      `  (URL must contain "${rule.urlMustContain}").\n` +
      `  Refusing to proceed — wrong-tier mutation would corrupt the wrong database.`
  );
}
// --------------------------------------------------------------------------

function listMigrations() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    fail(`Cannot read migrations dir ${MIGRATIONS_DIR}: ${err.message}`);
  }
  return entries
    .filter((e) => /^\d{14}_/.test(e))
    .filter((e) => {
      try {
        return statSync(join(MIGRATIONS_DIR, e)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function splitStatements(sql) {
  // SQLite statements separated by `;` at end of line/file. Strips comments
  // and empty entries. Good enough for Prisma-generated migration.sql which
  // never embeds `;` inside strings or DDL.
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

const c = createClient({ url });

console.log(`[apply-turso-migrations] APP_ENV=${appEnv} — connecting...`);

// Ensure _prisma_migrations exists. Schema matches Prisma's CLI exactly so
// `prisma migrate status` against a SQLite-shaped target stays consistent.
// (R6.6 addition: the original 2030909 script assumed this table already
// existed; that assumption fails on a freshly-provisioned staging DB.)
await c.execute(`
  CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id                      TEXT PRIMARY KEY NOT NULL,
    checksum                TEXT NOT NULL,
    finished_at             DATETIME,
    migration_name          TEXT NOT NULL,
    logs                    TEXT,
    rolled_back_at          DATETIME,
    started_at              DATETIME NOT NULL DEFAULT current_timestamp,
    applied_steps_count     INTEGER UNSIGNED NOT NULL DEFAULT 0
  )
`);

const appliedRows = await c.execute(
  "SELECT migration_name, finished_at FROM _prisma_migrations"
);
const applied = new Map();
for (const r of appliedRows.rows) {
  applied.set(r.migration_name, r.finished_at ? "OK" : "PENDING");
}

const all = listMigrations();
const pending = all.filter((name) => !applied.has(name));
const partial = [...applied.entries()]
  .filter(([, v]) => v === "PENDING")
  .map(([k]) => k);

console.log(
  `Found ${all.length} migrations on disk. ${applied.size} recorded in Turso. ${pending.length} pending.`
);

if (partial.length > 0) {
  console.log(
    "\nWARNING: migrations recorded as started but not finished — review before proceeding:"
  );
  for (const p of partial) console.log("  !", p);
}

if (pending.length === 0) {
  console.log("Nothing to do.");
  await c.close();
  process.exit(0);
}

console.log("\nPending:");
for (const p of pending) console.log("  -", p);

if (DRY_RUN) {
  console.log("\n--dry-run — exiting without applying.");
  await c.close();
  process.exit(0);
}

for (const name of pending) {
  const sqlPath = join(MIGRATIONS_DIR, name, "migration.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const stmts = splitStatements(sql);

  console.log(`\nApplying ${name} (${stmts.length} statements)...`);
  const startedAt = new Date().toISOString();
  try {
    await c.batch(stmts, "write");
  } catch (err) {
    console.error(`  FAILED on ${name}: ${err.message}`);
    console.error("  Inspect Turso state before re-running.");
    process.exit(2);
  }
  const finishedAt = new Date().toISOString();
  await c.execute({
    sql: `INSERT INTO _prisma_migrations
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
          VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
    args: [randomUUID(), checksum, finishedAt, name, startedAt, stmts.length],
  });
  console.log(`  OK (checksum ${checksum.substring(0, 12)}...)`);
}

console.log(`\nDone. Applied ${pending.length} migration(s).`);
await c.close();
