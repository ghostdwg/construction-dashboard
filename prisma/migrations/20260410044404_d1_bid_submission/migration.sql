-- CreateTable
CREATE TABLE "BidSubmission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedBy" TEXT,
    "ourBidAmount" REAL,
    "notes" TEXT,
    "briefSnapshot" TEXT,
    "questionSnapshot" TEXT,
    "complianceSnapshot" TEXT,
    "spreadSnapshot" TEXT,
    "gateSnapshot" TEXT,
    "intelligenceSnapshot" TEXT,
    "outcome" TEXT,
    "outcomeAt" DATETIME,
    "winningBidAmount" REAL,
    "ourRank" INTEGER,
    "totalBidders" INTEGER,
    "lostReason" TEXT,
    "lostReasonNote" TEXT,
    "lessonsLearned" TEXT,
    "outcomeNotes" TEXT,
    CONSTRAINT "BidSubmission_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BidSubmission_bidId_key" ON "BidSubmission"("bidId");
