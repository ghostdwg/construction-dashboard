-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DrawingUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "discipline" TEXT NOT NULL DEFAULT 'FULLSET',
    CONSTRAINT "DrawingUpload_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DrawingUpload" ("bidId", "fileName", "filePath", "id", "status", "uploadedAt") SELECT "bidId", "fileName", "filePath", "id", "status", "uploadedAt" FROM "DrawingUpload";
DROP TABLE "DrawingUpload";
ALTER TABLE "new_DrawingUpload" RENAME TO "DrawingUpload";
CREATE INDEX "DrawingUpload_bidId_discipline_idx" ON "DrawingUpload"("bidId", "discipline");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
