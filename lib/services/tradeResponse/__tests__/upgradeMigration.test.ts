import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const REPAIR_MIGRATION = "20260718030000_r2b2_trade_response_reviewer_repairs";
const BASE_RETENTION_MIGRATION = "20260718024444_r2_release_blocker_retention";
const MEETING_INTELLIGENCE_MIGRATION = "20260721010000_meeting_intelligence_v1_foundation";
const LEGACY_REVIEWED_AT = "2026-07-17T18:30:00.000Z";
const LEGACY_COMMENTARY = "Pre-repair detailed reviewer commentary";
const LEGACY_REVIEWER = "legacy-gc-reviewer";

let db: (typeof import("@/lib/prisma"))["prisma"];
let packages: typeof import("../packages");
let testDir = "";
let previousDatabaseUrl: string | undefined;
let previousAppEnv: string | undefined;

function deployMigrations(databaseUrl: string): void {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, APP_ENV: "local", DATABASE_URL: databaseUrl },
    stdio: "ignore",
  });
}

async function applyPreIntegrationMigrations(databaseUrl: string): Promise<void> {
  const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== BASE_RETENTION_MIGRATION &&
        entry.name !== REPAIR_MIGRATION &&
        entry.name !== MEETING_INTELLIGENCE_MIGRATION
    )
    .map((entry) => entry.name)
    .sort();
  // Seed the true 99-migration predecessor state, then let Prisma apply both
  // accepted forward migrations in their integrated order. This proves the
  // base-retention table rebuild does not erase trade review evidence before
  // the trade repair backfills it.
  expect(migrations).toHaveLength(99);
  expect(migrations).toContain("20260718010000_r2b2_trade_response_packages");
  const client = createClient({ url: databaseUrl });
  try {
    await client.executeMultiple(`
      CREATE TABLE "_prisma_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "checksum" TEXT NOT NULL,
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
        "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
      );
    `);
    for (const migrationName of migrations) {
      const sql = await readFile(path.join(migrationsRoot, migrationName, "migration.sql"), "utf8");
      const startedAt = new Date().toISOString();
      await client.executeMultiple(sql);
      const finishedAt = new Date().toISOString();
      await client.execute({
        sql: 'INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)',
        args: [randomUUID(), createHash("sha256").update(sql).digest("hex"), finishedAt, migrationName, startedAt],
      });
    }
  } finally {
    client.close();
  }
}

async function seedReviewedRevision(databaseUrl: string): Promise<void> {
  const client = createClient({ url: databaseUrl });
  try {
    await client.batch([
      { sql: 'INSERT INTO "Bid" ("projectName", "updatedAt") VALUES (?, ?)', args: ["Synthetic upgrade", LEGACY_REVIEWED_AT] },
      { sql: 'INSERT INTO "TrackedItem" ("bidId", "kind", "title", "extractionMethod", "updatedAt") VALUES (1, ?, ?, ?, ?)', args: ["FIELD_ITEM", "Upgrade item", "manual", LEGACY_REVIEWED_AT] },
      { sql: 'INSERT INTO "ResponsePackage" ("bidId", "packageNumber", "title", "status", "createdBy", "updatedAt") VALUES (1, 1, ?, ?, ?, ?)', args: ["Upgrade review package", "GC_REVIEW", "synthetic", LEGACY_REVIEWED_AT] },
      { sql: 'INSERT INTO "ResponsePackageItem" ("packageId", "bidId", "trackedItemId") VALUES (1, 1, 1)', args: [] },
      {
        sql: 'INSERT INTO "TradeResponseRevision" ("bidId", "packageItemId", "responderName", "responseType", "responseText", "gcReview", "gcReviewBy", "gcReviewAt", "gcCommentary") VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?)',
        args: ["Synthetic responder", "COMPLETED", "Immutable contractor response", "RETURNED_FOR_REVISION", LEGACY_REVIEWER, LEGACY_REVIEWED_AT, LEGACY_COMMENTARY],
      },
    ], "write");
  } finally {
    client.close();
  }
}

beforeAll(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), "gwx-r2b2-upgrade-test-"));
  const databaseUrl = `file:${path.join(testDir, "upgrade.db")}`;
  await applyPreIntegrationMigrations(databaseUrl);
  await seedReviewedRevision(databaseUrl);
  deployMigrations(databaseUrl);

  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAppEnv = process.env.APP_ENV;
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ENV = "local";
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ prisma: db } = await import("@/lib/prisma"));
  packages = await import("../packages");
}, 90_000);

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previousAppEnv;
  if (testDir) await rm(testDir, { recursive: true, force: true });
});

describe.sequential("R2 Build 2 integrated 99-to-102 migration", () => {
  test("backfills legacy review evidence and links the next correction", async () => {
    const applied = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY "migration_name"'
    );
    expect(applied).toHaveLength(102);
    expect(applied.at(-1)?.migration_name).toBe(MEETING_INTELLIGENCE_MIGRATION);
    expect(applied.at(-2)?.migration_name).toBe(REPAIR_MIGRATION);
    expect(applied.at(-3)?.migration_name).toBe(BASE_RETENTION_MIGRATION);

    const before = await db.tradeResponseReviewDecision.findMany({ orderBy: { id: "asc" } });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      bidId: 1,
      responseRevisionId: 1,
      decision: "RETURNED_FOR_REVISION",
      commentary: LEGACY_COMMENTARY,
      reviewedBy: LEGACY_REVIEWER,
      correctionOfId: null,
    });
    expect(before[0].createdAt.toISOString()).toBe(LEGACY_REVIEWED_AT);

    const correction = await packages.reviewTradeResponse(
      1,
      1,
      1,
      1,
      { gcReview: "ACCEPTED_FOR_TRANSMITTAL", gcCommentary: "Post-upgrade correction detail" },
      { id: "post-upgrade-reviewer" }
    );
    expect(correction.ok).toBe(true);
    const after = await db.tradeResponseReviewDecision.findMany({ orderBy: { id: "asc" } });
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ commentary: LEGACY_COMMENTARY, correctionOfId: null });
    expect(after[1]).toMatchObject({
      decision: "ACCEPTED_FOR_TRANSMITTAL",
      commentary: "Post-upgrade correction detail",
      reviewedBy: "post-upgrade-reviewer",
      correctionOfId: after[0].id,
    });
  }, 30_000);

  test("models the inherited SET NULL FK and explicit retention-trigger ownership without drift", async () => {
    const foreignKeys = await db.$queryRawUnsafe<Array<{ table: string; from: string; on_delete: string }>>(
      'PRAGMA foreign_key_list("TrackedItem")'
    );
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      table: "Subcontractor",
      from: "responsibleContractorId",
      on_delete: "SET NULL",
    }));
    const triggers = await db.$queryRawUnsafe<Array<{ name: string; sql: string }>>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'R2B2_responsible_contractor_retention_guard'"
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].sql).toContain('BEFORE DELETE ON "Subcontractor"');
    expect(triggers[0].sql).toContain('"responsibleContractorId" = OLD."id"');

    const schema = await readFile(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    expect(schema).toMatch(/responsibleContractor\s+Subcontractor\?.*onDelete:\s*SetNull/);
    expect(schema).toContain("R2B2_responsible_contractor_retention_guard trigger owns");
    expect(await db.$queryRawUnsafe<Array<{ table: string }>>("PRAGMA foreign_key_check")).toEqual([]);
  });
});
