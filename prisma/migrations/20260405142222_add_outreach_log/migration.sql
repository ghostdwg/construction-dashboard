-- CreateTable
CREATE TABLE "OutreachLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "subcontractorId" INTEGER,
    "contactId" INTEGER,
    "questionId" INTEGER,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'exported',
    "sentAt" DATETIME,
    "respondedAt" DATETIME,
    "responseNotes" TEXT,
    "followUpDue" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutreachLog_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GeneratedQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
