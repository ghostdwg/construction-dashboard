-- MarketSource: Ollama prefilter config (cost control)
ALTER TABLE "MarketSource" ADD COLUMN "prefilterMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "MarketSource" ADD COLUMN "prefilterCharThreshold" INTEGER NOT NULL DEFAULT 30000;
