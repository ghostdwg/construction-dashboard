// Local-only migration applier for the R2 recovery certification harness.
//
// Applies prisma/migrations/*/migration.sql files, in lexicographic order,
// to a disposable local SQLite file via @libsql/client's `file:` backend.
// Mirrors the _prisma_migrations bookkeeping shape and the migration-name
// filter rule used by scripts/apply-turso-migrations.mjs so evidence stays
// comparable, but is a from-scratch implementation — see db.ts header for
// why the Turso runner itself is never imported here.
//
// This module never opens a network connection and never accepts a
// DATABASE_URL — it only ever writes to the disposable file path it is
// given.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openLocal, checkpointAndClose } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "..", "prisma", "migrations");

export function listMigrations(): string[] {
  const entries = readdirSync(MIGRATIONS_DIR);
  return entries
    .filter((e) => /^\d/.test(e))
    .filter((e) => {
      try {
        if (!statSync(join(MIGRATIONS_DIR, e)).isDirectory()) return false;
        return statSync(join(MIGRATIONS_DIR, e, "migration.sql")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

// NOTE: this is deliberately NOT the naive `sql.split(/;\s*$/m)` splitter
// used by scripts/apply-turso-migrations.mjs (which this module otherwise
// mirrors — see the file header). That splitter breaks on migration
// 20260718030000_r2b2_trade_response_reviewer_repairs: its
// CREATE TRIGGER ... BEGIN ... END; block contains an internal
// `SELECT RAISE(ABORT, ...);` statement, so a same-line `;` splitter cuts
// the trigger body in half and both halves fail as "incomplete input".
// This was discovered BY this certification harness (scenario 1/2 failed
// against the naive splitter before this fix) — the same defect is present
// in the real Turso runner, which is out of this task's permitted-file
// scope to edit (human-gated, GWX-Q02-class). Flagged in
// docs/r2/R2-RECOVERY-CERTIFICATION.md as a release-blocking finding for
// the operator to fix in apply-turso-migrations.mjs before Q02 runs
// migration 101 against staging.
function splitStatements(sql: string): string[] {
  const src = sql.replace(/^\s*--.*$/gm, "");
  const lines = src.split(/\n/);
  const statements: string[] = [];
  let buf = "";
  let inTriggerBody = false;
  for (const line of lines) {
    buf += (buf ? "\n" : "") + line;
    if (!inTriggerBody) {
      if (/^\s*CREATE\s+TRIGGER\b/i.test(buf.trimStart()) && /\bBEGIN\s*$/i.test(line.trim())) {
        inTriggerBody = true;
        continue;
      }
      if (/;\s*$/.test(line)) {
        const trimmed = buf.trim();
        if (trimmed) statements.push(trimmed);
        buf = "";
      }
      continue;
    }
    // Inside a trigger body: only an `END;` line (the trigger's own
    // terminator) closes the statement. Semicolons before it are part of
    // the trigger's own statement list and must not split it.
    if (/^\s*END\s*;\s*$/i.test(line)) {
      inTriggerBody = false;
      const trimmed = buf.trim();
      if (trimmed) statements.push(trimmed);
      buf = "";
    }
  }
  const rest = buf.trim();
  if (rest) statements.push(rest);
  return statements.filter(Boolean);
}

// SQLite (and libsql) treat `PRAGMA foreign_keys = ON|OFF` as a no-op when
// issued inside an already-open transaction — it only takes effect between
// transactions. A single `client.batch(stmts, "write")` call opens one
// implicit transaction around every statement in it, so a migration whose
// leading `PRAGMA foreign_keys=OFF;` / trailing `PRAGMA foreign_keys=ON;`
// are batched together with its DDL never actually disables enforcement.
// This was discovered BY this certification harness: seeding real
// ResponsePackage/TradeResponseRevision rows before applying migration
// 20260718030000_r2b2_trade_response_reviewer_repairs reproducibly fails
// with SQLITE_CONSTRAINT (FK) inside a single batch, but the identical
// statements succeed when the PRAGMA is executed outside the transaction.
// scripts/apply-turso-migrations.mjs has the same single-batch-per-migration
// shape and would carry the same latent risk once these tables hold real
// rows — flagged in docs/r2/R2-RECOVERY-CERTIFICATION.md, not fixed there
// (out of this task's permitted-file scope; that script is human-gated).
//
// Fix here: split each migration's statement list on PRAGMA
// foreign_keys/defer_foreign_keys boundaries, executing those PRAGMAs
// individually (outside any transaction) and batching only the
// contiguous non-PRAGMA runs between them.
const FK_PRAGMA_RE = /^\s*PRAGMA\s+(foreign_keys|defer_foreign_keys)\s*=/i;

async function applyStatementGroups(client: Awaited<ReturnType<typeof openLocal>>, stmts: string[]): Promise<void> {
  let i = 0;
  while (i < stmts.length) {
    if (FK_PRAGMA_RE.test(stmts[i])) {
      await client.execute(stmts[i]);
      i++;
      continue;
    }
    const group: string[] = [];
    while (i < stmts.length && !FK_PRAGMA_RE.test(stmts[i])) {
      group.push(stmts[i]);
      i++;
    }
    await client.batch(group, "write");
  }
}

async function ensureMigrationsTable(client: Awaited<ReturnType<typeof openLocal>>): Promise<void> {
  await client.execute(`
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
}

export interface MigrationRow {
  migration_name: string;
  finished_at: string | null;
  started_at: string;
}

async function readMigrationRows(client: Awaited<ReturnType<typeof openLocal>>): Promise<MigrationRow[]> {
  const res = await client.execute(
    "SELECT migration_name, finished_at, started_at FROM _prisma_migrations ORDER BY started_at, id"
  );
  return res.rows.map((r) => ({
    migration_name: String(r.migration_name),
    finished_at: r.finished_at == null ? null : String(r.finished_at),
    started_at: String(r.started_at),
  }));
}

export type ApplyResult =
  | { status: "ok"; appliedNow: string[]; appliedCount: number; totalOnDisk: number }
  | { status: "blocked-partial"; partial: string[]; appliedCount: number; totalOnDisk: number }
  | { status: "failed"; failedMigration: string; error: string; appliedNow: string[] };

// Applies pending migrations in lexicographic order. `limit`, when given,
// caps how many pending migrations are applied in this call (used to seed
// a database at an exact intermediate schema version, e.g. "through
// migration 98"). Refuses to apply anything if a prior run left a partial
// (started but not finished) migration row — mirrors the Turso runner's
// partial-state surfacing (scenario: interrupted migration detection).
export async function applyMigrations(dbPath: string, opts: { limit?: number } = {}): Promise<ApplyResult> {
  const client = openLocal(dbPath);
  await ensureMigrationsTable(client);

  const rows = await readMigrationRows(client);
  const applied = new Map(rows.map((r) => [r.migration_name, r.finished_at]));
  const partial = rows.filter((r) => r.finished_at == null).map((r) => r.migration_name);

  const all = listMigrations();

  if (partial.length > 0) {
    await checkpointAndClose(client);
    return { status: "blocked-partial", partial, appliedCount: applied.size, totalOnDisk: all.length };
  }

  let pending = all.filter((name) => !applied.has(name));
  if (typeof opts.limit === "number") pending = pending.slice(0, opts.limit);

  const appliedNow: string[] = [];
  for (const name of pending) {
    const sqlPath = join(MIGRATIONS_DIR, name, "migration.sql");
    const sql = readFileSync(sqlPath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const stmts = splitStatements(sql);
    const startedAt = new Date().toISOString();
    try {
      await applyStatementGroups(client, stmts);
    } catch (err) {
      await checkpointAndClose(client);
      return {
        status: "failed",
        failedMigration: name,
        error: err instanceof Error ? err.message : String(err),
        appliedNow,
      };
    }
    const finishedAt = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO _prisma_migrations
            (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
            VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
      args: [randomUUID(), checksum, finishedAt, name, startedAt, stmts.length],
    });
    appliedNow.push(name);
  }

  await checkpointAndClose(client);
  return { status: "ok", appliedNow, appliedCount: applied.size + appliedNow.length, totalOnDisk: all.length };
}

export interface MigrationAudit {
  appliedCount: number;
  totalOnDisk: number;
  partial: string[]; // started but never finished — interrupted migration
  unknown: string[]; // recorded as applied but absent from prisma/migrations — unknown future migration
  missing: string[]; // present on disk, lexicographically before the latest applied name, never recorded — missing migration
  appliedNames: string[];
}

// Read-only audit of a database's _prisma_migrations bookkeeping against
// the migrations directory on disk. Never mutates. Used both by the
// orchestrator's normal-path checks and by the anomaly-detection scenarios
// (interrupted / missing / unknown migration).
export async function auditMigrationState(dbPath: string): Promise<MigrationAudit> {
  const client = openLocal(dbPath);
  await ensureMigrationsTable(client);
  const rows = await readMigrationRows(client);
  const all = listMigrations();
  const diskSet = new Set(all);
  const appliedNames = rows.map((r) => r.migration_name);
  const appliedSet = new Set(appliedNames);
  const partial = rows.filter((r) => r.finished_at == null).map((r) => r.migration_name);
  const unknown = appliedNames.filter((n) => !diskSet.has(n));
  const finishedNames = rows.filter((r) => r.finished_at != null).map((r) => r.migration_name).sort();
  const maxApplied = finishedNames.length > 0 ? finishedNames[finishedNames.length - 1] : null;
  const missing = maxApplied
    ? all.filter((n) => n < maxApplied && !appliedSet.has(n))
    : [];
  await checkpointAndClose(client);
  return { appliedCount: appliedNames.length, totalOnDisk: all.length, partial, unknown, missing, appliedNames };
}

// Test-only mutation hooks used exclusively to *simulate* anomalous states
// so the detection logic in auditMigrationState can be exercised. Never
// used on the normal apply path.
export const simulate = {
  async markPartial(dbPath: string, migrationName: string): Promise<void> {
    const client = openLocal(dbPath);
    await ensureMigrationsTable(client);
    await client.execute({
      sql: `INSERT INTO _prisma_migrations
            (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
            VALUES (?, 'simulated', NULL, ?, NULL, NULL, ?, 0)`,
      args: [randomUUID(), migrationName, new Date().toISOString()],
    });
    await checkpointAndClose(client);
  },
  async injectUnknownFuture(dbPath: string): Promise<string> {
    const name = "99999999999999_unknown_future_migration";
    const client = openLocal(dbPath);
    await ensureMigrationsTable(client);
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO _prisma_migrations
            (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
            VALUES (?, 'simulated', ?, ?, NULL, NULL, ?, 0)`,
      args: [randomUUID(), now, name, now],
    });
    await checkpointAndClose(client);
    return name;
  },
  async deleteAppliedRecord(dbPath: string, migrationName: string): Promise<void> {
    const client = openLocal(dbPath);
    await client.execute({
      sql: `DELETE FROM _prisma_migrations WHERE migration_name = ?`,
      args: [migrationName],
    });
    await checkpointAndClose(client);
  },
};
