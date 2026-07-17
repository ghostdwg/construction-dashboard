-- R2-B1 remediation — non-destructive extraction reruns.
-- Additive only: three nullable columns on MeetingRegisterEntry.
-- Forward-only; applied ONLY via scripts/apply-turso-migrations.mjs by the
-- operator (never auto-run, never by a model).
--
-- Rerun apply no longer deletes PENDING machine-origin register entries.
-- Entries the new analysis no longer produces are marked
-- reviewState = 'SUPERSEDED' and retained forever, recording which run
-- superseded them and (where a deterministic match exists) which entry
-- replaced them. Dispositioned/linked/promoted entries were never touched
-- by reruns and remain untouched.

ALTER TABLE "MeetingRegisterEntry" ADD COLUMN "supersededByRunId" INTEGER
    REFERENCES "MeetingExtractionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingRegisterEntry" ADD COLUMN "supersededByEntryId" INTEGER
    REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingRegisterEntry" ADD COLUMN "supersededAt" DATETIME;
