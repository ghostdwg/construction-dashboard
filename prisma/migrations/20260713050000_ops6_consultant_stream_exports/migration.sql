-- Module OPS6 (Phase 2) — consultant-stream PDF export records.
-- Additive only: one new table. Forward-only; applied ONLY via
-- scripts/apply-turso-migrations.mjs by the operator (never auto-run,
-- never by a model). Rows are immutable by design — no update path
-- exists in the application; a stale export is superseded by a new one.

CREATE TABLE "ConsultantStreamExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidId" INTEGER NOT NULL,
    "storedKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "observationCount" INTEGER NOT NULL,
    "filtersJson" TEXT NOT NULL,
    "generatedBy" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsultantStreamExport_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ConsultantStreamExport_bidId_generatedAt_idx" ON "ConsultantStreamExport"("bidId", "generatedAt");
