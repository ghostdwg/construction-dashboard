-- AlterTable
ALTER TABLE "OutreachLog" ADD COLUMN "bounceReason" TEXT;
ALTER TABLE "OutreachLog" ADD COLUMN "bouncedAt" DATETIME;
ALTER TABLE "OutreachLog" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "OutreachLog" ADD COLUMN "emailMessageId" TEXT;
ALTER TABLE "OutreachLog" ADD COLUMN "openedAt" DATETIME;

-- CreateIndex
CREATE INDEX "OutreachLog_emailMessageId_idx" ON "OutreachLog"("emailMessageId");
