// ──────────────────────────────────────────────────────────────────────────────
//  app/api/market-intelligence/leads/route.ts
//
//  RETIRED — generic browser creation of Market Intelligence candidates.
//
//  Market Intelligence is evidence-first: every Emerging Project must originate
//  from ingested evidence (a signal or source document with provenance), never
//  from a hand-typed browser form. The legitimate ingestion pipeline
//  (lib/services/marketIntelligence/scrapeOneSource.ts) writes candidate rows
//  and bridges them into liveIngestion.processNewMarketLead() DIRECTLY — it does
//  not, and never did, call this HTTP route. The only caller this endpoint ever
//  had was the removed "New Lead" button, so the generic manual-write POST is
//  gone rather than kept alive as a dead, evidence-free creation path.
//
//  Manual opportunities belong in Pursuits, not here: create them through the
//  existing Pursuit Intake / New Bid flow (/bids/new → POST /api/bids).
//
//  The route stays fail-closed. Manual creation is answered with 405 Method Not
//  Allowed and performs no write — authenticated and anonymous callers alike.
//  It deliberately exposes no GET/list verb, so the module stays POST-only and
//  the retired POST cannot be used to manufacture intelligence candidates.
// ──────────────────────────────────────────────────────────────────────────────

const RETIRED_MESSAGE =
  "Manual Market Intelligence creation is retired. Emerging Projects are derived " +
  "from ingested evidence, not entered by hand. Create a manual opportunity as a " +
  "Pursuit via /bids/new instead.";

/**
 * Manual browser creation is retired. Return 405 without touching the database,
 * the ingestion pipeline, or the request body — nothing here can create a
 * MarketLead.
 */
export function POST(): Response {
  return Response.json(
    { error: "Method Not Allowed", detail: RETIRED_MESSAGE },
    { status: 405, headers: { Allow: "" } }
  );
}
