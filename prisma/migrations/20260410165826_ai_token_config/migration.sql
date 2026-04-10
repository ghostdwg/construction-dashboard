-- CreateTable
CREATE TABLE "AiTokenConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "callKey" TEXT NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTokenConfig_callKey_key" ON "AiTokenConfig"("callKey");
