-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EstimateUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "subcontractorId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "rawFilePath" TEXT NOT NULL,
    "scopeLines" TEXT NOT NULL DEFAULT '',
    "pricingData" TEXT NOT NULL DEFAULT '',
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseError" TEXT,
    "sanitizedText" TEXT,
    "sanitizationStatus" TEXT,
    "redactionCount" INTEGER,
    "flaggedLines" TEXT,
    "subToken" TEXT,
    "approvedForAi" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EstimateUpload_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EstimateUpload_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EstimateUpload" ("bidId", "fileName", "fileSize", "fileType", "id", "parseError", "parseStatus", "pricingData", "rawFilePath", "scopeLines", "subcontractorId", "updatedAt", "uploadedAt") SELECT "bidId", "fileName", "fileSize", "fileType", "id", "parseError", "parseStatus", "pricingData", "rawFilePath", "scopeLines", "subcontractorId", "updatedAt", "uploadedAt" FROM "EstimateUpload";
DROP TABLE "EstimateUpload";
ALTER TABLE "new_EstimateUpload" RENAME TO "EstimateUpload";
CREATE UNIQUE INDEX "EstimateUpload_bidId_subcontractorId_key" ON "EstimateUpload"("bidId", "subcontractorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
