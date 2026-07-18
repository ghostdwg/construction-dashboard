// Local-only vitest coverage for scripts/certification/lib/backup.ts.
// Disposable os.tmpdir() SQLite files only.

import { readFileSync, writeFileSync, truncateSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createCertRun, cleanupCertRun, dbPath, backupPath, type CertRun } from "../../scripts/certification/lib/paths";
import { applyMigrations, listMigrations } from "../../scripts/certification/lib/migrator";
import { createBackup, restoreBackup, verifyRestoredIntegrity } from "../../scripts/certification/lib/backup";
import { sha256File } from "../../scripts/certification/lib/db";

let run: CertRun;

beforeEach(() => {
  run = createCertRun("backup-test");
});

afterEach(() => {
  cleanupCertRun(run);
});

async function seededDb(run: CertRun, name: string): Promise<string> {
  const db = dbPath(run, name);
  await applyMigrations(db, { limit: 10 });
  return db;
}

describe("createBackup / restoreBackup happy path", () => {
  test("backup checksum matches recomputed file checksum", async () => {
    const db = await seededDb(run, "src");
    const backup = backupPath(run, "b1");
    const manifest = await createBackup(db, backup);
    expect(manifest.checksum).toBe(sha256File(backup));
  });

  test("restore into a second disposable database succeeds and round-trips migration state", async () => {
    const db = await seededDb(run, "src");
    const backup = backupPath(run, "b1");
    const manifest = await createBackup(db, backup);
    const target = dbPath(run, "restored");
    const res = restoreBackup(backup, target);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      const check = verifyRestoredIntegrity(target, manifest);
      expect(check.ok).toBe(true);
    }
  });
});

describe("restore refusals", () => {
  test("refuses a corrupted backup (checksum mismatch) and does not write the target", async () => {
    const db = await seededDb(run, "src");
    const backup = backupPath(run, "b1");
    await createBackup(db, backup);

    const buf = readFileSync(backup);
    buf[10] ^= 0xff;
    writeFileSync(backup, buf);

    const target = dbPath(run, "from-corrupt");
    const res = restoreBackup(backup, target);
    expect(res.status).toBe("refused");
    if (res.status === "refused") expect(res.reason).toBe("checksum-mismatch");
  });

  test("refuses a restore whose backup schema version does not match the caller's expectation", async () => {
    const db = await seededDb(run, "src");
    const backup = backupPath(run, "b1");
    const manifest = await createBackup(db, backup);
    const target = dbPath(run, "wrong-schema");
    const all = listMigrations();
    const res = restoreBackup(backup, target, { expectedSchemaVersion: all[all.length - 1] });
    expect(res.status).toBe("refused");
    if (res.status === "refused") expect(res.reason).toBe("schema-version-mismatch");
    expect(manifest.lastMigration).not.toBe(all[all.length - 1]);
  });

  test("detects a partial/corrupted restore after the fact", async () => {
    const db = await seededDb(run, "src");
    const backup = backupPath(run, "b1");
    const manifest = await createBackup(db, backup);
    const target = dbPath(run, "restored");
    restoreBackup(backup, target);
    truncateSync(target, Math.floor(manifest.byteSize / 2));
    const check = verifyRestoredIntegrity(target, manifest);
    expect(check.ok).toBe(false);
  });
});
