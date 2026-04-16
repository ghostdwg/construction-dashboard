-- CreateTable
CREATE TABLE "CsiMasterformat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "csiNumber" TEXT NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "division" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CsiMasterformat_csiNumber_key" ON "CsiMasterformat"("csiNumber");

-- CreateIndex
CREATE INDEX "CsiMasterformat_division_idx" ON "CsiMasterformat"("division");
