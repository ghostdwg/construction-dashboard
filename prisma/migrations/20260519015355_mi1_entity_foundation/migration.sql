-- ──────────────────────────────────────────────────────────────────────────────
-- Phase MI-1 / PR 1 — Entity normalization foundation
--
-- Additive only. No existing column or table is altered destructively. The
-- four new columns on RelationshipEdge are nullable; existing rows continue
-- to function unchanged via the original free-text fromName/toName columns.
--
-- Acceptance criteria for the MI-1→MI-5 stack live in
-- docs/sources/ENTITIES_WATCHLIST.md §"Validation tests".
--
-- Note: this branch (feat/market-intelligence @ 4137ae5) carries pre-existing
-- schema drift unrelated to MI-1 (SubmittalPackage release-phase fields,
-- SubmittalItem priority/releasePhase, and Prisma-default FK redefinitions on
-- MarketLead/MarketSignal). Those drift changes are intentionally NOT included
-- in this migration; they belong in a separate cleanup PR.
-- ──────────────────────────────────────────────────────────────────────────────

-- AlterTable — RelationshipEdge: additive entity-link columns (all nullable)
ALTER TABLE "RelationshipEdge" ADD COLUMN "fromEntityId" TEXT;
ALTER TABLE "RelationshipEdge" ADD COLUMN "toEntityId" TEXT;
ALTER TABLE "RelationshipEdge" ADD COLUMN "resolverVersion" TEXT;
ALTER TABLE "RelationshipEdge" ADD COLUMN "resolverConfidence" TEXT;

-- CreateTable — Entity
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable — EntityAlias
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable — EntityRelationship
CREATE TABLE "EntityRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "projectName" TEXT,
    "projectValue" REAL,
    "projectYear" INTEGER,
    "projectAddress" TEXT,
    "jurisdiction" TEXT,
    "sourceDocId" TEXT,
    "leadId" TEXT,
    "signalId" TEXT,
    "legacyEdgeId" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "notes" TEXT,
    "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntityRelationship_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntityRelationship_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "Entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable — EntityWatchlistSeed
CREATE TABLE "EntityWatchlistSeed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "category" TEXT,
    "seedSource" TEXT NOT NULL DEFAULT 'docs/sources/ENTITIES_WATCHLIST.md',
    "notes" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex — Entity
CREATE UNIQUE INDEX "Entity_normalizedName_key" ON "Entity"("normalizedName");
CREATE INDEX "Entity_entityType_idx" ON "Entity"("entityType");
CREATE INDEX "Entity_reviewStatus_idx" ON "Entity"("reviewStatus");

-- CreateIndex — EntityAlias
CREATE INDEX "EntityAlias_normalizedAlias_idx" ON "EntityAlias"("normalizedAlias");
CREATE INDEX "EntityAlias_entityId_idx" ON "EntityAlias"("entityId");
CREATE UNIQUE INDEX "EntityAlias_entityId_normalizedAlias_key" ON "EntityAlias"("entityId", "normalizedAlias");

-- CreateIndex — EntityRelationship
CREATE INDEX "EntityRelationship_fromEntityId_idx" ON "EntityRelationship"("fromEntityId");
CREATE INDEX "EntityRelationship_toEntityId_idx" ON "EntityRelationship"("toEntityId");
CREATE INDEX "EntityRelationship_relationshipType_idx" ON "EntityRelationship"("relationshipType");
CREATE INDEX "EntityRelationship_projectYear_idx" ON "EntityRelationship"("projectYear");
CREATE INDEX "EntityRelationship_sourceDocId_idx" ON "EntityRelationship"("sourceDocId");
CREATE INDEX "EntityRelationship_leadId_idx" ON "EntityRelationship"("leadId");
CREATE INDEX "EntityRelationship_signalId_idx" ON "EntityRelationship"("signalId");
CREATE INDEX "EntityRelationship_legacyEdgeId_idx" ON "EntityRelationship"("legacyEdgeId");

-- CreateIndex — EntityWatchlistSeed
CREATE INDEX "EntityWatchlistSeed_normalizedName_idx" ON "EntityWatchlistSeed"("normalizedName");
CREATE INDEX "EntityWatchlistSeed_entityType_idx" ON "EntityWatchlistSeed"("entityType");
CREATE INDEX "EntityWatchlistSeed_reviewStatus_idx" ON "EntityWatchlistSeed"("reviewStatus");

-- CreateIndex — RelationshipEdge entity-link columns
CREATE INDEX "RelationshipEdge_fromEntityId_idx" ON "RelationshipEdge"("fromEntityId");
CREATE INDEX "RelationshipEdge_toEntityId_idx" ON "RelationshipEdge"("toEntityId");
