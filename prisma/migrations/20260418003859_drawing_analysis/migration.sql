-- AlterTable
ALTER TABLE "DrawingUpload" ADD COLUMN "analysisGeneratedAt" DATETIME;
ALTER TABLE "DrawingUpload" ADD COLUMN "analysisJson" TEXT;
ALTER TABLE "DrawingUpload" ADD COLUMN "analysisModel" TEXT;
ALTER TABLE "DrawingUpload" ADD COLUMN "analysisStatus" TEXT;
ALTER TABLE "DrawingUpload" ADD COLUMN "analysisTier" INTEGER;
