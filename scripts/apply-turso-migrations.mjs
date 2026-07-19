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
//   - R2 pragma repair (this change): SQLite/libSQL treats
//     `PRAGMA foreign_keys = ON|OFF` as a no-op once issued inside an
//     already-open transaction. The runner used to batch an entire
//     migration — including its own leading/trailing foreign_keys toggle —
//     into a single `client.batch(stmts, "write")` transaction, so the
//     toggle never took effect. Asymptomatic against empty tables (every
//     migration to date has applied against a DB with no rows in the
//     rebuilt tables), but migration 20260718030000's populated
//     create-copy-drop-rename rebuild of the ResponsePackage family fails
//     closed with SQLITE_CONSTRAINT once those tables hold real rows.
//     Found and certified via the local-only R2 recovery harness
//     (scripts/certification/lib/migrator.ts on gwx/r2-recovery-certification
//     @ aa1d45a); fixed here directly in the production runner under a
//     reviewed queue card. Statements are now split into groups at
//     `PRAGMA foreign_keys` / `PRAGMA defer_foreign_keys` boundaries: each
//     such PRAGMA runs standalone (outside any transaction, so it actually
//     takes effect and is read back to confirm), and only the contiguous
//     non-PRAGMA runs between them are batched atomically. The runner also
//     verifies foreign_keys is restored to its pre-migration value after
//     both success and failure, surfaces any restoration failure as a hard
//     error, and runs `PRAGMA foreign_key_check` after any migration that
//     touched the foreign_keys toggle — failing closed (no bookkeeping row
//     written) on any violation. This also fixes a related latent defect in
//     the naive `;`-at-end-of-line statement splitter: migration
//     20260718030000's `CREATE TRIGGER ... BEGIN ... END;` block contains an
//     internal `SELECT RAISE(ABORT, ...);` statement, which the old splitter
//     cut the trigger in half on — that migration could not have applied
//     through this runner at all, independent of the pragma defect. The
//     splitter is now trigger-body-aware.
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
//   2 — a migration failed mid-run (DB may be in partial state, inspect logs); this
//       now also covers a failed foreign_keys restoration and a failed
//       post-migration foreign_key_check — both leave no bookkeeping row
//
// Module structure (R2 pragma repair): the tier fence, connection, and
// migrate loop below now live inside main(), invoked only when this file is
// run as the CLI entrypoint (`node scripts/apply-turso-migrations.mjs`).
// listMigrations/splitStatements/applyMigrationStatements/readForeignKeysState
// are exported so focused tests can exercise the real migration-application
// logic directly against a disposable local `file:` SQLite database, without
// going through the APP_ENV/DATABASE_URL tier fence or importing anything
// that has side effects at module-load time.

import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "prisma", "migrations");

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

export function listMigrations() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    fail(`Cannot read migrations dir ${MIGRATIONS_DIR}: ${err.message}`);
  }
  // Migration name rule (Phase O1.5.a): match Prisma's actual behavior —
  // any subdirectory of prisma/migrations that contains a migration.sql
  // file. Previously this used /^\d{14}_/ (strict 14-digit timestamp),
  // which silently SKIPPED three legacy short-prefix migrations
  // (20260426_*, 20260427_*). Prisma CLI applies them; this runner
  // didn't. The mismatch caused validate-staging.mjs to report parity
  // failures even though the local migration set was complete.
  //
  // The corrected rule:
  //   1. directory starts with a digit (any timestamp format)
  //   2. AND contains a migration.sql file
  //
  // This matches `replay-validation.mjs` and `migration-lint.mjs`,
  // making all three tools agree on the canonical migration set.
  return entries
    .filter((e) => /^\d/.test(e))
    .filter((e) => {
      try {
        if (!statSync(join(MIGRATIONS_DIR, e)).isDirectory()) return false;
        // Require migration.sql to be present (Prisma's actual rule).
        return statSync(join(MIGRATIONS_DIR, e, "migration.sql")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

export function splitStatements(sql) {
  // SQLite statements separated by `;` at end of line/file. Strips comments
  // and empty entries. Good enough for Prisma-generated migration.sql for
  // every case except one: a `CREATE TRIGGER ... BEGIN ... END;` block can
  // contain its own internal statements terminated by `;` (e.g. migration
  // 20260718030000's `SELECT RAISE(ABORT, ...);`). A plain end-of-line `;`
  // split cuts those trigger bodies in half. Track trigger-body state and
  // only close the statement at BEGIN's matching `END;` line.
  const src = sql.replace(/^\s*--.*$/gm, "");
  const lines = src.split("\n");
  const statements = [];
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
    // Inside a trigger body: only the trigger's own `END;` terminator line
    // closes the statement — semicolons before it belong to the trigger's
    // own statement list and must not split it.
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

// SQLite (and libSQL) treat `PRAGMA foreign_keys = ON|OFF` as a no-op when
// issued inside an already-open transaction — it only takes effect between
// transactions. `client.batch(stmts, "write")` wraps every statement passed
// to it in one implicit transaction, so a migration's own leading/trailing
// foreign_keys toggle was previously swallowed whenever it rode along inside
// the same batch as the DDL it was meant to guard.
const FOREIGN_KEYS_PRAGMA_RE = /^\s*PRAGMA\s+foreign_keys\s*=\s*(ON|OFF)\s*;?\s*$/i;
const FK_RELATED_PRAGMA_RE = /^\s*PRAGMA\s+(foreign_keys|defer_foreign_keys)\s*=/i;

export async function readForeignKeysState(client) {
  const res = await client.execute("PRAGMA foreign_keys");
  const row = res.rows[0];
  if (!row) throw new Error("PRAGMA foreign_keys returned no rows");
  const raw = row.foreign_keys ?? row[0];
  return Number(raw);
}

async function setForeignKeysState(client, wantOn) {
  await client.execute(`PRAGMA foreign_keys=${wantOn ? "ON" : "OFF"}`);
  const now = await readForeignKeysState(client);
  const wantVal = wantOn ? 1 : 0;
  if (now !== wantVal) {
    throw new Error(
      `PRAGMA foreign_keys=${wantOn ? "ON" : "OFF"} did not take effect (read back ${now})`
    );
  }
  return now;
}

// Applies one migration's already-split statement list against an open
// client. Groups are split at `PRAGMA foreign_keys` / `PRAGMA
// defer_foreign_keys` boundaries: each such PRAGMA is executed standalone —
// outside any transaction, so it actually takes effect — with a readback
// check immediately after any `foreign_keys=` toggle. Only the contiguous
// non-PRAGMA runs between them are batched atomically. Required behavior,
// preserved in every code path below:
//   - the pre-migration foreign_keys state is captured before anything runs;
//   - it is restored (and the restoration itself verified) after both
//     success and failure — a restoration failure is thrown, never swallowed;
//   - if the migration touched the foreign_keys toggle at all,
//     `PRAGMA foreign_key_check` runs afterward and any violation throws
//     (fails closed) before the caller can record the migration as finished.
export async function applyMigrationStatements(client, stmts) {
  const initialForeignKeys = await readForeignKeysState(client);
  let touchedForeignKeys = false;

  const restore = async () => {
    const current = await readForeignKeysState(client);
    if (current === initialForeignKeys) return;
    await setForeignKeysState(client, initialForeignKeys === 1);
  };

  try {
    let i = 0;
    while (i < stmts.length) {
      const stmt = stmts[i];
      if (FK_RELATED_PRAGMA_RE.test(stmt)) {
        await client.execute(stmt);
        const m = stmt.match(FOREIGN_KEYS_PRAGMA_RE);
        if (m) {
          touchedForeignKeys = true;
          const wantOn = m[1].toUpperCase() === "ON";
          const now = await readForeignKeysState(client);
          const wantVal = wantOn ? 1 : 0;
          if (now !== wantVal) {
            throw new Error(
              `Migration statement "${stmt.trim()}" did not take effect (read back foreign_keys=${now})`
            );
          }
        }
        i++;
        continue;
      }
      const group = [];
      while (i < stmts.length && !FK_RELATED_PRAGMA_RE.test(stmts[i])) {
        group.push(stmts[i]);
        i++;
      }
      if (group.length > 0) await client.batch(group, "write");
    }
  } catch (err) {
    try {
      await restore();
    } catch (restoreErr) {
      throw new Error(
        `${err.message}; additionally FAILED to restore foreign_keys to its original state ` +
          `(${initialForeignKeys}) after the failure: ${restoreErr.message}`
      );
    }
    throw err;
  }

  try {
    await restore();
  } catch (restoreErr) {
    throw new Error(
      `Migration statements applied but FAILED to restore foreign_keys to its original state ` +
        `(${initialForeignKeys}): ${restoreErr.message}`
    );
  }

  if (touchedForeignKeys) {
    const violations = await client.execute("PRAGMA foreign_key_check");
    if (violations.rows.length > 0) {
      const sample = violations.rows
        .slice(0, 5)
        .map((r) => String(r.table ?? r[0]))
        .join(", ");
      throw new Error(
        `foreign_key_check found ${violations.rows.length} violation(s) after migration ` +
          `(tables: ${sample}${violations.rows.length > 5 ? ", ..." : ""})`
      );
    }
  }

  return { touchedForeignKeys };
}

// Applies `pending` (migration names, in the order given) against `client`,
// reading each migration.sql from MIGRATIONS_DIR, and recording each success
// in _prisma_migrations exactly as the CLI path does. Exported so tests
// exercise the identical bookkeeping loop the CLI runs, not a re-implemented
// twin of it. Rethrows on the first failure — the caller decides exit
// behavior (the CLI maps this to exit 2; nothing is recorded for the
// migration that threw, matching current partial-migration semantics).
export async function applyPendingMigrations(client, pending) {
  const appliedNow = [];
  for (const name of pending) {
    const sqlPath = join(MIGRATIONS_DIR, name, "migration.sql");
    const sql = readFileSync(sqlPath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const stmts = splitStatements(sql);
    const startedAt = new Date().toISOString();
    const result = await applyMigrationStatements(client, stmts);
    const finishedAt = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO _prisma_migrations
            (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
            VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
      args: [randomUUID(), checksum, finishedAt, name, startedAt, stmts.length],
    });
    appliedNow.push({ name, ...result });
  }
  return appliedNow;
}

export async function ensureMigrationsTable(client) {
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

async function main() {
  const DRY_RUN = process.argv.includes("--dry-run");

  // --- Tier fence (Phase R6.6) ---------------------------------------------
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

  const c = createClient({ url });

  console.log(`[apply-turso-migrations] APP_ENV=${appEnv} — connecting...`);

  // Ensure _prisma_migrations exists. Schema matches Prisma's CLI exactly so
  // `prisma migrate status` against a SQLite-shaped target stays consistent.
  // (R6.6 addition: the original 2030909 script assumed this table already
  // existed; that assumption fails on a freshly-provisioned staging DB.)
  await ensureMigrationsTable(c);

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

  for (const name of pending) console.log(`\nApplying ${name}...`);
  let appliedNow;
  try {
    appliedNow = await applyPendingMigrations(c, pending);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.error("  Inspect Turso state before re-running.");
    process.exit(2);
  }
  for (const r of appliedNow) {
    console.log(
      `  OK ${r.name}` + (r.touchedForeignKeys ? " [foreign_keys toggled + restored + checked]" : "")
    );
  }

  console.log(`\nDone. Applied ${pending.length} migration(s).`);
  await c.close();
}

const isMainModule = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(`[apply-turso-migrations] FATAL: ${err.message}`);
    process.exit(1);
  });
}
