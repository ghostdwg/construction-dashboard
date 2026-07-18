// Local-only SQLite helpers for the R2 recovery certification harness.
//
// Every client here is opened against a `file:` URL under a disposable
// os.tmpdir() directory (see paths.ts) — never libsql://, never a tier
// DATABASE_URL, never Turso. This intentionally does NOT reuse
// scripts/apply-turso-migrations.mjs: that script is the human-only,
// tier-fenced Turso runner (Ledger §4.7/§4.11) and has top-level
// APP_ENV-gated side effects that make it unsafe to import as a library.
// The migration-application logic here is a from-scratch local twin scoped
// to disposable SQLite files only.

import { createClient, type Client } from "@libsql/client";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export function openLocal(dbPath: string): Client {
  return createClient({ url: `file:${dbPath}` });
}

// SQLite files opened by @libsql/client default to WAL mode. Checkpointing
// before copy/read-outside-the-client ensures the on-disk main file holds
// the complete, consistent state (no dangling -wal/-shm content).
export async function checkpointAndClose(client: Client): Promise<void> {
  try {
    await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Not in WAL mode, or nothing to checkpoint — fine.
  }
  client.close();
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function fileSize(path: string): number {
  return statSync(path).size;
}
