// Local-only vitest coverage for scripts/certification/lib/migrator.ts.
// Every database here is a disposable os.tmpdir() SQLite file created and
// destroyed within this test file — never a real DB, never Turso.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createCertRun, cleanupCertRun, dbPath, type CertRun } from "../../scripts/certification/lib/paths";
import { listMigrations, applyMigrations, auditMigrationState, simulate } from "../../scripts/certification/lib/migrator";

let run: CertRun;

beforeEach(() => {
  run = createCertRun("migrator-test");
});

afterEach(() => {
  cleanupCertRun(run);
});

describe("listMigrations", () => {
  test("returns a non-empty, lexicographically sorted list", () => {
    const all = listMigrations();
    expect(all.length).toBeGreaterThan(0);
    expect(all).toEqual([...all].sort());
  });
});

describe("applyMigrations", () => {
  test("applies the full chain to a fresh database", async () => {
    const db = dbPath(run, "fresh");
    const all = listMigrations();
    const result = await applyMigrations(db);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.appliedNow.length).toBe(all.length);
      expect(result.appliedCount).toBe(all.length);
    }
  });

  test("a repeated call applies zero pending migrations", async () => {
    const db = dbPath(run, "fresh");
    await applyMigrations(db);
    const repeat = await applyMigrations(db);
    expect(repeat.status).toBe("ok");
    if (repeat.status === "ok") expect(repeat.appliedNow.length).toBe(0);
  });

  test("limit applies an exact prefix of the chain", async () => {
    const db = dbPath(run, "partial");
    const result = await applyMigrations(db, { limit: 5 });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.appliedNow.length).toBe(5);
    const audit = await auditMigrationState(db);
    expect(audit.appliedCount).toBe(5);
  });

  test("refuses to proceed when a prior migration is left partial (interrupted-migration detection)", async () => {
    const db = dbPath(run, "interrupted");
    const all = listMigrations();
    await applyMigrations(db, { limit: 3 });
    await simulate.markPartial(db, all[3]);
    const blocked = await applyMigrations(db);
    expect(blocked.status).toBe("blocked-partial");
    const audit = await auditMigrationState(db);
    expect(audit.partial).toContain(all[3]);
  });
});

describe("auditMigrationState anomaly detection", () => {
  test("detects a missing migration (gap before the latest applied name)", async () => {
    const db = dbPath(run, "missing");
    const all = listMigrations();
    await applyMigrations(db, { limit: 10 });
    await simulate.deleteAppliedRecord(db, all[5]);
    const audit = await auditMigrationState(db);
    expect(audit.missing).toContain(all[5]);
  });

  test("detects an unknown future migration not present on disk", async () => {
    const db = dbPath(run, "unknown");
    await applyMigrations(db, { limit: 5 });
    const injected = await simulate.injectUnknownFuture(db);
    const audit = await auditMigrationState(db);
    expect(audit.unknown).toContain(injected);
  });

  test("a clean fully-applied database has no anomalies", async () => {
    const db = dbPath(run, "clean");
    const all = listMigrations();
    await applyMigrations(db);
    const audit = await auditMigrationState(db);
    expect(audit.partial).toEqual([]);
    expect(audit.missing).toEqual([]);
    expect(audit.unknown).toEqual([]);
    expect(audit.appliedCount).toBe(all.length);
  });
});
