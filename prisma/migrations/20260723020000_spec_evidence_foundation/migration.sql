-- Closeout Card 1A: immutable section/paragraph/citation evidence, effective
-- manifests, draft candidates, and append-only human decisions.

CREATE TABLE "SpecificationEffectiveSet" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "baseSpecBookId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publishedBy" TEXT,
  "publishedAt" DATETIME,
  "supersedesId" INTEGER,
  "manifestJson" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "activeSlot" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpecificationEffectiveSet_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecificationEffectiveSet_baseSpecBookId_fkey" FOREIGN KEY ("baseSpecBookId") REFERENCES "SpecBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpecificationEffectiveSet_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "SpecificationEffectiveSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SpecificationEffectiveSetAddendum" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "effectiveSetId" INTEGER NOT NULL,
  "addendumUploadId" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "SpecificationEffectiveSetAddendum_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecificationEffectiveSetAddendum_effectiveSetId_fkey" FOREIGN KEY ("effectiveSetId") REFERENCES "SpecificationEffectiveSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecificationEffectiveSetAddendum_addendumUploadId_fkey" FOREIGN KEY ("addendumUploadId") REFERENCES "AddendumUpload" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SpecSectionEvidenceRevision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "specSectionId" INTEGER NOT NULL,
  "revisionIndex" INTEGER NOT NULL,
  "supersedesRevisionId" INTEGER,
  "rawText" TEXT NOT NULL,
  "textSha256" TEXT NOT NULL,
  "pdfPath" TEXT,
  "pdfSha256" TEXT,
  "pdfByteSize" INTEGER,
  "pageStart" INTEGER,
  "pageEnd" INTEGER,
  "pageCount" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecSectionEvidenceRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecSectionEvidenceRevision_specSectionId_fkey" FOREIGN KEY ("specSectionId") REFERENCES "SpecSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecSectionEvidenceRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "SpecSectionEvidenceRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SpecParagraph" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "sectionEvidenceRevisionId" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "paragraphLabel" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "pageNumber" INTEGER,
  "pageEnd" INTEGER,
  "charStart" INTEGER NOT NULL,
  "charEnd" INTEGER NOT NULL,
  "textSha256" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecParagraph_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecParagraph_sectionEvidenceRevisionId_fkey" FOREIGN KEY ("sectionEvidenceRevisionId") REFERENCES "SpecSectionEvidenceRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SpecCitation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "effectiveSetId" INTEGER NOT NULL,
  "sectionEvidenceRevisionId" INTEGER NOT NULL,
  "specParagraphId" INTEGER,
  "sourceLocator" TEXT NOT NULL,
  "evidenceExcerpt" TEXT NOT NULL,
  "textSha256" TEXT NOT NULL,
  "extractionMethod" TEXT NOT NULL DEFAULT 'manual',
  "extractorVersion" TEXT,
  "confidence" REAL,
  "citationVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecCitation_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecCitation_effectiveSetId_fkey" FOREIGN KEY ("effectiveSetId") REFERENCES "SpecificationEffectiveSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpecCitation_sectionEvidenceRevisionId_fkey" FOREIGN KEY ("sectionEvidenceRevisionId") REFERENCES "SpecSectionEvidenceRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpecCitation_specParagraphId_fkey" FOREIGN KEY ("specParagraphId") REFERENCES "SpecParagraph" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SpecRequirementCandidate" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "effectiveSetId" INTEGER NOT NULL,
  "citationId" INTEGER NOT NULL,
  "candidateGroupId" TEXT NOT NULL,
  "revisionIndex" INTEGER NOT NULL,
  "supersedesCandidateId" INTEGER,
  "requirementType" TEXT NOT NULL,
  "draftTitle" TEXT NOT NULL,
  "draftText" TEXT NOT NULL,
  "evidenceExcerpt" TEXT NOT NULL,
  "sourceLocator" TEXT NOT NULL,
  "extractionMethod" TEXT NOT NULL DEFAULT 'manual',
  "extractorVersion" TEXT,
  "confidence" REAL,
  "reviewState" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpecRequirementCandidate_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecRequirementCandidate_effectiveSetId_fkey" FOREIGN KEY ("effectiveSetId") REFERENCES "SpecificationEffectiveSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpecRequirementCandidate_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "SpecCitation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpecRequirementCandidate_supersedesCandidateId_fkey" FOREIGN KEY ("supersedesCandidateId") REFERENCES "SpecRequirementCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SpecRequirementDecision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "candidateId" INTEGER NOT NULL,
  "bidId" INTEGER NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT,
  "decidedBy" TEXT NOT NULL,
  "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correctionOfId" INTEGER,
  CONSTRAINT "SpecRequirementDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SpecRequirementCandidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpecRequirementDecision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecRequirementDecision_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "SpecRequirementDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SpecificationEffectiveSet_bidId_versionNumber_key" ON "SpecificationEffectiveSet"("bidId", "versionNumber");
CREATE UNIQUE INDEX "SpecificationEffectiveSet_bidId_activeSlot_key" ON "SpecificationEffectiveSet"("bidId", "activeSlot");
CREATE INDEX "SpecificationEffectiveSet_bidId_status_idx" ON "SpecificationEffectiveSet"("bidId", "status");
CREATE INDEX "SpecificationEffectiveSet_baseSpecBookId_idx" ON "SpecificationEffectiveSet"("baseSpecBookId");
CREATE INDEX "SpecificationEffectiveSet_supersedesId_idx" ON "SpecificationEffectiveSet"("supersedesId");
CREATE UNIQUE INDEX "SpecificationEffectiveSetAddendum_effectiveSetId_addendumUploadId_key" ON "SpecificationEffectiveSetAddendum"("effectiveSetId", "addendumUploadId");
CREATE UNIQUE INDEX "SpecificationEffectiveSetAddendum_effectiveSetId_ordinal_key" ON "SpecificationEffectiveSetAddendum"("effectiveSetId", "ordinal");
CREATE INDEX "SpecificationEffectiveSetAddendum_bidId_effectiveSetId_idx" ON "SpecificationEffectiveSetAddendum"("bidId", "effectiveSetId");
CREATE INDEX "SpecificationEffectiveSetAddendum_bidId_addendumUploadId_idx" ON "SpecificationEffectiveSetAddendum"("bidId", "addendumUploadId");
CREATE UNIQUE INDEX "SpecSectionEvidenceRevision_specSectionId_revisionIndex_key" ON "SpecSectionEvidenceRevision"("specSectionId", "revisionIndex");
CREATE INDEX "SpecSectionEvidenceRevision_bidId_specSectionId_idx" ON "SpecSectionEvidenceRevision"("bidId", "specSectionId");
CREATE INDEX "SpecSectionEvidenceRevision_supersedesRevisionId_idx" ON "SpecSectionEvidenceRevision"("supersedesRevisionId");
CREATE INDEX "SpecSectionEvidenceRevision_textSha256_idx" ON "SpecSectionEvidenceRevision"("textSha256");
CREATE UNIQUE INDEX "SpecParagraph_sectionEvidenceRevisionId_ordinal_key" ON "SpecParagraph"("sectionEvidenceRevisionId", "ordinal");
CREATE INDEX "SpecParagraph_bidId_paragraphLabel_idx" ON "SpecParagraph"("bidId", "paragraphLabel");
CREATE INDEX "SpecParagraph_sectionEvidenceRevisionId_pageNumber_idx" ON "SpecParagraph"("sectionEvidenceRevisionId", "pageNumber");
CREATE INDEX "SpecParagraph_textSha256_idx" ON "SpecParagraph"("textSha256");
CREATE INDEX "SpecCitation_bidId_effectiveSetId_idx" ON "SpecCitation"("bidId", "effectiveSetId");
CREATE INDEX "SpecCitation_bidId_sectionEvidenceRevisionId_idx" ON "SpecCitation"("bidId", "sectionEvidenceRevisionId");
CREATE INDEX "SpecCitation_specParagraphId_idx" ON "SpecCitation"("specParagraphId");
CREATE UNIQUE INDEX "SpecRequirementCandidate_candidateGroupId_revisionIndex_key" ON "SpecRequirementCandidate"("candidateGroupId", "revisionIndex");
CREATE INDEX "SpecRequirementCandidate_bidId_reviewState_idx" ON "SpecRequirementCandidate"("bidId", "reviewState");
CREATE INDEX "SpecRequirementCandidate_bidId_effectiveSetId_idx" ON "SpecRequirementCandidate"("bidId", "effectiveSetId");
CREATE INDEX "SpecRequirementCandidate_citationId_idx" ON "SpecRequirementCandidate"("citationId");
CREATE INDEX "SpecRequirementCandidate_supersedesCandidateId_idx" ON "SpecRequirementCandidate"("supersedesCandidateId");
CREATE INDEX "SpecRequirementDecision_bidId_candidateId_idx" ON "SpecRequirementDecision"("bidId", "candidateId");
CREATE INDEX "SpecRequirementDecision_correctionOfId_idx" ON "SpecRequirementDecision"("correctionOfId");
