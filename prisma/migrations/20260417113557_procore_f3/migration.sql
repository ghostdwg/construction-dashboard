-- CreateTable
CREATE TABLE "RfiItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "procoreRfiId" INTEGER,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT,
    "assigneeName" TEXT,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME,
    CONSTRAINT "RfiItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcoreWebhookEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" INTEGER,
    "projectId" INTEGER,
    "companyId" INTEGER,
    "payload" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" DATETIME,
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "RfiItem_bidId_idx" ON "RfiItem"("bidId");

-- CreateIndex
CREATE UNIQUE INDEX "RfiItem_bidId_procoreRfiId_key" ON "RfiItem"("bidId", "procoreRfiId");

-- CreateIndex
CREATE INDEX "ProcoreWebhookEvent_resourceType_resourceId_idx" ON "ProcoreWebhookEvent"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "ProcoreWebhookEvent_processed_idx" ON "ProcoreWebhookEvent"("processed");
