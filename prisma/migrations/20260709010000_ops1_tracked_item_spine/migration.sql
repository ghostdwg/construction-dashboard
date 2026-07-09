-- Module OPS1 (Slice 1) — Tracked Item register spine.
-- Additive only: three new tables + indexes. No existing table is altered,
-- no data is touched. Forward-only; applied ONLY via
-- scripts/apply-turso-migrations.mjs by the operator (never auto-run,
-- never by a model). Citation FKs use ON DELETE SET NULL so deleting source
-- evidence never destroys a tracked commitment; comments/attachments cascade
-- with their item; items cascade with their bid.

CREATE TABLE "TrackedItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assigneeName" TEXT,
    "assigneeEmail" TEXT,
    "projectContactId" INTEGER,
    "tradeId" INTEGER,
    "dueDate" DATETIME,
    "carriedFromDate" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "sourceMeetingId" INTEGER,
    "sourceMeetingActionItemId" INTEGER,
    "sourceSpecSectionId" INTEGER,
    "evidenceExcerpt" TEXT,
    "sourceLocator" TEXT,
    "extractionMethod" TEXT NOT NULL DEFAULT 'manual',
    "extractorVersion" TEXT,
    "citationVerified" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    "waivedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackedItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackedItem_projectContactId_fkey" FOREIGN KEY ("projectContactId") REFERENCES "ProjectContact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackedItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackedItem_sourceMeetingId_fkey" FOREIGN KEY ("sourceMeetingId") REFERENCES "Meeting" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackedItem_sourceMeetingActionItemId_fkey" FOREIGN KEY ("sourceMeetingActionItemId") REFERENCES "MeetingActionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackedItem_sourceSpecSectionId_fkey" FOREIGN KEY ("sourceSpecSectionId") REFERENCES "SpecSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TrackedItem_sourceMeetingActionItemId_key" ON "TrackedItem"("sourceMeetingActionItemId");
CREATE INDEX "TrackedItem_bidId_idx" ON "TrackedItem"("bidId");
CREATE INDEX "TrackedItem_bidId_kind_idx" ON "TrackedItem"("bidId", "kind");
CREATE INDEX "TrackedItem_bidId_status_idx" ON "TrackedItem"("bidId", "status");
CREATE INDEX "TrackedItem_dueDate_idx" ON "TrackedItem"("dueDate");

CREATE TABLE "TrackedItemComment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackedItemId" INTEGER NOT NULL,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedItemComment_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TrackedItemComment_trackedItemId_idx" ON "TrackedItemComment"("trackedItemId");

CREATE TABLE "TrackedItemAttachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackedItemId" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'photo',
    "caption" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedItemAttachment_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TrackedItemAttachment_trackedItemId_idx" ON "TrackedItemAttachment"("trackedItemId");
