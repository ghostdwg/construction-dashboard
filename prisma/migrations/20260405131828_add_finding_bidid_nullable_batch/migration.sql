/*
  Warnings:

  - Added the required column `bidId` to the `AiGapFinding` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiGapFinding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "aiExportBatchId" INTEGER,
    "tradeName" TEXT,
    "findingText" TEXT NOT NULL,
    "confidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "reviewNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiGapFinding_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGapFinding_aiExportBatchId_fkey" FOREIGN KEY ("aiExportBatchId") REFERENCES "AiExportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AiGapFinding" ("aiExportBatchId", "confidence", "createdAt", "findingText", "id", "reviewNotes", "status", "tradeName") SELECT "aiExportBatchId", "confidence", "createdAt", "findingText", "id", "reviewNotes", "status", "tradeName" FROM "AiGapFinding";
DROP TABLE "AiGapFinding";
ALTER TABLE "new_AiGapFinding" RENAME TO "AiGapFinding";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
