CREATE TABLE "BidDecision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT,
    "madeBy" TEXT,
    "madeAt" DATETIME,
    "impact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BidDecision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BidDecision_bidId_idx" ON "BidDecision"("bidId");
