// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/scrapeOneSource.ts
//  Phase O2.2 PR1 — Shared scrape service + live-ingestion bridge.
//
//  Closes the "cold rows" problem: today the HTTP scrape route persists
//  sidecar payloads via persistSidecarPayload() but never calls the
//  liveIngestion entry points (processNewMarketSignal etc.). Rows land in
//  the DB and the neuroglitch_ingestion_processed_total counter stays at 0.
//
//  This service:
//    1. Executes the same scrape pipeline the HTTP route used to run inline.
//    2. Collects the IDs of freshly-created MarketSignal / MarketLead /
//       RelationshipEdge rows (PersistResult / EnergovScrapeResult now
//       expose them — see sidecarMarket.ts + energovAdapter.ts).
//    3. Bridges each created row to liveIngestion, sequentially, with
//       per-row try/catch. A liveIngestion failure does NOT undo the
//       MarketSignal write — the row is already durable.
//    4. Increments the neuroglitch_ingestion_processed_total counter from
//       this boundary (liveIngestion itself does not call the metric, by
//       design for this PR — see o2.1-first-bloodstream.md §1.3).
//    5. Emits a single-line JSON audit on completion.
//
//  Both the existing HTTP route and the future municipal-agenda-ingestion
//  runner (PR-5) call scrapeOneSource — single source of truth.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  processNewMarketLead,
  processNewMarketSignal,
  processNewRelationshipEdge,
  type IngestionResult,
  type IngestionSourceKind,
} from "@/lib/services/liveIngestion";
import {
  recordIngestionProcessed,
  recordIngestionDuration,
  recordIngestionPipelineError,
} from "@/lib/observability";
import {
  callSidecarScrape,
  persistSidecarPayload,
  type PersistResult,
} from "./sidecarMarket";
import { scrapeEnergovSource } from "./energovAdapter";
import {
  buildHeuristicsContext,
  computeDocPacketHash,
} from "./heuristicsContext";
import {
  recordDocDate,
  recomputeCadence,
  recordRunOutcome,
} from "./sourceCadence";
import type { SignalClassification, SignalContext } from "./signalHeuristics";

// ── Public types ────────────────────────────────────────────────────────────

export interface ScrapeOverride {
  dateFrom?: string;
  dateTo?: string;
  maxDocs?: number;
  includeUndated?: boolean;
  prefilterMode?: "off" | "large" | "always";
  prefilterThreshold?: number;
  prefilterModel?: string | null;
  /** EnerGov-only: caps records pulled per call. Ignored for sidecar sources. */
  maxRecords?: number;
}

export interface ScrapeOneSourceOptions extends ScrapeOverride {
  /** Optional correlation id from a runner cycle. Threaded into ingestion
   *  audits for cross-tier tracing. */
  runnerId?: string;
  /** Optional operator attribution. Threaded into ingestion audits. */
  actor?: { userId: string | null; email: string | null };
  /** O2.2 PR3: bypass the deterministic heuristic classifier entirely.
   *  Useful for debugging or operator-driven backfill where the historical
   *  context is intentionally empty. When true: NO signals are suppressed
   *  by heuristics, NO heuristics columns are written, and the
   *  signalsSuppressedHeuristics counter stays at 0. */
  skipHeuristics?: boolean;
}

export interface IngestionSummary {
  /** Count of liveIngestion calls that returned ok=true (any decision). */
  ingested: number;
  /** Sub-counts by source kind. */
  bySourceKind: Record<IngestionSourceKind, number>;
  /** Decision distribution across all successful calls. */
  decisions: Record<string, number>;
  /** Count of liveIngestion calls that threw or returned ok=false. */
  failed: number;
  /** Failure detail (capped at 25 entries so a runaway can't blow the result). */
  failures: Array<{ sourceKind: IngestionSourceKind; sourceId: string; error: string }>;
}

export interface ScrapeOneSourceResult {
  /** Which adapter handled the scrape. */
  engine: "sidecar" | "energov";
  sourceId: string;

  // ── Scrape stage (mirrors the prior HTTP response shape) ──────────────────
  docsFound: number;
  docsInRange: number;
  docsScanned: number;
  docsSkipped: number;
  docsDroppedDate: number;
  docsDroppedUndated: number;
  docsPrefilterApplied?: number;
  docsPrefilterSkipped?: number;
  docsPrefilterFailed?: number;
  totalCharsSaved?: number;
  signalsCreated: number;
  leadsCreated: number;
  relationshipsCreated: number;
  signalsDroppedRelevance: number;
  signalsDroppedProjectType: number;
  leadsDroppedValue: number;
  totalCostUsd: number;

  // ── O2.2 PR3: hygiene + cadence stage ─────────────────────────────────────
  signalsSuppressedHeuristics: number;
  classifiedByBand: Partial<Record<SignalClassification, number>>;
  /** Source's publishStatus AFTER this run (HEALTHY | STALE_PUBLISH | OPERATOR_REVIEW). */
  publishStatus: string;
  /** consecutive empty runs AFTER this run. */
  consecutiveEmptyRuns: number;
  /** Whether buildHeuristicsContext was actually called (false when skipHeuristics). */
  heuristicsApplied: boolean;

  // ── Ingestion bridge stage ────────────────────────────────────────────────
  ingestion: IngestionSummary;
}

// ── Audit ───────────────────────────────────────────────────────────────────

interface ScrapeBridgeAudit {
  timestamp: string;
  sourceId: string;
  engine: "sidecar" | "energov";
  signalsCreated: number;
  leadsCreated: number;
  relationshipsCreated: number;
  signalsSuppressedHeuristics: number;
  publishStatus: string;
  consecutiveEmptyRuns: number;
  ingested: number;
  failed: number;
  /** PR6: per-failure detail (capped, mirrors result.ingestion.failures).
   *  Surfacing in the audit line means operators don't have to grep stdout
   *  to find which row failed. Loki-queryable. */
  failures: IngestionSummary["failures"];
  durationMs: number;
  runnerId: string | null;
}

const AUDIT_PREFIX = "[scrape-bridge]";

function emitScrapeBridgeAudit(audit: ScrapeBridgeAudit): void {
  if (process.env.SCRAPE_BRIDGE_AUDIT_QUIET === "true") return;
  console.info(`${AUDIT_PREFIX} ${JSON.stringify(audit)}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toIsoDate(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return d.toISOString().slice(0, 10);
}

function emptyIngestionSummary(): IngestionSummary {
  return {
    ingested: 0,
    bySourceKind: { MARKET_SIGNAL: 0, MARKET_LEAD: 0, RELATIONSHIP_EDGE: 0 },
    decisions: {},
    failed: 0,
    failures: [],
  };
}

function tallyResult(summary: IngestionSummary, result: IngestionResult): void {
  if (result.ok) {
    summary.ingested += 1;
    summary.bySourceKind[result.sourceKind] += 1;
    summary.decisions[result.decision] = (summary.decisions[result.decision] ?? 0) + 1;
    recordIngestionProcessed(result.sourceKind, result.decision);
  } else {
    summary.failed += 1;
    if (summary.failures.length < 25) {
      summary.failures.push({
        sourceKind: result.sourceKind,
        sourceId: result.sourceId,
        error: result.error ?? "liveIngestion returned ok=false without error message",
      });
    }
    recordIngestionPipelineError(`scrape_bridge:${result.sourceKind}`);
  }
}

function tallyThrow(
  summary: IngestionSummary,
  sourceKind: IngestionSourceKind,
  sourceId: string,
  err: unknown,
): void {
  summary.failed += 1;
  const message = err instanceof Error ? err.message : String(err);
  if (summary.failures.length < 25) {
    summary.failures.push({ sourceKind, sourceId, error: message });
  }
  recordIngestionPipelineError(`scrape_bridge:${sourceKind}`);
  console.warn(`[scrape-bridge] ${sourceKind} ${sourceId} ingestion threw:`, message);
}

async function bridgeOne(
  kind: IngestionSourceKind,
  id: string,
  summary: IngestionSummary,
  opts: ScrapeOneSourceOptions,
): Promise<void> {
  const start = Date.now();
  try {
    const result =
      kind === "MARKET_SIGNAL"
        ? await processNewMarketSignal(id, { actor: opts.actor })
        : kind === "MARKET_LEAD"
          ? await processNewMarketLead(id, { actor: opts.actor })
          : await processNewRelationshipEdge(id, { actor: opts.actor });
    tallyResult(summary, result);
  } catch (err) {
    tallyThrow(summary, kind, id, err);
  } finally {
    recordIngestionDuration(kind, (Date.now() - start) / 1000);
  }
}

async function bridgeIngestion(
  createdSignalIds: string[],
  createdLeadIds: string[],
  createdEdgeIds: string[],
  opts: ScrapeOneSourceOptions,
): Promise<IngestionSummary> {
  const summary = emptyIngestionSummary();
  for (const id of createdSignalIds) await bridgeOne("MARKET_SIGNAL", id, summary, opts);
  for (const id of createdLeadIds)   await bridgeOne("MARKET_LEAD",   id, summary, opts);
  for (const id of createdEdgeIds)   await bridgeOne("RELATIONSHIP_EDGE", id, summary, opts);
  return summary;
}

// ── EnerGov branch ──────────────────────────────────────────────────────────

async function scrapeEnergov(
  sourceId: string,
  options: ScrapeOneSourceOptions,
): Promise<ScrapeOneSourceResult> {
  const source = await prisma.marketSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new ScrapeOneSourceError("not_found", `MarketSource ${sourceId} not found`);
  if (!source.isActive) throw new ScrapeOneSourceError("inactive", `MarketSource ${sourceId} is inactive`);

  const energov = await scrapeEnergovSource({
    sourceId: source.id,
    baseUrl: source.url,
    sourceName: source.name,
    jurisdiction: source.jurisdiction,
    dateFrom: options.dateFrom ?? toIsoDate(source.dateFrom),
    dateTo:   options.dateTo   ?? toIsoDate(source.dateTo),
    maxRecords: options.maxRecords ?? 500,
  });

  await prisma.marketSource.update({
    where: { id: source.id },
    data: { lastScannedAt: new Date(), docsProcessed: { increment: energov.docsScanned } },
  });

  // O2.2 PR3: EnerGov has no agenda-style docs, so we skip recordDocDate +
  // recomputeCadence (cadence learning is meaningful only for periodic
  // publishing patterns). We still call recordRunOutcome so dormancy
  // detection works — if an EnerGov source goes 3 empty cycles, it flips
  // to STALE_PUBLISH and stops being polled.
  const foundNewDocs = energov.signalsCreated > 0 || energov.leadsCreated > 0;
  const runOutcome = await recordRunOutcome(source.id, foundNewDocs);

  const ingestion = await bridgeIngestion(
    energov.createdSignalIds,
    energov.createdLeadIds,
    /* createdEdgeIds */ [],
    options,
  );

  return {
    engine: "energov",
    sourceId: source.id,
    docsFound: energov.rawRecordsReturned,
    docsInRange: energov.docsScanned,
    docsScanned: energov.docsScanned,
    docsSkipped: 0,
    docsDroppedDate: 0,
    docsDroppedUndated: 0,
    signalsCreated: energov.signalsCreated,
    leadsCreated: energov.leadsCreated,
    relationshipsCreated: 0,
    signalsDroppedRelevance: 0,
    signalsDroppedProjectType: 0,
    leadsDroppedValue: 0,
    totalCostUsd: 0,
    // EnerGov bypass: signals are persisted directly by scrapeEnergovSource
    // (which has no notion of the deterministic classifier yet). Heuristics
    // are not applied here in PR3. Tracked as a follow-up; PR3 scope is
    // agenda-style sources.
    signalsSuppressedHeuristics: 0,
    classifiedByBand: {},
    publishStatus: runOutcome.publishStatus,
    consecutiveEmptyRuns: runOutcome.consecutiveEmptyRuns,
    heuristicsApplied: false,
    ingestion,
  };
}

// ── Sidecar (Claude/Ollama) branch ─────────────────────────────────────────

async function scrapeSidecar(
  sourceId: string,
  options: ScrapeOneSourceOptions,
): Promise<ScrapeOneSourceResult> {
  const source = await prisma.marketSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new ScrapeOneSourceError("not_found", `MarketSource ${sourceId} not found`);
  if (!source.isActive) throw new ScrapeOneSourceError("inactive", `MarketSource ${sourceId} is inactive`);

  const seen = await prisma.marketSourceDoc.findMany({
    where: { sourceId: source.id },
    select: { docUrl: true },
  });
  const alreadySeen = seen.map((d) => d.docUrl);

  type MaybePrefilter = {
    prefilterMode?: string;
    prefilterCharThreshold?: number;
    prefilterModel?: string | null;
  };
  const srcAny = source as typeof source & MaybePrefilter;
  const prefilterMode = (options.prefilterMode ?? srcAny.prefilterMode ?? "off") as "off" | "large" | "always";
  const prefilterThreshold = options.prefilterThreshold ?? srcAny.prefilterCharThreshold ?? 30000;
  const prefilterModel = options.prefilterModel ?? srcAny.prefilterModel ?? null;

  const scrape = await callSidecarScrape({
    sourceId: source.id,
    url: source.url,
    jurisdiction: source.jurisdiction,
    alreadySeen,
    maxDocs: options.maxDocs,
    dateFrom: options.dateFrom ?? toIsoDate(source.dateFrom),
    dateTo:   options.dateTo   ?? toIsoDate(source.dateTo),
    includeUndated: options.includeUndated ?? false,
    prefilterMode,
    prefilterThreshold,
    prefilterModel,
  });

  const tuning = {
    minRelevanceScore:    source.minRelevanceScore ?? 60,
    minEstimatedValue:    source.minEstimatedValue ?? null,
    projectTypeAllowlist: source.projectTypeAllowlist ?? null,
  };

  // ── O2.2 PR3: build heuristic context ONCE per source ────────────────────
  // Five bounded SELECTs. Reused across all docs in this source's batch so
  // the classifier sees consistent recurrence history across the run.
  // The newly-persisted signals from THIS run do NOT enter the context —
  // ensures DUPLICATE_CONTINUANCE / DUPLICATE_PACKET can't flag a signal
  // against itself.
  let heuristicsContext: SignalContext | undefined;
  if (!options.skipHeuristics) {
    heuristicsContext = await buildHeuristicsContext(source.id);
  }

  let signalsCreated = 0;
  let leadsCreated = 0;
  let relationshipsCreated = 0;
  let signalsDroppedRelevance = 0;
  let signalsDroppedProjectType = 0;
  let leadsDroppedValue = 0;
  let signalsSuppressedHeuristics = 0;
  const classifiedByBand: Partial<Record<SignalClassification, number>> = {};
  const allCreatedSignalIds: string[] = [];
  const allCreatedLeadIds: string[] = [];
  const allCreatedEdgeIds: string[] = [];
  const newDocDates: Date[] = [];

  for (const doc of scrape.results) {
    const docDate =
      doc.document_date && !Number.isNaN(Date.parse(doc.document_date))
        ? new Date(doc.document_date)
        : null;

    // Upsert MarketSourceDoc first so signals/leads can be tied to it.
    const docRow = await prisma.marketSourceDoc.upsert({
      where: { sourceId_docUrl: { sourceId: source.id, docUrl: doc.doc_url } },
      update: {
        docUrlFull: doc.doc_url_full,
        title:      doc.title ?? null,
        scannedAt:  new Date(),
        signalsFound: 0,
        jurisdiction: doc.jurisdiction ?? source.jurisdiction,
        documentDate: docDate,
        rawText:    doc.raw_text ?? null,
        charCount:  doc.char_count ?? 0,
        costUsd:    doc.cost_usd,
        error:      doc.error ?? null,
      },
      create: {
        sourceId:   source.id,
        docUrl:     doc.doc_url,
        docUrlFull: doc.doc_url_full,
        title:      doc.title ?? null,
        signalsFound: 0,
        jurisdiction: doc.jurisdiction ?? source.jurisdiction,
        documentDate: docDate,
        rawText:    doc.raw_text ?? null,
        charCount:  doc.char_count ?? 0,
        costUsd:    doc.cost_usd,
        error:      doc.error ?? null,
      },
    });

    if (doc.error) continue;

    // O2.2 PR3: per-doc packet hash for DUPLICATE_PACKET detection.
    const docPacketHash = doc.raw_text && doc.raw_text.length > 0
      ? computeDocPacketHash(doc.raw_text)
      : null;

    let persist: PersistResult | null = null;
    try {
      persist = await persistSidecarPayload({
        signals: doc.signals,
        relationships: doc.relationships,
        jurisdiction: doc.jurisdiction,
        documentDate: doc.document_date,
        sourceUrl: doc.doc_url_full,
        sourceLabel: source.name,
        sourceDocId: docRow.id,
        tuning,
        skipHeuristics: options.skipHeuristics ?? false,
        heuristicsContext,
        docPacketHash,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.marketSourceDoc.update({
        where: { id: docRow.id },
        data: { error: message },
      });
      continue;
    }

    signalsCreated              += persist.signalsCreated;
    leadsCreated                += persist.leadsCreated;
    relationshipsCreated        += persist.relationshipsCreated;
    signalsDroppedRelevance     += persist.signalsDroppedRelevance;
    signalsDroppedProjectType   += persist.signalsDroppedProjectType;
    leadsDroppedValue           += persist.leadsDroppedValue;
    signalsSuppressedHeuristics += persist.signalsSuppressedHeuristics;
    for (const [band, count] of Object.entries(persist.classifiedByBand)) {
      const key = band as SignalClassification;
      classifiedByBand[key] = (classifiedByBand[key] ?? 0) + (count ?? 0);
    }
    allCreatedSignalIds.push(...persist.createdSignalIds);
    allCreatedLeadIds.push(...persist.createdLeadIds);
    allCreatedEdgeIds.push(...persist.createdEdgeIds);

    await prisma.marketSourceDoc.update({
      where: { id: docRow.id },
      data: { signalsFound: persist.signalsCreated },
    });

    // O2.2 PR3: append cadence sample for this doc.
    if (docDate) newDocDates.push(docDate);
  }

  await prisma.marketSource.update({
    where: { id: source.id },
    data: {
      lastScannedAt: new Date(),
      docsProcessed: { increment: scrape.docs_scanned },
    },
  });

  // ── O2.2 PR3: cadence updates ────────────────────────────────────────────
  for (const dt of newDocDates) {
    await recordDocDate(source.id, dt);
  }
  // recomputeCadence reads samples + writes back publishCadenceDays /
  // cadenceConfidence / cadenceSampleSize / lastDocSeenAt / nextExpectedAt.
  await recomputeCadence(source.id);

  // "Found new docs" = the scrape persisted at least one new MarketSourceDoc.
  // Note: docs_scanned counts docs the sidecar processed (already-seen are
  // excluded upstream by alreadySeen). signalsCreated alone would
  // false-negative on docs that legitimately had no extractable signals.
  const foundNewDocs = scrape.docs_scanned > 0;
  const runOutcome = await recordRunOutcome(source.id, foundNewDocs);

  const ingestion = await bridgeIngestion(
    allCreatedSignalIds,
    allCreatedLeadIds,
    allCreatedEdgeIds,
    options,
  );

  return {
    engine: "sidecar",
    sourceId: source.id,
    docsFound: scrape.docs_found,
    docsInRange: scrape.docs_in_range,
    docsScanned: scrape.docs_scanned,
    docsSkipped: scrape.docs_skipped,
    docsDroppedDate: scrape.docs_dropped_date,
    docsDroppedUndated: scrape.docs_dropped_undated,
    docsPrefilterApplied: scrape.docs_prefilter_applied,
    docsPrefilterSkipped: scrape.docs_prefilter_skipped,
    docsPrefilterFailed:  scrape.docs_prefilter_failed,
    totalCharsSaved:      scrape.total_chars_saved,
    signalsCreated,
    leadsCreated,
    relationshipsCreated,
    signalsDroppedRelevance,
    signalsDroppedProjectType,
    leadsDroppedValue,
    totalCostUsd: scrape.total_cost_usd,
    signalsSuppressedHeuristics,
    classifiedByBand,
    publishStatus: runOutcome.publishStatus,
    consecutiveEmptyRuns: runOutcome.consecutiveEmptyRuns,
    heuristicsApplied: !options.skipHeuristics,
    ingestion,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Typed error so callers can map to HTTP status codes without parsing strings.
 * `not_found` → 404, `inactive` → 400, `upstream` → 502, other → 500.
 */
export class ScrapeOneSourceError extends Error {
  constructor(public readonly kind: "not_found" | "inactive" | "upstream" | "internal", message: string) {
    super(message);
    this.name = "ScrapeOneSourceError";
  }
}

/**
 * Scrape a single MarketSource end-to-end, then bridge every freshly-created
 * MarketSignal / MarketLead / RelationshipEdge into liveIngestion.
 *
 * Idempotency: relies on the same dedup guarantees the manual path already
 * had — MarketSourceDoc `@@unique([sourceId, docUrl])` skips re-scraped docs,
 * and liveIngestion's `alreadyAttached` check skips already-bridged rows.
 *
 * Failure isolation: a liveIngestion error on one row does NOT undo the
 * MarketSignal write and does NOT stop the bridge from continuing through
 * the remaining IDs. Errors are tallied into the returned summary.
 */
export async function scrapeOneSource(
  sourceId: string,
  options: ScrapeOneSourceOptions = {},
): Promise<ScrapeOneSourceResult> {
  const start = Date.now();
  const source = await prisma.marketSource.findUnique({
    where: { id: sourceId },
    select: { id: true, sourceType: true, isActive: true },
  });
  if (!source) throw new ScrapeOneSourceError("not_found", `MarketSource ${sourceId} not found`);
  if (!source.isActive) throw new ScrapeOneSourceError("inactive", `MarketSource ${sourceId} is inactive`);

  let result: ScrapeOneSourceResult;
  try {
    result =
      source.sourceType === "energov"
        ? await scrapeEnergov(sourceId, options)
        : await scrapeSidecar(sourceId, options);
  } catch (err) {
    if (err instanceof ScrapeOneSourceError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ScrapeOneSourceError("upstream", message);
  }

  emitScrapeBridgeAudit({
    timestamp: new Date().toISOString(),
    sourceId,
    engine: result.engine,
    signalsCreated: result.signalsCreated,
    leadsCreated: result.leadsCreated,
    relationshipsCreated: result.relationshipsCreated,
    signalsSuppressedHeuristics: result.signalsSuppressedHeuristics,
    publishStatus: result.publishStatus,
    consecutiveEmptyRuns: result.consecutiveEmptyRuns,
    ingested: result.ingestion.ingested,
    failed: result.ingestion.failed,
    failures: result.ingestion.failures,
    durationMs: Date.now() - start,
    runnerId: options.runnerId ?? null,
  });

  return result;
}
