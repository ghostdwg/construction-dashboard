// Local-only test helpers for the R2 pragma-repair regression suite.
//
// Every database here is a disposable file under os.tmpdir(), created and
// destroyed within a single test. Never a real DB, never Turso, never a
// DATABASE_URL, no network, no credentials. Mirrors the pattern already
// established by scripts/certification/lib/db.ts on the sibling
// gwx-r2-recovery-certification worktree.

import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TmpDb {
  client: Client;
  dir: string;
  dbPath: string;
}

export function openTmpDb(prefix: string): TmpDb {
  const dir = mkdtempSync(join(tmpdir(), `gwx-pragma-repair-${prefix}-`));
  const dbPath = join(dir, "db.sqlite");
  const client = createClient({ url: `file:${dbPath}` });
  return { client, dir, dbPath };
}

export function cleanupTmpDb(db: TmpDb): void {
  try {
    db.client.close();
  } catch {
    // already closed
  }
  rmSync(db.dir, { recursive: true, force: true });
}

// Minimal valid Bid/Subcontractor/Trade/TrackedItem parent rows plus one
// full ResponsePackage-family chain (ResponsePackage -> ResponsePackageItem
// -> TradeResponseRevision -> TradeResponseAttachment, plus a sibling
// ResponseAccessToken), all with autoincrement id=1 since each is the first
// row inserted into a freshly-migrated (pre-101) schema. Values are
// synthetic-only ([TEST]-prefixed), matching migration 20260718030000's own
// shape so its create-copy-drop-rename rebuild has real rows to carry
// through. Reproduces exactly the scenario the R2 recovery certification
// harness used to find the underlying pragma defect (seeding before the
// rebuild is what makes the FK-enforcement-never-actually-off bug visible —
// it is a no-op against empty tables).
const TEST_TIMESTAMP = "2026-07-01T00:00:00.000Z";

export async function seedResponsePackageChain(client: Client): Promise<void> {
  // Bid/TrackedItem/ResponsePackage all carry a Prisma `@updatedAt` column
  // that is application-managed (no SQL-level DEFAULT), so it must be
  // supplied explicitly on every insert.
  await client.execute(
    `INSERT INTO "Bid" ("projectName", "updatedAt") VALUES ('[TEST] Pragma Repair Bid', '${TEST_TIMESTAMP}')`
  );
  await client.execute(
    `INSERT INTO "Subcontractor" ("company", "updatedAt") VALUES ('[TEST] Sub Co', '${TEST_TIMESTAMP}')`
  );
  await client.execute(`INSERT INTO "Trade" ("name") VALUES ('[TEST] Trade')`);
  await client.execute(
    `INSERT INTO "TrackedItem" ("bidId", "kind", "title", "updatedAt")
     VALUES (1, 'FIELD_ITEM', '[TEST] Item', '${TEST_TIMESTAMP}')`
  );
  await client.execute(
    `INSERT INTO "ResponsePackage" ("bidId", "packageNumber", "title", "contractorId", "updatedAt")
     VALUES (1, 1, '[TEST] Package', 1, '${TEST_TIMESTAMP}')`
  );
  await client.execute(
    `INSERT INTO "ResponsePackageItem" ("packageId", "bidId", "trackedItemId")
     VALUES (1, 1, 1)`
  );
  await client.execute(
    `INSERT INTO "TradeResponseRevision"
       ("bidId", "packageItemId", "responderName", "responseType", "responseText", "gcReview", "gcReviewBy")
     VALUES (1, 1, '[TEST] Responder', 'SUBMITTAL', '[TEST] response text', 'APPROVED', '[TEST] reviewer')`
  );
  await client.execute(
    `INSERT INTO "TradeResponseAttachment"
       ("responseRevisionId", "bidId", "storageKey", "fileName", "mimeType", "byteSize")
     VALUES (1, 1, '[TEST]/key.pdf', 'key.pdf', 'application/pdf', 100)`
  );
  await client.execute(
    `INSERT INTO "ResponseAccessToken"
       ("id", "bidId", "packageId", "tokenHash", "expiresAt", "createdBy")
     VALUES ('[TEST]-token-1', 1, 1, '[TEST]-hash', '2099-01-01T00:00:00.000Z', '[TEST]-user')`
  );
}

// Minimal populated Meeting + MeetingParticipant pair, for the same reason
// as seedResponsePackageChain but targeting migration 20260718024444's
// Meeting-family table rebuild (READ FIRST called out migration 100 as
// worth checking too, since it performs the same PRAGMA-guarded rebuild
// pattern on already-populated data). Requires a Bid row to already exist
// at the given id (callers seed one first, e.g. via seedResponsePackageChain).
export async function seedMeetingParticipant(client: Client, bidId = 1): Promise<void> {
  await client.execute({
    sql: `INSERT INTO "Meeting" ("bidId", "title", "meetingDate", "updatedAt")
          VALUES (?, '[TEST] Meeting', '${TEST_TIMESTAMP}', '${TEST_TIMESTAMP}')`,
    args: [bidId],
  });
  await client.execute(
    `INSERT INTO "MeetingParticipant" ("meetingId", "name") VALUES (1, '[TEST] Participant')`
  );
}
