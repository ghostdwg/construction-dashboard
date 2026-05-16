#!/usr/bin/env node
// Apply pending Prisma migrations to a Turso (libSQL) database.
//
// Prisma's own `prisma migrate deploy` doesn't speak libsql:// (P1013). This
// script reads the same _prisma_migrations table Prisma uses, finds migrations
// in prisma/migrations/ that haven't been applied, runs each as an atomic
// libsql batch, and records the row with a SHA-256 checksum — same format
// Prisma stores, so future `prisma migrate status` against a SQLite-compatible
// target stays in sync.
//
// Usage:
//   DATABASE_URL=libsql://...turso.io?authToken=... node scripts/apply-turso-migrations.mjs
//   DATABASE_URL=... node scripts/apply-turso-migrations.mjs --dry-run
//
// Exit codes:
//   0 — applied (or nothing to do)
//   1 — bad inputs (no DATABASE_URL, no migrations dir)
//   2 — a migration failed mid-run (DB may be in partial state, inspect logs)

import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "prisma", "migrations");
const DRY_RUN = process.argv.includes("--dry-run");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

function listMigrations() {
  const entries = readdirSync(MIGRATIONS_DIR);
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

const appliedRows = await c.execute(
  "SELECT migration_name, finished_at FROM _prisma_migrations"
);
const applied = new Map();
for (const r of appliedRows.rows) {
  applied.set(r.migration_name, r.finished_at ? "OK" : "PENDING");
}

const all = listMigrations();
const pending = all.filter((name) => !applied.has(name));

console.log(`Found ${all.length} migrations on disk. ${applied.size} recorded in Turso. ${pending.length} pending.`);
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
