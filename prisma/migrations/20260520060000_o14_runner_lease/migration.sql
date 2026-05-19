-- Phase O1.4 — RunnerLease (cycle-coordination primitive).
--
-- Operational infrastructure for recurring MI runners (forecast, calibration,
-- briefing, alert-eval, outcome-detect, backfill). Distinct from
-- BackgroundJob (per-bid) — RunnerLease is platform-wide, one row per
-- (cycleName, windowKey).
--
-- Provides at-most-once execution per window via UNIQUE constraint on
-- windowKey; heartbeat extension for long-running cycles; stale-run
-- detection for unfinished claims.
--
-- The AuditEvent table (O1.2) carries long-lived runner_cycle history;
-- this table is hot-path coordination + last-N-cycles status.

-- CreateTable
CREATE TABLE "RunnerLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleName" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "leaseToken" TEXT NOT NULL,
    "leasedBy" TEXT NOT NULL,
    "leasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" DATETIME NOT NULL,
    "lastHeartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "runnerId" TEXT,
    "replayId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "RunnerLease_windowKey_key" ON "RunnerLease"("windowKey");

-- CreateIndex
CREATE INDEX "RunnerLease_cycleName_leasedAt_idx" ON "RunnerLease"("cycleName", "leasedAt");

-- CreateIndex
CREATE INDEX "RunnerLease_status_idx" ON "RunnerLease"("status");

-- CreateIndex
CREATE INDEX "RunnerLease_leaseExpiresAt_idx" ON "RunnerLease"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "RunnerLease_runnerId_idx" ON "RunnerLease"("runnerId");
