-- BackgroundJob: scheduled execution window for queued jobs (e.g. off-peak scrapes)
ALTER TABLE "BackgroundJob" ADD COLUMN "runAfter" DATETIME;
CREATE INDEX "BackgroundJob_runAfter_idx" ON "BackgroundJob"("runAfter");
