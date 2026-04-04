-- CreateTable
CREATE TABLE "Bid" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectName" TEXT NOT NULL,
    "location" TEXT,
    "dueDate" DATETIME,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "costCode" TEXT,
    "bidId" INTEGER NOT NULL,
    CONSTRAINT "Trade_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subcontractor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "tradeId" INTEGER NOT NULL,
    CONSTRAINT "Subcontractor_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subcontractorId" INTEGER NOT NULL,
    CONSTRAINT "Contact_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
