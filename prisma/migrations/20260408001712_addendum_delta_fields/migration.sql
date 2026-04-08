-- AlterTable
ALTER TABLE "AddendumUpload" ADD COLUMN "deltaGeneratedAt" DATETIME;
ALTER TABLE "AddendumUpload" ADD COLUMN "deltaJson" TEXT;
ALTER TABLE "AddendumUpload" ADD COLUMN "summary" TEXT;

-- AlterTable
ALTER TABLE "BidIntelligenceBrief" ADD COLUMN "addendumDeltas" TEXT;
