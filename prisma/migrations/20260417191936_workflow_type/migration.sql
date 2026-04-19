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
    "workflowType" TEXT NOT NULL DEFAULT 'BID',
    "projectType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "dueDate" DATETIME,
    "complianceChecklist" TEXT,
    "createdById" TEXT,
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
    "dbeGoalPercent" REAL,
    "constructionStartDate" DATETIME,
    "projectDurationDays" INTEGER,
    "budgetGcLines" TEXT,
    "procoreProjectId" TEXT
);
INSERT INTO "new_Bid" ("approxSqft", "budgetGcLines", "buildingType", "complianceChecklist", "constructionStartDate", "createdAt", "createdById", "dbeGoalPercent", "deliveryMethod", "description", "dueDate", "estimatorNotes", "id", "ldAmountPerDay", "ldCapAmount", "location", "occupiedSpace", "ownerType", "phasingRequired", "procoreProjectId", "projectDurationDays", "projectName", "projectType", "scope", "scopeBoundaryNotes", "siteConstraints", "status", "stories", "updatedAt", "veInterest") SELECT "approxSqft", "budgetGcLines", "buildingType", "complianceChecklist", "constructionStartDate", "createdAt", "createdById", "dbeGoalPercent", "deliveryMethod", "description", "dueDate", "estimatorNotes", "id", "ldAmountPerDay", "ldCapAmount", "location", "occupiedSpace", "ownerType", "phasingRequired", "procoreProjectId", "projectDurationDays", "projectName", "projectType", "scope", "scopeBoundaryNotes", "siteConstraints", "status", "stories", "updatedAt", "veInterest" FROM "Bid";
DROP TABLE "Bid";
ALTER TABLE "new_Bid" RENAME TO "Bid";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
