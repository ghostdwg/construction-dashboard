// Local-only backup/restore for the R2 recovery certification harness.
//
// "Backup" = checkpoint the WAL, copy the disposable SQLite file's bytes,
// and record a manifest (checksum, byte size, schema version). "Restore" =
// verify the manifest checksum against the backup file, verify the schema
// version if the caller expects one, copy to a temp path, re-verify the
// copy's checksum, then atomically rename into place. Any verification
// failure refuses before touching the target path.

import { copyFileSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { openLocal, checkpointAndClose, sha256File, fileSize } from "./db";
import { auditMigrationState } from "./migrator";

export interface BackupManifest {
  sourceDb: string;
  backupPath: string;
  checksum: string;
  byteSize: number;
  appliedMigrationCount: number;
  lastMigration: string | null;
  createdAt: string;
}

export async function createBackup(dbPath: string, backupPath: string): Promise<BackupManifest> {
  const client = openLocal(dbPath);
  await checkpointAndClose(client);
  copyFileSync(dbPath, backupPath);

  const audit = await auditMigrationState(dbPath);
  const lastMigration = audit.appliedNames.length > 0 ? [...audit.appliedNames].sort().at(-1)! : null;

  const manifest: BackupManifest = {
    sourceDb: dbPath,
    backupPath,
    checksum: sha256File(backupPath),
    byteSize: fileSize(backupPath),
    appliedMigrationCount: audit.appliedCount,
    lastMigration,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(`${backupPath}.manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readManifest(backupPath: string): BackupManifest {
  return JSON.parse(readFileSync(`${backupPath}.manifest.json`, "utf8"));
}

export type RestoreResult =
  | { status: "ok"; targetDbPath: string; manifest: BackupManifest }
  | { status: "refused"; reason: "checksum-mismatch" | "schema-version-mismatch" | "backup-missing"; detail: string };

export function restoreBackup(
  backupPath: string,
  targetDbPath: string,
  opts: { expectedSchemaVersion?: string } = {}
): RestoreResult {
  if (!existsSync(backupPath)) {
    return { status: "refused", reason: "backup-missing", detail: backupPath };
  }
  const manifest = readManifest(backupPath);

  const actualChecksum = sha256File(backupPath);
  if (actualChecksum !== manifest.checksum) {
    return {
      status: "refused",
      reason: "checksum-mismatch",
      detail: `manifest expects ${manifest.checksum}, backup file is ${actualChecksum}`,
    };
  }

  if (opts.expectedSchemaVersion && manifest.lastMigration !== opts.expectedSchemaVersion) {
    return {
      status: "refused",
      reason: "schema-version-mismatch",
      detail: `expected schema at ${opts.expectedSchemaVersion}, backup is at ${manifest.lastMigration ?? "(empty)"}`,
    };
  }

  const tmpTarget = `${targetDbPath}.restoring`;
  copyFileSync(backupPath, tmpTarget);
  const copiedChecksum = sha256File(tmpTarget);
  if (copiedChecksum !== manifest.checksum) {
    rmSync(tmpTarget, { force: true });
    return {
      status: "refused",
      reason: "checksum-mismatch",
      detail: `post-copy checksum ${copiedChecksum} does not match manifest ${manifest.checksum}`,
    };
  }
  renameSync(tmpTarget, targetDbPath);
  return { status: "ok", targetDbPath, manifest };
}

// Detects a partial/corrupted restore result: recomputes the checksum of an
// already-restored file against the manifest it claims to be a restore of.
// Used both right after a real restore and to simulate detection of a
// file that was truncated/corrupted after restore completed.
export function verifyRestoredIntegrity(
  targetDbPath: string,
  manifest: BackupManifest
): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(targetDbPath)) return { ok: false, reason: "target missing" };
  const actual = sha256File(targetDbPath);
  if (actual !== manifest.checksum) {
    return { ok: false, reason: `checksum mismatch: expected ${manifest.checksum}, got ${actual}` };
  }
  if (fileSize(targetDbPath) !== manifest.byteSize) {
    return { ok: false, reason: `byte size mismatch: expected ${manifest.byteSize}, got ${fileSize(targetDbPath)}` };
  }
  return { ok: true };
}
