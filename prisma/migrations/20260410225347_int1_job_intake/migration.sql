-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bid" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectName" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "scope" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "projectType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "dueDate" DATETIME,
    "complianceChecklist" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deliveryMethod" TEXT,
    "ownerType" TEXT,
    "buildingType" TEXT,
    "approxSqft" INTEGER,
    "stories" INTEGER,
    "ldAmountPerDay" REAL,
    "ldCapAmount" REAL,
    "occupiedSpace" BOOLEAN NOT NULL DEFAULT false,
    "phasingRequired" BOOLEAN NOT NULL DEFAULT false,
    "siteConstraints" TEXT,
    "estimatorNotes" TEXT,
    "scopeBoundaryNotes" TEXT,
    "veInterest" BOOLEAN NOT NULL DEFAULT false,
    "dbeGoalPercent" REAL
);
INSERT INTO "new_Bid" ("complianceChecklist", "createdAt", "description", "dueDate", "id", "location", "projectName", "projectType", "scope", "status", "updatedAt") SELECT "complianceChecklist", "createdAt", "description", "dueDate", "id", "location", "projectName", "projectType", "scope", "status", "updatedAt" FROM "Bid";
DROP TABLE "Bid";
ALTER TABLE "new_Bid" RENAME TO "Bid";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
