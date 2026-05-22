// ──────────────────────────────────────────────────────────────────────────────
//  app/api/market-intelligence/sources/[id]/scrape/route.ts
//  Operator-triggered immediate scrape.
//
//  O2.2 PR1: route now delegates to lib/services/marketIntelligence/scrapeOneSource,
//  which (1) runs the same scrape pipeline as before AND (2) bridges each
//  freshly-created MarketSignal / MarketLead / RelationshipEdge into
//  liveIngestion. Same shared service will be invoked by the future
//  municipal-agenda-ingestion runner — single source of truth.
//
//  Response shape: all prior fields preserved verbatim; a new `ingestion`
//  field is appended that summarizes the bridge stage. Existing UI clients
//  ignore unknown fields.
// ──────────────────────────────────────────────────────────────────────────────

import {
  scrapeOneSource,
  ScrapeOneSourceError,
  type ScrapeOneSourceOptions,
} from "@/lib/services/marketIntelligence/scrapeOneSource";

const STATUS_BY_KIND: Record<ScrapeOneSourceError["kind"], number> = {
  not_found: 404,
  inactive: 400,
  upstream: 502,
  internal: 500,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let override: ScrapeOneSourceOptions = {};
  try {
    if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 0) {
      override = (await request.json()) as ScrapeOneSourceOptions;
    }
  } catch {
    override = {};
  }

  try {
    const result = await scrapeOneSource(id, override);
    return Response.json({
      // ── Preserved response fields (backward-compatible) ───────────────────
      docsFound: result.docsFound,
      docsInRange: result.docsInRange,
      docsScanned: result.docsScanned,
      docsSkipped: result.docsSkipped,
      docsDroppedDate: result.docsDroppedDate,
      docsDroppedUndated: result.docsDroppedUndated,
      docsPrefilterApplied: result.docsPrefilterApplied,
      docsPrefilterSkipped: result.docsPrefilterSkipped,
      docsPrefilterFailed:  result.docsPrefilterFailed,
      totalCharsSaved:      result.totalCharsSaved,
      signalsCreated: result.signalsCreated,
      leadsCreated: result.leadsCreated,
      relationshipsCreated: result.relationshipsCreated,
      signalsDroppedRelevance: result.signalsDroppedRelevance,
      signalsDroppedProjectType: result.signalsDroppedProjectType,
      leadsDroppedValue: result.leadsDroppedValue,
      totalCostUsd: result.totalCostUsd,
      engine: result.engine,
      // ── O2.2 PR3: hygiene + cadence summary (additive) ────────────────────
      signalsSuppressedHeuristics: result.signalsSuppressedHeuristics,
      classifiedByBand: result.classifiedByBand,
      publishStatus: result.publishStatus,
      consecutiveEmptyRuns: result.consecutiveEmptyRuns,
      heuristicsApplied: result.heuristicsApplied,
      // ── New: live-ingestion bridge summary ────────────────────────────────
      ingestion: result.ingestion,
    });
  } catch (err) {
    if (err instanceof ScrapeOneSourceError) {
      return Response.json({ error: err.message }, { status: STATUS_BY_KIND[err.kind] });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
