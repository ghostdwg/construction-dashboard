-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GeneratedQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gapFindingId" INTEGER,
    "bidId" INTEGER,
    "levelingRowId" INTEGER,
    "tradeName" TEXT,
    "questionText" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "approvedAt" DATETIME,
    "sentAt" DATETIME,
    "responseText" TEXT,
    "respondedAt" DATETIME,
    "respondedBy" TEXT,
    "impactFlag" BOOLEAN NOT NULL DEFAULT false,
    "impactNote" TEXT,
    "sourceRef" TEXT,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedQuestion_gapFindingId_fkey" FOREIGN KEY ("gapFindingId") REFERENCES "AiGapFinding" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedQuestion_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GeneratedQuestion_levelingRowId_fkey" FOREIGN KEY ("levelingRowId") REFERENCES "LevelingRow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GeneratedQuestion" ("approvedAt", "bidId", "createdAt", "gapFindingId", "id", "isInternal", "levelingRowId", "questionText", "sentAt", "status", "tradeName", "updatedAt") SELECT "approvedAt", "bidId", "createdAt", "gapFindingId", "id", "isInternal", "levelingRowId", "questionText", "sentAt", CASE "status" WHEN 'sent' THEN 'SENT' WHEN 'answered' THEN 'ANSWERED' WHEN 'unanswered' THEN 'NO_RESPONSE' ELSE 'OPEN' END, "tradeName", "updatedAt" FROM "GeneratedQuestion";
DROP TABLE "GeneratedQuestion";
ALTER TABLE "new_GeneratedQuestion" RENAME TO "GeneratedQuestion";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
