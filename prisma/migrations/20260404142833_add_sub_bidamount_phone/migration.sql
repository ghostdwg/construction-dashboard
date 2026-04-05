/*
  Warnings:

  - You are about to drop the column `description` on the `Bid` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Bid` table. All the data in the column will be lost.
  - Added the required column `scope` to the `Bid` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Bid` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "Subcontractor" ADD COLUMN "bidAmount" DECIMAL;
ALTER TABLE "Subcontractor" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "scopeNotes" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bid" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectName" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bidAmount" REAL,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Bid" ("createdAt", "dueDate", "id", "projectName") SELECT "createdAt", "dueDate", "id", "projectName" FROM "Bid";
DROP TABLE "Bid";
ALTER TABLE "new_Bid" RENAME TO "Bid";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
