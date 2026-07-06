-- Artifact-durability work — Addendums + Meetings durable storage keys.
--
-- Additive only, both columns nullable:
--   * AddendumUpload.storageKey  — relative BlobStore key for the durably
--     stored original PDF. AddendumUpload never had any filePath/storageKey
--     column before this migration (the raw PDF was extracted to
--     extractedText synchronously at upload time and never read again) — so
--     every pre-existing row's storageKey is simply null; there is nothing to
--     backfill because there was never a stored reference to backfill from.
--   * Meeting.audioStorageKey    — relative BlobStore key for the durably
--     stored hybrid-upload audio file. Historic rows keep resolving their
--     audio via the pre-existing naming-convention reconstruction
--     (process.cwd()/uploads/meetings/{id}/{audioFileName}) in
--     source-mapping/route.ts; this column is only populated by new hybrid
--     uploads going forward and only consulted when non-null.
ALTER TABLE "AddendumUpload" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "audioStorageKey" TEXT;
