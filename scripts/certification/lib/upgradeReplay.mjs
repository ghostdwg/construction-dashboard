#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/upgradeReplay.mjs
//
//  Incremental "last-3-migrations" upgrade validation gate: stages the
//  candidate's migrations cumulatively (all-but-2, all-but-1, all) into
//  scratch directories and runs a real `prisma migrate deploy` against a
//  fresh disposable SQLite file per stage, asserting each stage succeeds
//  before moving to the next. Generic over however many migrations the
//  candidate actually has — never hardcoded to specific migration names.
//
//  Deliberately independent of scripts/replay-validation.mjs (a required CI
//  gate) rather than importing/modifying it: it re-derives the same idioms
//  (ephemeral file: DATABASE_URL under the worktree's own scratch scope,
//  spawnSync via the injected exec, allowlisted env) at a fraction of the
//  size, since replay-validation.mjs only ever validates the *full* set.
// ──────────────────────────────────────────────────────────────────────────────

import { join } from "node:path";
import { buildAllowlistedEnv } from "./env.mjs";

function npxBin() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function isMigrationDir(deps, migrationsDir, entry) {
  if (!/^\d/.test(entry)) return false;
  return deps.fs.statSync(join(migrationsDir, entry)).isDirectory();
}

function stageMigrationSubset(worktreeDir, migrationsDir, subset, stageDir, deps) {
  const stageMigrationsDir = join(stageDir, "migrations");
  deps.fs.mkdirSync(stageMigrationsDir, { recursive: true });

  const lockSrc = join(migrationsDir, "migration_lock.toml");
  if (deps.fs.existsSync(lockSrc)) {
    deps.fs.writeFileSync(join(stageMigrationsDir, "migration_lock.toml"), deps.fs.readFileSync(lockSrc, "utf8"));
  }
  for (const name of subset) {
    const destDir = join(stageMigrationsDir, name);
    deps.fs.mkdirSync(destDir, { recursive: true });
    const sql = deps.fs.readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    deps.fs.writeFileSync(join(destDir, "migration.sql"), sql);
  }

  const schemaSrc = join(worktreeDir, "prisma", "schema.prisma");
  deps.fs.writeFileSync(join(stageDir, "schema.prisma"), deps.fs.readFileSync(schemaSrc, "utf8"));
}

/** Best-effort table-name listing for a stage's disposable DB — same
 *  node:sqlite → @libsql/client → sqlite3-cli fallback chain as
 *  scripts/replay-validation.mjs, isolated here so it can be swapped for a
 *  fake in tests via deps.listSqliteTables. */
async function defaultListSqliteTables(dbPath, deps) {
  try {
    const sqliteMod = await import("node:sqlite");
    const db = new sqliteMod.DatabaseSync(dbPath, { open: true });
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    db.close();
    return rows.map((r) => r.name);
  } catch {
    try {
      const { createClient } = await import("@libsql/client");
      const c = createClient({ url: `file:${dbPath}` });
      const result = await c.execute("SELECT name FROM sqlite_master WHERE type='table'");
      await c.close();
      return result.rows.map((r) => r.name);
    } catch {
      const check = deps.exec(process.platform === "win32" ? "sqlite3.exe" : "sqlite3", [dbPath, "SELECT name FROM sqlite_master WHERE type='table'"]);
      if (check.status === 0) return check.stdout.split(/\s+/).filter(Boolean);
      throw new Error("no sqlite reader available: node:sqlite, @libsql/client, and sqlite3 cli all failed");
    }
  }
}

export async function runIncrementalUpgradeValidation(worktreeDir, deps) {
  const migrationsDir = join(worktreeDir, "prisma", "migrations");
  let all;
  try {
    all = deps.fs
      .readdirSync(migrationsDir)
      .filter((e) => isMigrationDir(deps, migrationsDir, e))
      .sort();
  } catch (err) {
    return { name: "MIGRATION_UPGRADE_VALIDATION", status: "fail", detail: `cannot read ${migrationsDir}: ${err.message}` };
  }

  if (all.length < 2) {
    return {
      name: "MIGRATION_UPGRADE_VALIDATION",
      status: "skip",
      detail: `only ${all.length} migration(s) on disk — incremental N-2→N-1→N validation not applicable`,
    };
  }

  const last = all.slice(-3);
  const scratchRoot = join(worktreeDir, ".certify-scratch", "upgrade");
  const listTables = deps.listSqliteTables ?? defaultListSqliteTables;

  for (let i = 0; i < last.length; i++) {
    const subset = all.slice(0, all.length - last.length + i + 1);
    const stageDir = join(scratchRoot, `stage-${i}`);
    const dbPath = join(scratchRoot, `stage-${i}.db`);

    try {
      stageMigrationSubset(worktreeDir, migrationsDir, subset, stageDir, deps);
    } catch (err) {
      return {
        name: "MIGRATION_UPGRADE_VALIDATION",
        status: "fail",
        detail: `stage ${i} (through ${subset[subset.length - 1]}): failed to stage migration subset: ${err.message}`,
      };
    }

    const deploy = deps.exec(npxBin(), ["prisma", "migrate", "deploy", "--schema", join(stageDir, "schema.prisma")], {
      cwd: worktreeDir,
      env: buildAllowlistedEnv(deps.ambientEnv, { DATABASE_URL: `file:${dbPath}` }),
    });
    if (deploy.status !== 0) {
      return {
        name: "MIGRATION_UPGRADE_VALIDATION",
        status: "fail",
        detail: `stage ${i} (through ${subset[subset.length - 1]}) failed to apply:\n${(deploy.stdout + deploy.stderr).trim()}`,
      };
    }

    try {
      const tables = await listTables(dbPath, deps);
      if (tables.length === 0) {
        return {
          name: "MIGRATION_UPGRADE_VALIDATION",
          status: "fail",
          detail: `stage ${i} (through ${subset[subset.length - 1]}) applied cleanly but no tables were created`,
        };
      }
    } catch (err) {
      return {
        name: "MIGRATION_UPGRADE_VALIDATION",
        status: "fail",
        detail: `stage ${i} (through ${subset[subset.length - 1]}): could not verify resulting tables: ${err.message}`,
      };
    }
  }

  return {
    name: "MIGRATION_UPGRADE_VALIDATION",
    status: "pass",
    detail: `incremental upgrade validated across ${last.length} stage(s): ${last.join(" → ")}`,
  };
}
