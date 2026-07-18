// Synthetic-data seeding for the R2 recovery certification harness.
//
// Every value written here is either a fixed literal or comes from
// tests/fixtures/r2-recovery-seed.json — never real project, customer, or
// sub data (Ledger core safety constraints). Timestamps are fixed literals,
// not wall-clock, so seeded rows hash identically across separate
// certification runs (required for the deterministic-evidence scenario).
//
// Column lists are written explicitly and only include columns that exist
// in every migration state this harness seeds into (baseline = through
// migration 98; response-package-era = after migration 99). Newer additive
// columns are simply omitted from the INSERT and take their schema default
// or NULL — the same INSERT text is valid before and after migrations
// 99-101 apply.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { openLocal, checkpointAndClose } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, "..", "..", "..", "tests", "fixtures", "r2-recovery-seed.json");
const SEED = JSON.parse(readFileSync(SEED_PATH, "utf8"));

const TS = SEED.fixedTimestamp as string;

export interface BaselineIds {
  tradeId: number;
  subcontractorId: number;
  bidId: number;
  meetingId: number;
  registerEntryId: number;
  trackedItemId: number;
  trackedItemAttachmentId: number;
  backgroundJobId: string;
  auditEventId: string;
}

// Seeds a synthetic entity graph valid at any migration state from #98
// onward (no reference to columns/tables added by migrations 99-101).
export async function seedBaseline(dbPath: string): Promise<BaselineIds> {
  const client = openLocal(dbPath);
  const b = SEED.baseline;

  const trade = await client.execute({
    sql: `INSERT INTO "Trade" ("name", "isActive", "createdAt") VALUES (?, 1, ?) RETURNING "id"`,
    args: [b.trade.name, TS],
  });
  const tradeId = Number(trade.rows[0].id);

  const sub = await client.execute({
    sql: `INSERT INTO "Subcontractor" ("company", "status", "isUnion", "isMWBE", "createdAt", "updatedAt", "tier", "projectTypes", "doNotUse", "isPreferred")
          VALUES (?, 'active', 0, 0, ?, ?, 'new', '', 0, 0) RETURNING "id"`,
    args: [b.subcontractor.company, TS, TS],
  });
  const subcontractorId = Number(sub.rows[0].id);

  const bid = await client.execute({
    sql: `INSERT INTO "Bid" ("projectName", "scope", "status", "workflowType", "projectType", "createdAt", "updatedAt")
          VALUES (?, ?, 'draft', 'BID', 'PRIVATE', ?, ?) RETURNING "id"`,
    args: [b.bid.projectName, b.bid.scope, TS, TS],
  });
  const bidId = Number(bid.rows[0].id);

  const meeting = await client.execute({
    sql: `INSERT INTO "Meeting" ("bidId", "title", "meetingDate", "meetingType", "status", "createdAt", "updatedAt")
          VALUES (?, ?, ?, 'GENERAL', 'PENDING', ?, ?) RETURNING "id"`,
    args: [bidId, b.meeting.title, b.meeting.meetingDate, TS, TS],
  });
  const meetingId = Number(meeting.rows[0].id);

  const registerEntry = await client.execute({
    sql: `INSERT INTO "MeetingRegisterEntry"
          ("meetingId", "bidId", "entryType", "rawSourceText", "normalizedText", "origin", "reviewState", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?) RETURNING "id"`,
    args: [
      meetingId,
      bidId,
      b.registerEntry.entryType,
      b.registerEntry.rawSourceText,
      b.registerEntry.normalizedText,
      b.registerEntry.origin,
      TS,
      TS,
    ],
  });
  const registerEntryId = Number(registerEntry.rows[0].id);

  await client.execute({
    sql: `INSERT INTO "MeetingRegisterEntryRevision" ("entryId", "bidId", "changeType", "actor", "createdAt")
          VALUES (?, ?, ?, ?, ?)`,
    args: [registerEntryId, bidId, b.registerEntryRevision.changeType, b.registerEntryRevision.actor, TS],
  });

  await client.execute({
    sql: `INSERT INTO "MeetingCommitment" ("meetingId", "bidId", "committedBy", "commitmentText", "status", "extractedAt", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, 'PROPOSED', ?, ?, ?)`,
    args: [meetingId, bidId, b.commitment.committedBy, b.commitment.commitmentText, TS, TS, TS],
  });

  const trackedItem = await client.execute({
    sql: `INSERT INTO "TrackedItem" ("bidId", "kind", "title", "status", "priority", "createdAt", "updatedAt")
          VALUES (?, ?, ?, 'OPEN', 'MEDIUM', ?, ?) RETURNING "id"`,
    args: [bidId, b.trackedItem.kind, b.trackedItem.title, TS, TS],
  });
  const trackedItemId = Number(trackedItem.rows[0].id);

  const attachment = await client.execute({
    sql: `INSERT INTO "TrackedItemAttachment" ("trackedItemId", "storageKey", "fileName", "mimeType", "byteSize", "createdAt")
          VALUES (?, ?, ?, ?, ?, ?) RETURNING "id"`,
    args: [
      trackedItemId,
      b.trackedItemAttachment.storageKey,
      b.trackedItemAttachment.fileName,
      b.trackedItemAttachment.mimeType,
      b.trackedItemAttachment.byteSize,
      TS,
    ],
  });
  const trackedItemAttachmentId = Number(attachment.rows[0].id);

  const backgroundJobId = `cert_${randomUUID()}`;
  await client.execute({
    sql: `INSERT INTO "BackgroundJob" ("id", "jobType", "bidId", "status", "createdAt", "completedAt", "activeSlot")
          VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [backgroundJobId, b.backgroundJob.jobType, bidId, b.backgroundJob.status, TS, TS],
  });

  const auditEventId = `cert_${randomUUID()}`;
  await client.execute({
    sql: `INSERT INTO "AuditEvent" ("id", "category", "action", "decision", "emittedAt") VALUES (?, ?, ?, ?, ?)`,
    args: [auditEventId, b.auditEvent.category, b.auditEvent.action, b.auditEvent.decision, TS],
  });

  await checkpointAndClose(client);

  return {
    tradeId,
    subcontractorId,
    bidId,
    meetingId,
    registerEntryId,
    trackedItemId,
    trackedItemAttachmentId,
    backgroundJobId,
    auditEventId,
  };
}

export interface ResponsePackageIds {
  responsePackageId: number;
  responsePackageItemId: number;
  tradeResponseRevisionId: number;
  tradeResponseAttachmentId: number;
  responseAccessTokenId: string;
}

// Seeds response-package-era rows. Only valid once migration
// 20260718010000_r2b2_trade_response_packages (index 99) has been applied
// — the tables referenced here do not exist before it.
export async function seedResponsePackageEra(dbPath: string, base: BaselineIds): Promise<ResponsePackageIds> {
  const client = openLocal(dbPath);
  const r = SEED.responsePackageEra;

  const pkg = await client.execute({
    sql: `INSERT INTO "ResponsePackage" ("bidId", "packageNumber", "title", "contractorId", "status", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, 'DRAFT', ?, ?) RETURNING "id"`,
    args: [base.bidId, r.responsePackage.packageNumber, r.responsePackage.title, base.subcontractorId, TS, TS],
  });
  const responsePackageId = Number(pkg.rows[0].id);

  const item = await client.execute({
    sql: `INSERT INTO "ResponsePackageItem" ("packageId", "bidId", "trackedItemId") VALUES (?, ?, ?) RETURNING "id"`,
    args: [responsePackageId, base.bidId, base.trackedItemId],
  });
  const responsePackageItemId = Number(item.rows[0].id);

  const revision = await client.execute({
    sql: `INSERT INTO "TradeResponseRevision"
          ("bidId", "packageItemId", "responderName", "responderCompany", "responseType", "responseText",
           "submittedAt", "gcReview", "gcReviewBy", "gcReviewAt", "gcCommentary")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id"`,
    args: [
      base.bidId,
      responsePackageItemId,
      r.tradeResponseRevision.responderName,
      r.tradeResponseRevision.responderCompany,
      r.tradeResponseRevision.responseType,
      r.tradeResponseRevision.responseText,
      TS,
      r.tradeResponseRevision.gcReview,
      r.tradeResponseRevision.gcReviewBy,
      r.tradeResponseRevision.gcReviewAt,
      r.tradeResponseRevision.gcCommentary,
    ],
  });
  const tradeResponseRevisionId = Number(revision.rows[0].id);

  const attachment = await client.execute({
    sql: `INSERT INTO "TradeResponseAttachment"
          ("responseRevisionId", "bidId", "storageKey", "fileName", "mimeType", "byteSize", "createdAt")
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING "id"`,
    args: [
      tradeResponseRevisionId,
      base.bidId,
      r.tradeResponseAttachment.storageKey,
      r.tradeResponseAttachment.fileName,
      r.tradeResponseAttachment.mimeType,
      r.tradeResponseAttachment.byteSize,
      TS,
    ],
  });
  const tradeResponseAttachmentId = Number(attachment.rows[0].id);

  const responseAccessTokenId = `cert_${randomUUID()}`;
  await client.execute({
    sql: `INSERT INTO "ResponseAccessToken" ("id", "bidId", "packageId", "tokenHash", "expiresAt", "createdBy", "createdAt")
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      responseAccessTokenId,
      base.bidId,
      responsePackageId,
      r.responseAccessToken.tokenHash,
      r.responseAccessToken.expiresAt,
      r.responseAccessToken.createdBy,
      TS,
    ],
  });

  await checkpointAndClose(client);

  return { responsePackageId, responsePackageItemId, tradeResponseRevisionId, tradeResponseAttachmentId, responseAccessTokenId };
}
