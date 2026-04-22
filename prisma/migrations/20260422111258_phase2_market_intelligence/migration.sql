-- CreateTable
CREATE TABLE "MarketLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "leadType" TEXT NOT NULL DEFAULT 'MANUAL',
    "source" TEXT,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "aiScore" INTEGER,
    "location" TEXT,
    "jurisdiction" TEXT,
    "projectType" TEXT,
    "estimatedValue" REAL,
    "rawText" TEXT,
    "aiSummary" TEXT,
    "aiInsights" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedToBidId" INTEGER,
    "promotedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketLead_promotedToBidId_fkey" FOREIGN KEY ("promotedToBidId") REFERENCES "Bid" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "signalType" TEXT NOT NULL,
    "source" TEXT,
    "sourceUrl" TEXT,
    "sourceDate" DATETIME,
    "headline" TEXT NOT NULL,
    "rawText" TEXT,
    "metadata" TEXT,
    "aiRelevanceScore" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketLead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RelationshipEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromType" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "projectName" TEXT,
    "projectValue" REAL,
    "projectYear" INTEGER,
    "location" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MarketLead_status_idx" ON "MarketLead"("status");

-- CreateIndex
CREATE INDEX "MarketLead_leadType_idx" ON "MarketLead"("leadType");

-- CreateIndex
CREATE INDEX "MarketLead_detectedAt_idx" ON "MarketLead"("detectedAt");

-- CreateIndex
CREATE INDEX "MarketLead_promotedToBidId_idx" ON "MarketLead"("promotedToBidId");

-- CreateIndex
CREATE INDEX "MarketSignal_leadId_idx" ON "MarketSignal"("leadId");

-- CreateIndex
CREATE INDEX "MarketSignal_signalType_idx" ON "MarketSignal"("signalType");

-- CreateIndex
CREATE INDEX "MarketSignal_createdAt_idx" ON "MarketSignal"("createdAt");

-- CreateIndex
CREATE INDEX "RelationshipEdge_fromName_idx" ON "RelationshipEdge"("fromName");

-- CreateIndex
CREATE INDEX "RelationshipEdge_toName_idx" ON "RelationshipEdge"("toName");

-- CreateIndex
CREATE INDEX "RelationshipEdge_relationshipType_idx" ON "RelationshipEdge"("relationshipType");
