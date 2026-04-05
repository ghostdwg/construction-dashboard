-- CreateTable
CREATE TABLE "AiExportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "exportedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "restrictedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'complete',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiExportBatch_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiGapFinding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "aiExportBatchId" INTEGER NOT NULL,
    "tradeName" TEXT,
    "findingText" TEXT NOT NULL,
    "confidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "reviewNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiGapFinding_aiExportBatchId_fkey" FOREIGN KEY ("aiExportBatchId") REFERENCES "AiExportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gapFindingId" INTEGER,
    "tradeName" TEXT,
    "questionText" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedAt" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedQuestion_gapFindingId_fkey" FOREIGN KEY ("gapFindingId") REFERENCES "AiGapFinding" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
