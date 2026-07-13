-- Migration: 20260713030000_quick_push_run
-- Additive only. Forward-only (no down migration).
-- Applied ONLY via scripts/apply-turso-migrations.mjs — never auto-run.
-- Never apply against staging/production without an approved queue card.

CREATE TABLE "QuickPushRun" (
  "id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId"       INTEGER NOT NULL,
  "status"      TEXT    NOT NULL DEFAULT 'running',
  "currentStep" TEXT,
  "stepResults" TEXT,
  "startedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  "error"       TEXT,
  CONSTRAINT "QuickPushRun_bidId_fkey"
    FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "QuickPushRun_bidId_idx" ON "QuickPushRun"("bidId");
CREATE INDEX "QuickPushRun_bidId_status_idx" ON "QuickPushRun"("bidId", "status");
