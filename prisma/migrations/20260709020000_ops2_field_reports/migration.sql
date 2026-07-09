-- Module OPS2 (Slice 2) — Field Report source documents.
-- Additive only: one new table + one nullable column on TrackedItem.
-- Forward-only; applied ONLY via scripts/apply-turso-migrations.mjs by the
-- operator (never auto-run, never by a model). The TrackedItem citation FK
-- is SET NULL so deleting a report never destroys the tracked items that
-- cited it (their denormalized evidence survives).

CREATE TABLE "FieldReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "reportDate" DATETIME,
    "authorName" TEXT,
    "sourceFileStorageKey" TEXT,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "parseStatus" TEXT NOT NULL DEFAULT 'UNPARSED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FieldReport_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FieldReport_bidId_idx" ON "FieldReport"("bidId");
CREATE INDEX "FieldReport_bidId_reportDate_idx" ON "FieldReport"("bidId", "reportDate");

ALTER TABLE "TrackedItem" ADD COLUMN "sourceFieldReportId" INTEGER
    REFERENCES "FieldReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
