// Local-only regression suite for the R2 migration-runner foreign_keys
// pragma repair (scripts/apply-turso-migrations.mjs). Every database here is
// a disposable file under os.tmpdir(), created and destroyed within a single
// test — never a real DB, never Turso, no network, no DATABASE_URL, no
// credentials. Exercises the runner's real exported functions
// (splitStatements / applyMigrationStatements / applyPendingMigrations /
// ensureMigrationsTable / readForeignKeysState / listMigrations), not a
// reimplemented twin of them.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  listMigrations,
  splitStatements,
  applyMigrationStatements,
  applyPendingMigrations,
  ensureMigrationsTable,
  readForeignKeysState,
} from "../../scripts/apply-turso-migrations.mjs";
import { openTmpDb, cleanupTmpDb, seedResponsePackageChain, seedMeetingParticipant, type TmpDb } from "./helpers";

const MIGRATION_101 = "20260718030000_r2b2_trade_response_reviewer_repairs";
const MIGRATION_100 = "20260718024444_r2_release_blocker_retention";
const MIGRATION_99 = "20260718010000_r2b2_trade_response_packages";
const MIGRATION_102 = "20260721010000_meeting_intelligence_v1_foundation";
const MIGRATION_103 = "20260721020000_meeting_intelligence_v2_local_worker";

let db: TmpDb;

beforeEach(async () => {
  db = openTmpDb("main");
  await ensureMigrationsTable(db.client);
});

afterEach(() => {
  cleanupTmpDb(db);
});

describe("migration inventory", () => {
  test("migration 103 is the last migration and preserves the prior sequence", () => {
    const all = listMigrations();
    expect(all[all.length - 1]).toBe(MIGRATION_103);
    expect(all[all.length - 2]).toBe(MIGRATION_102);
    expect(all[all.length - 3]).toBe(MIGRATION_101);
    expect(all[all.length - 4]).toBe(MIGRATION_100);
    expect(all[all.length - 5]).toBe(MIGRATION_99);
  });
});

describe("fresh replay through 103", () => {
  test("applies the full chain to an empty database", async () => {
    const all = listMigrations();
    const applied = await applyPendingMigrations(db.client, all);
    expect(applied.map((a: any) => a.name)).toEqual(all);
    const rows = await db.client.execute("SELECT COUNT(*) as n FROM _prisma_migrations");
    expect(Number(rows.rows[0].n)).toBe(all.length);
    expect(await readForeignKeysState(db.client)).toBe(1);
    const workerTable = await db.client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'MeetingIntelligenceWorkerJob'`,
    );
    expect(workerTable.rows).toHaveLength(1);
    const indexes = await db.client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'MeetingIntelligenceWorkerJob'`,
    );
    expect(indexes.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "MeetingIntelligenceWorkerJob_idempotencyKey_key",
        "MeetingIntelligenceWorkerJob_resultChecksum_key",
        "MeetingIntelligenceWorkerJob_artifactId_activeSlot_key",
        "MeetingIntelligenceWorkerJob_status_leaseExpiresAt_idx",
      ]),
    );
  }, 15_000);

  test("never depends on DATABASE_URL or APP_ENV (no tier fence, no network)", async () => {
    const savedUrl = process.env.DATABASE_URL;
    const savedEnv = process.env.APP_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.APP_ENV;
    try {
      const all = listMigrations();
      const applied = await applyPendingMigrations(db.client, all);
      expect(applied).toHaveLength(all.length);
    } finally {
      if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
      if (savedEnv !== undefined) process.env.APP_ENV = savedEnv;
    }
  }, 15_000);
});

describe("populated upgrade through migration 101", () => {
  test("a populated pre-101 database upgrades through 101 successfully, data and relationships survive", async () => {
    const all = listMigrations();
    const preMigration101 = all.slice(0, all.indexOf(MIGRATION_101)); // migrations 1..100
    expect(preMigration101[preMigration101.length - 1]).toBe(MIGRATION_100);

    await applyPendingMigrations(db.client, preMigration101);
    await seedResponsePackageChain(db.client);

    const before = await readForeignKeysState(db.client);
    expect(before).toBe(1);

    const applied = await applyPendingMigrations(db.client, [MIGRATION_101]);
    expect(applied).toHaveLength(1);
    expect(applied[0].touchedForeignKeys).toBe(true);

    const after = await readForeignKeysState(db.client);
    expect(after).toBe(before);

    // Row-level survival across the create-copy-drop-rename rebuild.
    const pkg = await db.client.execute(`SELECT "title", "bidId" FROM "ResponsePackage" WHERE "id" = 1`);
    expect(pkg.rows).toHaveLength(1);
    expect(pkg.rows[0].title).toBe("[TEST] Package");

    const revision = await db.client.execute(
      `SELECT "responderName", "gcReview" FROM "TradeResponseRevision" WHERE "id" = 1`
    );
    expect(revision.rows).toHaveLength(1);
    expect(revision.rows[0].responderName).toBe("[TEST] Responder");

    const attachment = await db.client.execute(
      `SELECT "storageKey" FROM "TradeResponseAttachment" WHERE "id" = 1`
    );
    expect(attachment.rows[0].storageKey).toBe("[TEST]/key.pdf");

    // Migration 101's backfill INSERT (gcReview <> 'PENDING' -> TradeResponseReviewDecision)
    // must have picked up the seeded row.
    const decision = await db.client.execute(
      `SELECT "decision", "reviewedBy" FROM "TradeResponseReviewDecision" WHERE "responseRevisionId" = 1`
    );
    expect(decision.rows).toHaveLength(1);
    expect(decision.rows[0].decision).toBe("APPROVED");
    expect(decision.rows[0].reviewedBy).toBe("[TEST] reviewer");

    const fkCheck = await db.client.execute("PRAGMA foreign_key_check");
    expect(fkCheck.rows).toHaveLength(0);
  });

  test("upgrade 99 -> 100 -> 101 succeeds as three discrete steps", async () => {
    const all = listMigrations();
    const idx99 = all.indexOf(MIGRATION_99);
    const idx100 = all.indexOf(MIGRATION_100);
    const idx101 = all.indexOf(MIGRATION_101);
    expect(idx99).toBeGreaterThan(-1);
    expect(idx100).toBe(idx99 + 1);
    expect(idx101).toBe(idx100 + 1);

    await applyPendingMigrations(db.client, all.slice(0, idx99)); // baseline, pre-99
    expect(await readForeignKeysState(db.client)).toBe(1);

    const step99 = await applyPendingMigrations(db.client, [MIGRATION_99]);
    expect(step99).toHaveLength(1);
    expect(await readForeignKeysState(db.client)).toBe(1);

    // ResponsePackage-family tables now exist (created additively by 99) — seed
    // before 100/101 so both rebuilds see populated data where relevant.
    await seedResponsePackageChain(db.client);
    await seedMeetingParticipant(db.client);

    const step100 = await applyPendingMigrations(db.client, [MIGRATION_100]);
    expect(step100).toHaveLength(1);
    expect(step100[0].touchedForeignKeys).toBe(true);
    expect(await readForeignKeysState(db.client)).toBe(1);
    const participant = await db.client.execute(
      `SELECT "name" FROM "MeetingParticipant" WHERE "id" = 1`
    );
    expect(participant.rows[0].name).toBe("[TEST] Participant");

    const step101 = await applyPendingMigrations(db.client, [MIGRATION_101]);
    expect(step101).toHaveLength(1);
    expect(step101[0].touchedForeignKeys).toBe(true);
    expect(await readForeignKeysState(db.client)).toBe(1);

    const fkCheck = await db.client.execute("PRAGMA foreign_key_check");
    expect(fkCheck.rows).toHaveLength(0);
  });

  test("repeated runner invocation is safe (idempotent, zero pending on repeat)", async () => {
    const all = listMigrations();
    await applyPendingMigrations(db.client, all);

    const appliedRows = await db.client.execute(
      "SELECT migration_name, finished_at FROM _prisma_migrations"
    );
    const appliedNames = new Set(appliedRows.rows.map((r: any) => r.migration_name));
    const pendingAgain = listMigrations().filter((name: string) => !appliedNames.has(name));
    expect(pendingAgain).toHaveLength(0);

    const secondRun = await applyPendingMigrations(db.client, pendingAgain);
    expect(secondRun).toHaveLength(0);
    expect(await readForeignKeysState(db.client)).toBe(1);
  });
});

describe("synthetic minimal repro (mechanism-level proof, independent of the full chain)", () => {
  async function seedParentChild(client: any) {
    await client.batch(
      [
        `CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "name" TEXT)`,
        `CREATE TABLE "child" ("id" INTEGER PRIMARY KEY, "parentId" INTEGER NOT NULL REFERENCES "parent"("id"))`,
      ],
      "write"
    );
    await client.batch(
      [`INSERT INTO "parent" VALUES (1, 'a')`, `INSERT INTO "child" VALUES (1, 1)`],
      "write"
    );
  }

  const rebuildSql = `
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_parent" ("id" INTEGER PRIMARY KEY, "name" TEXT);
INSERT INTO "new_parent" SELECT * FROM "parent";
DROP TABLE "parent";
ALTER TABLE "new_parent" RENAME TO "parent";
PRAGMA foreign_keys=ON;
`;

  test("sanity: naively batching PRAGMA + rebuild together still fails against populated FK-referenced rows", async () => {
    // Proves the defect this fix addresses is real: without splitting the
    // PRAGMA out of the transaction, DROP TABLE on a populated
    // FK-referenced parent fails closed with SQLITE_CONSTRAINT because the
    // toggle never actually took effect (a documented SQLite/libSQL no-op
    // inside an open transaction).
    await seedParentChild(db.client);
    const stmts = splitStatements(rebuildSql);
    await expect(db.client.batch(stmts, "write")).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  test("foreign_keys is OFF before the table-rebuild transaction begins, and restored after success", async () => {
    await seedParentChild(db.client);
    const initial = await readForeignKeysState(db.client);
    expect(initial).toBe(1);

    const stmts = splitStatements(rebuildSql);
    const result = await applyMigrationStatements(db.client, stmts);
    expect(result.touchedForeignKeys).toBe(true);

    expect(await readForeignKeysState(db.client)).toBe(initial);
    const rows = await db.client.execute(`SELECT * FROM "parent"`);
    expect(rows.rows).toEqual([{ id: 1, name: "a" }]);
    const childRows = await db.client.execute(`SELECT * FROM "child"`);
    expect(childRows.rows).toEqual([{ id: 1, parentId: 1 }]);
  });

  test("foreign_keys is restored to its original state after a migration failure", async () => {
    await seedParentChild(db.client);
    const initial = await readForeignKeysState(db.client);

    const brokenSql = `
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_parent" ("id" INTEGER PRIMARY KEY, "name" TEXT);
INSERT INTO "new_parent" SELECT * FROM "parent";
THIS IS NOT VALID SQL;
PRAGMA foreign_keys=ON;
`;
    const stmts = splitStatements(brokenSql);
    await expect(applyMigrationStatements(db.client, stmts)).rejects.toThrow();

    // The failure happened while foreign_keys was OFF (mid-rebuild); the
    // function must still restore it to the pre-migration value.
    expect(await readForeignKeysState(db.client)).toBe(initial);
  });
});
