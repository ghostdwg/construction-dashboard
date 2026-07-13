-- Module OPS4 (Phase 1B) — consultant disposition log + spawn FK + PM flag.
-- Additive only: one new append-only table + one nullable FK column on
-- ConsultantObservation + one defaulted boolean on TrackedItem.
-- Forward-only; applied ONLY via scripts/apply-turso-migrations.mjs by the
-- operator (never auto-run, never by a model). SQLite ADD COLUMN with a
-- constant default does not rewrite existing rows — the schema stays dark
-- to any image that predates Phase 1B.

CREATE TABLE "ConsultantDispositionRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "observationId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "dispositionType" TEXT NOT NULL,
    "dispositionText" TEXT,
    "disposedBy" TEXT NOT NULL,
    "disposedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsultantDispositionRecord_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ConsultantObservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsultantDispositionRecord_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ConsultantDispositionRecord_observationId_disposedAt_idx" ON "ConsultantDispositionRecord"("observationId", "disposedAt");
CREATE INDEX "ConsultantDispositionRecord_bidId_idx" ON "ConsultantDispositionRecord"("bidId");

ALTER TABLE "ConsultantObservation" ADD COLUMN "spawnedItemId" INTEGER
    REFERENCES "TrackedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrackedItem" ADD COLUMN "pmReviewRequired" BOOLEAN NOT NULL DEFAULT false;
