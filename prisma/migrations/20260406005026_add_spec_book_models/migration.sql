-- CreateTable
CREATE TABLE "SpecBook" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'processing',
    CONSTRAINT "SpecBook_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpecSection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "specBookId" INTEGER NOT NULL,
    "csiNumber" TEXT NOT NULL,
    "csiTitle" TEXT NOT NULL,
    "rawText" TEXT NOT NULL DEFAULT '',
    "tradeId" INTEGER,
    "covered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecSection_specBookId_fkey" FOREIGN KEY ("specBookId") REFERENCES "SpecBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpecSection_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
