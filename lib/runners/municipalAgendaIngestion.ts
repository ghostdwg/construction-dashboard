// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/municipalAgendaIngestion.ts
//  Phase O2.2 PR4 — Recurring municipal-agenda ingestion runner.
//
//  Fires hourly. Each cycle:
//    1. selectDueSources() → up to N HEALTHY sources past their nextExpectedAt
//    2. for each: scrapeOneSource() (PR1+PR3 shared service that classifies,
//       suppresses, persists, bridges to live ingestion, updates cadence)
//    3. emit a structured summary; surface metrics + audits.
//
//  This runner contains NO business logic of its own — every decision happens
//  inside scrapeOneSource and its dependencies (signalHeuristics, cadence,
//  liveIngestion). The runner is the "what to scrape and when" layer; PR1-PR3
//  own "how to scrape and what to do with the results".
//
//  Lease contract:
//    * windowGranularity=hourly → at-most-once per hour via RunnerLease unique
//      constraint on windowKey (`municipal-agenda-ingestion_2026-05-21T03`).
//    * leaseSeconds=900 (15 min) → heartbeat extends; if missing, stale flag.
//    * maxDurationSeconds=3300 → hard ceiling under the hour mark, so a
//      runaway cycle can never overlap the next hour's window.
//    * retryOnFailure=false → operator-initiated retry only; the next hour's
//      cycle picks up where this one stopped via the same selectDueSources
//      predicate.
//
//  Heartbeat semantics:
//    Each iteration calls ctx.heartbeat(). If it returns false, the lease was
//    preempted by an external stale-cleanup tool — abort immediately by
//    throwing. Partial progress is preserved (each scrapeOneSource is itself
//    idempotent via MarketSourceDoc dedup + liveIngestion's alreadyAttached).
//
//  Replay safety:
//    Calling the same cycle twice on the same windowKey returns preempted=true
//    from the dispatcher. Operator replay uses
//      tsx scripts/run-cycle.ts --runner=municipal-agenda-ingestion \
//        --window-key=replay-<date>-<reason> --trigger=replay
//    Each scrapeOneSource is independently idempotent; replay cleanly re-runs
//    without duplicating signals.
// ──────────────────────────────────────────────────────────────────────────────

import { registerRunner } from "./registry";
import {
  selectDueSources,
  countSourcesByPublishStatus,
  SELECT_DUE_DEFAULT_LIMIT,
} from "@/lib/services/marketIntelligence/sourceCadence";
import { scrapeOneSource } from "@/lib/services/marketIntelligence/scrapeOneSource";
import {
  recordRunnerSourceProcessed,
  recordRunnerScrapeFailure,
  setRunnerDueSources,
  setRunnerStaleSourceCount,
} from "@/lib/observability";

export const MUNICIPAL_AGENDA_RUNNER_NAME = "municipal-agenda-ingestion";

/** Sources-per-cycle cap. Matches sourceCadence.SELECT_DUE_DEFAULT_LIMIT today;
 *  declared here so operators can find the operational constant alongside the
 *  runner definition. Changing this requires bumping the runner version. */
export const MUNICIPAL_AGENDA_SOURCES_PER_CYCLE = SELECT_DUE_DEFAULT_LIMIT;

export interface MunicipalAgendaSourceOutcome {
  sourceId: string;
  ok: boolean;
  docsScanned: number;
  signalsCreated: number;
  signalsSuppressed: number;
  leadsCreated: number;
  relationshipsCreated: number;
  ingested: number;
  publishStatus: string;
  consecutiveEmptyRuns: number;
  errorMessage?: string;
}

export interface MunicipalAgendaResult {
  dueSourcesFound: number;
  sourcesScraped: number;
  sourcesFailed: number;
  docsScanned: number;
  signalsCreated: number;
  signalsSuppressedHeuristics: number;
  leadsCreated: number;
  relationshipsCreated: number;
  ingestedTotal: number;
  staleSourceCount: number;
  operatorReviewCount: number;
  perSource: MunicipalAgendaSourceOutcome[];
}

registerRunner<MunicipalAgendaResult>({
  name: MUNICIPAL_AGENDA_RUNNER_NAME,
  windowGranularity: "hourly",
  leaseSeconds: 900,            // 15 min lease (heartbeat every ~7 min)
  maxDurationSeconds: 3300,     // 55 min ceiling — never overlap next hour
  retryOnFailure: false,
  body: async (ctx) => {
    const due = await selectDueSources({
      now: ctx.windowStart,
      limit: MUNICIPAL_AGENDA_SOURCES_PER_CYCLE,
    });
    setRunnerDueSources(MUNICIPAL_AGENDA_RUNNER_NAME, due.length);

    const perSource: MunicipalAgendaSourceOutcome[] = [];
    let sourcesScraped = 0;
    let sourcesFailed = 0;
    let docsScanned = 0;
    let signalsCreated = 0;
    let signalsSuppressedHeuristics = 0;
    let leadsCreated = 0;
    let relationshipsCreated = 0;
    let ingestedTotal = 0;

    for (const source of due) {
      // Heartbeat between sources. If the lease was preempted (stale-cleanup
      // tool flipped status to "stale"), abort immediately — the dispatcher
      // will record this as a failed cycle and the next hour's run picks up.
      if (!(await ctx.heartbeat())) {
        throw new Error(`lease preempted mid-cycle after ${sourcesScraped} source(s)`);
      }

      try {
        const result = await scrapeOneSource(source.id, { runnerId: ctx.runnerId });
        sourcesScraped += 1;
        docsScanned                 += result.docsScanned;
        signalsCreated              += result.signalsCreated;
        signalsSuppressedHeuristics += result.signalsSuppressedHeuristics;
        leadsCreated                += result.leadsCreated;
        relationshipsCreated        += result.relationshipsCreated;
        ingestedTotal               += result.ingestion.ingested;
        recordRunnerSourceProcessed(MUNICIPAL_AGENDA_RUNNER_NAME);

        perSource.push({
          sourceId: source.id,
          ok: true,
          docsScanned: result.docsScanned,
          signalsCreated: result.signalsCreated,
          signalsSuppressed: result.signalsSuppressedHeuristics,
          leadsCreated: result.leadsCreated,
          relationshipsCreated: result.relationshipsCreated,
          ingested: result.ingestion.ingested,
          publishStatus: result.publishStatus,
          consecutiveEmptyRuns: result.consecutiveEmptyRuns,
        });
      } catch (err) {
        sourcesFailed += 1;
        const errorMessage = err instanceof Error ? err.message : String(err);
        recordRunnerScrapeFailure(MUNICIPAL_AGENDA_RUNNER_NAME);
        console.warn(`[${MUNICIPAL_AGENDA_RUNNER_NAME}] source ${source.id} failed:`, errorMessage);
        perSource.push({
          sourceId: source.id,
          ok: false,
          docsScanned: 0,
          signalsCreated: 0,
          signalsSuppressed: 0,
          leadsCreated: 0,
          relationshipsCreated: 0,
          ingested: 0,
          publishStatus: source.publishStatus,
          consecutiveEmptyRuns: 0,
          errorMessage,
        });
        // continue — one failure does not poison the cycle
      }
    }

    // Snapshot the unhealthy-source population for operator visibility.
    // Cheap COUNT queries on the indexed publishStatus column.
    const [staleSourceCount, operatorReviewCount] = await Promise.all([
      countSourcesByPublishStatus("STALE_PUBLISH"),
      countSourcesByPublishStatus("OPERATOR_REVIEW"),
    ]);
    setRunnerStaleSourceCount("STALE_PUBLISH", staleSourceCount);
    setRunnerStaleSourceCount("OPERATOR_REVIEW", operatorReviewCount);

    return {
      dueSourcesFound: due.length,
      sourcesScraped,
      sourcesFailed,
      docsScanned,
      signalsCreated,
      signalsSuppressedHeuristics,
      leadsCreated,
      relationshipsCreated,
      ingestedTotal,
      staleSourceCount,
      operatorReviewCount,
      perSource,
    };
  },
});
