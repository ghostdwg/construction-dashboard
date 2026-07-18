// Disposable-path management for the R2 recovery certification harness.
//
// Everything the harness creates lives under os.tmpdir()/gwx-r2-cert/<runId>,
// entirely outside the repo working tree. Nothing here ever touches a
// staging/production URL, Turso, or any path the certification runner did
// not itself create — cleanup() only ever removes this one run directory.

import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CertRun {
  runId: string;
  root: string;
  dbDir: string;
  backupDir: string;
  resultDir: string;
}

export function createCertRun(label: string): CertRun {
  const root = mkdtempSync(join(tmpdir(), `gwx-r2-cert-${label}-`));
  const dbDir = join(root, "db");
  const backupDir = join(root, "backup");
  const resultDir = join(root, "result");
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  return { runId: root.split("/").pop() ?? root, root, dbDir, backupDir, resultDir };
}

export function cleanupCertRun(run: CertRun): void {
  rmSync(run.root, { recursive: true, force: true });
}

export function dbPath(run: CertRun, name: string): string {
  return join(run.dbDir, `${name}.db`);
}

export function backupPath(run: CertRun, name: string): string {
  return join(run.backupDir, `${name}.db.bak`);
}
