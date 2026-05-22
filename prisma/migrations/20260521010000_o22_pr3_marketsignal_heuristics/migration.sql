-- Phase O2.2 PR3 — MarketSignal hygiene/explainability columns.
--
-- Additive-only:
--   * Four nullable columns on MarketSignal that capture the deterministic
--     heuristic classifier's verdict from signalHeuristics.ts (PR2). They are
--     populated by persistSidecarPayload (PR3 wiring) on every signal that
--     was NOT suppressed.
--
-- Semantics:
--   * heuristicsJson           — JSON array of HeuristicFactor objects
--                                (kind, weight, bucket, detail). Stored
--                                verbatim so v2 readers can decode v1.
--   * heuristicsVersion        — HEURISTICS_VERSION at write time (e.g. "v1").
--                                Lets calibration code reason about which
--                                rule-set produced the verdict.
--   * heuristicsScore          — clamped [0, 1] score that produced the
--                                classification.
--   * heuristicsClassification — HIGH_EMERGENCE | MEDIUM_EMERGENCE |
--                                LOW_EMERGENCE. SUPPRESSED is never persisted.
--
-- Backward-compatible: all existing readers/writers of MarketSignal are
-- unaffected. Pre-PR3 rows have NULL in all four columns; the operator UI
-- treats NULL as "classifier not yet run" and renders accordingly.

-- AlterTable
ALTER TABLE "MarketSignal" ADD COLUMN "heuristicsJson"           TEXT;
ALTER TABLE "MarketSignal" ADD COLUMN "heuristicsVersion"        TEXT;
ALTER TABLE "MarketSignal" ADD COLUMN "heuristicsScore"          REAL;
ALTER TABLE "MarketSignal" ADD COLUMN "heuristicsClassification" TEXT;

-- CreateIndex — operator queries ("show me HIGH_EMERGENCE signals from last
-- week") will be common; small bounded-cardinality column with good selectivity.
CREATE INDEX "MarketSignal_heuristicsClassification_idx" ON "MarketSignal"("heuristicsClassification");
