// Local-only white-box regression coverage for the parts of the R2 pragma
// repair that are hard to observe through an ordinary end-to-end apply:
// restoration-failure surfacing, PRAGMA-effect verification, fail-closed
// foreign_key_check gating, and no-bookkeeping-on-forced-failure. Every
// database is a disposable file under os.tmpdir(); the "lying" client below
// wraps a REAL local sqlite connection and only ever intercepts the return
// value of a `PRAGMA foreign_keys` read-back — it never fabricates data and
// never touches a network or a real DB.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Client } from "@libsql/client";
import {
  listMigrations,
  splitStatements,
  applyMigrationStatements,
  applyPendingMigrations,
  ensureMigrationsTable,
  readForeignKeysState,
} from "../../scripts/apply-turso-migrations.mjs";
import { openTmpDb, cleanupTmpDb, type TmpDb } from "./helpers";

let db: TmpDb;

beforeEach(async () => {
  db = openTmpDb("integrity");
  await ensureMigrationsTable(db.client);
});

afterEach(() => {
  cleanupTmpDb(db);
});

// Wraps a real client so that the Nth-and-later bare `PRAGMA foreign_keys`
// read returns the OPPOSITE of what the database actually holds — simulating
// a connection where the toggle silently fails to take effect (or a
// readback that never catches up). Every write (`execute` for anything else,
// and `batch`) is passed straight through to the real connection, so actual
// state is always genuine; only the reported value is poisoned.
function makeLyingForeignKeysClient(real: Client, poisonFromRead: number) {
  let readCount = 0;
  return {
    async execute(query: any) {
      const sql = typeof query === "string" ? query : query.sql;
      if (/^\s*PRAGMA\s+foreign_keys\s*;?\s*$/i.test(String(sql).trim())) {
        readCount++;
        const res = await real.execute(query);
        if (readCount >= poisonFromRead) {
          const actual = Number((res.rows[0] as any).foreign_keys);
          return { rows: [{ foreign_keys: actual === 1 ? 0 : 1 }] } as any;
        }
        return res;
      }
      return real.execute(query);
    },
    async batch(stmts: string[], mode: "write" | "read" | "deferred") {
      return real.batch(stmts, mode);
    },
    close() {
      return real.close();
    },
  };
}

describe("PRAGMA effect verification", () => {
  test("a toggle that appears not to take effect fails closed before any DDL runs", async () => {
    const lying = makeLyingForeignKeysClient(db.client, 2); // read #1 (initial) truthful, read #2 (post-OFF verify) lied
    const stmts = splitStatements(`
PRAGMA foreign_keys=OFF;
CREATE TABLE "t" ("id" INTEGER);
`);
    await expect(applyMigrationStatements(lying as any, stmts)).rejects.toThrow(/did not take effect/);

    const sqliteMaster = await db.client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='t'`
    );
    expect(sqliteMaster.rows).toHaveLength(0); // the DDL group was never reached
  });
});

describe("restoration failure is surfaced, never swallowed", () => {
  test("after an otherwise-successful migration", async () => {
    const lying = makeLyingForeignKeysClient(db.client, 2); // initial capture truthful, restore-check onward lied
    const stmts = splitStatements(`CREATE TABLE "simple" ("id" INTEGER);`);

    await expect(applyMigrationStatements(lying as any, stmts)).rejects.toThrow(/FAILED to restore/);

    // The DDL itself genuinely succeeded — only the restoration verification
    // failed. The caller must still treat this as a non-success (it threw).
    const sqliteMaster = await db.client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='simple'`
    );
    expect(sqliteMaster.rows).toHaveLength(1);
  });

  test("after a migration failure, the original error and the restore failure are both surfaced", async () => {
    const lying = makeLyingForeignKeysClient(db.client, 4); // initial + post-OFF-verify truthful; restore-check onward lied
    await db.client.batch(
      [`CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY)`, `INSERT INTO "parent" VALUES (1)`],
      "write"
    );
    const stmts = splitStatements(`
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_parent" ("id" INTEGER PRIMARY KEY);
INSERT INTO "new_parent" SELECT * FROM "parent";
THIS IS NOT VALID SQL;
PRAGMA foreign_keys=ON;
`);

    await expect(applyMigrationStatements(lying as any, stmts)).rejects.toThrow(/additionally FAILED to restore/);
  });
});

describe("foreign_key_check gates success (fail closed)", () => {
  test("a violation introduced by the migration itself blocks success, even though FK state is still restored", async () => {
    await db.client.batch(
      [
        `CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "name" TEXT)`,
        `CREATE TABLE "child" ("id" INTEGER PRIMARY KEY, "parentId" INTEGER NOT NULL REFERENCES "parent"("id"))`,
      ],
      "write"
    );
    await db.client.batch(
      [`INSERT INTO "parent" VALUES (1, 'a')`, `INSERT INTO "child" VALUES (1, 1)`],
      "write"
    );
    const initial = await readForeignKeysState(db.client);

    // A deliberately broken rebuild: drops row id=1 from the copy, orphaning
    // "child".parentId=1. Foreign-key enforcement is correctly suspended
    // during the rebuild (so this doesn't fail on the DROP TABLE step) —
    // the orphan is only caught by the post-migration foreign_key_check.
    const stmts = splitStatements(`
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_parent" ("id" INTEGER PRIMARY KEY, "name" TEXT);
INSERT INTO "new_parent" SELECT * FROM "parent" WHERE "id" != 1;
DROP TABLE "parent";
ALTER TABLE "new_parent" RENAME TO "parent";
PRAGMA foreign_keys=ON;
`);

    await expect(applyMigrationStatements(db.client, stmts)).rejects.toThrow(/foreign_key_check found/);
    expect(await readForeignKeysState(db.client)).toBe(initial);
  });
});

describe("a forced migration failure does not record migration completion", () => {
  test("no _prisma_migrations row is written when the first migration's own DDL fails", async () => {
    const first = listMigrations()[0];
    expect(first).toBe("20260404033618_init");

    // Pre-create a conflicting "Bid" table so migration 20260404033618_init's
    // own `CREATE TABLE "Bid" (...)` fails with "table already exists".
    await db.client.execute(`CREATE TABLE "Bid" ("id" INTEGER)`);

    await expect(applyPendingMigrations(db.client, [first])).rejects.toThrow();

    const rows = await db.client.execute({
      sql: "SELECT migration_name FROM _prisma_migrations WHERE migration_name = ?",
      args: [first],
    });
    expect(rows.rows).toHaveLength(0);

    // From the bookkeeping's point of view the migration is still pending.
    const appliedRows = await db.client.execute("SELECT migration_name FROM _prisma_migrations");
    const appliedNames = new Set(appliedRows.rows.map((r: any) => r.migration_name));
    expect(appliedNames.has(first)).toBe(false);
  });
});
