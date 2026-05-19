-- Per-source Ollama model override (null = use sidecar OLLAMA_MODEL default)
ALTER TABLE "MarketSource" ADD COLUMN "prefilterModel" TEXT;
