-- Module OPS5 — Design Log: meeting-extracted design intent changes.
-- Additive only: one new table. Forward-only; applied ONLY via
-- scripts/apply-turso-migrations.mjs by the operator (never auto-run,
-- never by a model). The schema stays dark to any image predating OPS5.

CREATE TABLE "DesignIntentChange" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "changeText" TEXT NOT NULL,
    "priorIntent" TEXT,
    "affectedSpec" TEXT,
    "severity" TEXT NOT NULL,
    "sourceQuote" TEXT,
    "speakerLabel" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PROPOSED',
    "extractedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedBy" TEXT,
    "dismissedReason" TEXT,
    "linkedTrackedItemId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignIntentChange_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignIntentChange_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignIntentChange_linkedTrackedItemId_fkey" FOREIGN KEY ("linkedTrackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "DesignIntentChange_bidId_state_idx" ON "DesignIntentChange"("bidId", "state");
CREATE INDEX "DesignIntentChange_meetingId_idx" ON "DesignIntentChange"("meetingId");
CREATE INDEX "DesignIntentChange_linkedTrackedItemId_idx" ON "DesignIntentChange"("linkedTrackedItemId");
