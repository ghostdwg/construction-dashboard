// Local-only vitest coverage for scripts/certification/lib/fixtures.ts and
// integrity.ts. Disposable os.tmpdir() SQLite files only; all seeded values
// are synthetic (see tests/fixtures/r2-recovery-seed.json).

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createCertRun, cleanupCertRun, dbPath, type CertRun } from "../../scripts/certification/lib/paths";
import { applyMigrations, listMigrations } from "../../scripts/certification/lib/migrator";
import { seedBaseline, seedResponsePackageEra } from "../../scripts/certification/lib/fixtures";
import { tableRowCounts, foreignKeyCheck, integrityCheckOk, contentDigest, listTables } from "../../scripts/certification/lib/integrity";

let run: CertRun;

beforeEach(() => {
  run = createCertRun("fixtures-test");
});

afterEach(() => {
  cleanupCertRun(run);
});

describe("seedBaseline", () => {
  test("seeds a valid synthetic entity graph at the pre-99 schema state", async () => {
    const all = listMigrations();
    const db = dbPath(run, "baseline");
    await applyMigrations(db, { limit: all.length - 3 });
    const ids = await seedBaseline(db);
    expect(ids.bidId).toBeGreaterThan(0);
    expect(ids.trackedItemId).toBeGreaterThan(0);

    const counts = await tableRowCounts(db, ["Bid", "Meeting", "MeetingRegisterEntry", "TrackedItem", "AuditEvent", "BackgroundJob"]);
    for (const n of Object.values(counts)) expect(n).toBe(1);

    const violations = await foreignKeyCheck(db);
    expect(violations).toEqual([]);
    expect(await integrityCheckOk(db)).toBe(true);
  });
});

describe("seedResponsePackageEra", () => {
  test("seeds a full response-package chain once migration 99 is applied", async () => {
    const all = listMigrations();
    const db = dbPath(run, "response-era");
    await applyMigrations(db, { limit: all.length - 3 });
    const base = await seedBaseline(db);
    await applyMigrations(db, { limit: 1 }); // migration 99 creates the tables
    const rp = await seedResponsePackageEra(db, base);
    expect(rp.responsePackageId).toBeGreaterThan(0);

    const counts = await tableRowCounts(db, [
      "ResponsePackage",
      "ResponsePackageItem",
      "TradeResponseRevision",
      "TradeResponseAttachment",
      "ResponseAccessToken",
    ]);
    for (const n of Object.values(counts)) expect(n).toBe(1);
    expect(await foreignKeyCheck(db)).toEqual([]);
  });
});

describe("contentDigest determinism", () => {
  test("identical fixed-timestamp seed data produces identical digests across independent databases", async () => {
    const all = listMigrations();
    const dbA = dbPath(run, "digest-a");
    const dbB = dbPath(run, "digest-b");
    await applyMigrations(dbA, { limit: all.length - 3 });
    await applyMigrations(dbB, { limit: all.length - 3 });
    await seedBaseline(dbA);
    await seedBaseline(dbB);

    const cols = ["id", "bidId", "kind", "title", "status"];
    const digestA = await contentDigest(dbA, "TrackedItem", cols);
    const digestB = await contentDigest(dbB, "TrackedItem", cols);
    expect(digestA).toBe(digestB);
  }, 20000);
});

describe("listTables", () => {
  test("enumerates real product tables, excluding sqlite internals and migration bookkeeping", async () => {
    const db = dbPath(run, "tables");
    await applyMigrations(db, { limit: 10 });
    const tables = await listTables(db);
    expect(tables).toContain("Bid");
    expect(tables).not.toContain("_prisma_migrations");
    expect(tables.some((t) => t.startsWith("sqlite_"))).toBe(false);
  });
});
