-- CreateTable
CREATE TABLE "DrawingUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'processing',
    CONSTRAINT "DrawingUpload_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DrawingSheet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "drawingUploadId" INTEGER NOT NULL,
    "sheetNumber" TEXT NOT NULL,
    "sheetTitle" TEXT,
    "discipline" TEXT,
    "matchedTradeId" INTEGER,
    "tradeId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrawingSheet_drawingUploadId_fkey" FOREIGN KEY ("drawingUploadId") REFERENCES "DrawingUpload" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrawingSheet_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DrawingSheet_matchedTradeId_fkey" FOREIGN KEY ("matchedTradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpecSection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "specBookId" INTEGER NOT NULL,
    "csiNumber" TEXT NOT NULL,
    "csiTitle" TEXT NOT NULL,
    "rawText" TEXT NOT NULL DEFAULT '',
    "tradeId" INTEGER,
    "matchedTradeId" INTEGER,
    "source" TEXT,
    "covered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecSection_specBookId_fkey" FOREIGN KEY ("specBookId") REFERENCES "SpecBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpecSection_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpecSection_matchedTradeId_fkey" FOREIGN KEY ("matchedTradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SpecSection" ("covered", "createdAt", "csiNumber", "csiTitle", "id", "rawText", "specBookId", "tradeId") SELECT "covered", "createdAt", "csiNumber", "csiTitle", "id", "rawText", "specBookId", "tradeId" FROM "SpecSection";
DROP TABLE "SpecSection";
ALTER TABLE "new_SpecSection" RENAME TO "SpecSection";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
