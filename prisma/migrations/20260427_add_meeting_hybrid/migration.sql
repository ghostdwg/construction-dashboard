-- Phase 5D extension: Teams Hybrid transcription support
-- Adds processingMode, speakerMapping, and vttContent to Meeting

ALTER TABLE "Meeting" ADD COLUMN "processingMode" TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE "Meeting" ADD COLUMN "speakerMapping" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "vttContent" TEXT;
