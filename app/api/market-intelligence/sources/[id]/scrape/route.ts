import { prisma } from "@/lib/prisma";
import { callSidecarScrape, persistSidecarPayload } from "@/lib/services/marketIntelligence/sidecarMarket";
import { scrapeEnergovSource } from "@/lib/services/marketIntelligence/energovAdapter";

function toIsoDate(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return d.toISOString().slice(0, 10);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const source = await prisma.marketSource.findUnique({ where: { id } });
  if (!source) {
    return Response.json({ error: "Source not found" }, { status: 404 });
  }
  if (!source.isActive) {
    return Response.json({ error: "Source is inactive" }, { status: 400 });
  }

  // EnerGov sources route to the structured-record adapter (no PDF, no Claude)
  if (source.sourceType === "energov") {
    let body: { dateFrom?: string; dateTo?: string; maxRecords?: number } = {};
    try {
      if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 0) {
        body = await request.json();
      }
    } catch { /* no body */ }

    try {
      const result = await scrapeEnergovSource({
        sourceId: source.id,
        baseUrl: source.url,
        sourceName: source.name,
        jurisdiction: source.jurisdiction,
        dateFrom: body.dateFrom ?? toIsoDate(source.dateFrom),
        dateTo:   body.dateTo   ?? toIsoDate(source.dateTo),
        maxRecords: body.maxRecords ?? 500,
      });
      await prisma.marketSource.update({
        where: { id: source.id },
        data: { lastScannedAt: new Date(), docsProcessed: { increment: result.docsScanned } },
      });
      return Response.json({
        docsFound:           result.rawRecordsReturned,
        docsInRange:         result.docsScanned,
        docsScanned:         result.docsScanned,
        docsSkipped:         0,
        docsDroppedDate:     0,
        docsDroppedUndated:  0,
        signalsCreated:      result.signalsCreated,
        leadsCreated:        result.leadsCreated,
        relationshipsCreated: 0,
        totalCostUsd:        0,
        engine:              "energov",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 502 });
    }
  }

  // Override knobs from request body (one-off scrape)
  type ScrapeOverride = {
    dateFrom?: string;
    dateTo?: string;
    maxDocs?: number;
    includeUndated?: boolean;
    prefilterMode?: "off" | "large" | "always";
    prefilterThreshold?: number;
    prefilterModel?: string | null;
  };
  let override: ScrapeOverride = {};
  try {
    if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 0) {
      override = (await request.json()) as ScrapeOverride;
    }
  } catch {
    override = {};
  }

  const seen = await prisma.marketSourceDoc.findMany({
    where: { sourceId: id },
    select: { docUrl: true },
  });
  const alreadySeen = seen.map((d) => d.docUrl);

  const dateFrom = override.dateFrom ?? toIsoDate(source.dateFrom);
  const dateTo   = override.dateTo   ?? toIsoDate(source.dateTo);

  type MaybePrefilter = {
    prefilterMode?: string;
    prefilterCharThreshold?: number;
    prefilterModel?: string | null;
  };
  const srcAny = source as typeof source & MaybePrefilter;
  const prefilterMode = (override.prefilterMode ?? srcAny.prefilterMode ?? "off") as "off" | "large" | "always";
  const prefilterThreshold = override.prefilterThreshold ?? srcAny.prefilterCharThreshold ?? 30000;
  const prefilterModel = (override as { prefilterModel?: string | null }).prefilterModel ?? srcAny.prefilterModel ?? null;

  let scrape;
  try {
    scrape = await callSidecarScrape({
      sourceId: source.id,
      url: source.url,
      jurisdiction: source.jurisdiction,
      alreadySeen,
      maxDocs: override.maxDocs,
      dateFrom,
      dateTo,
      includeUndated: override.includeUndated ?? false,
      prefilterMode,
      prefilterThreshold,
      prefilterModel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }

  const tuning = {
    minRelevanceScore:    source.minRelevanceScore ?? 60,
    minEstimatedValue:    source.minEstimatedValue ?? null,
    projectTypeAllowlist: source.projectTypeAllowlist ?? null,
  };

  let signalsCreated = 0;
  let leadsCreated = 0;
  let relationshipsCreated = 0;
  let signalsDroppedRelevance = 0;
  let signalsDroppedProjectType = 0;
  let leadsDroppedValue = 0;

  for (const doc of scrape.results) {
    const docDate =
      doc.document_date && !Number.isNaN(Date.parse(doc.document_date))
        ? new Date(doc.document_date)
        : null;

    // Upsert MarketSourceDoc FIRST so we have a stable id to attach signals/leads to.
    const docRow = await prisma.marketSourceDoc.upsert({
      where: { sourceId_docUrl: { sourceId: source.id, docUrl: doc.doc_url } },
      update: {
        docUrlFull: doc.doc_url_full,
        title:      doc.title ?? null,
        scannedAt:  new Date(),
        signalsFound: 0,    // reset; we increment after persist
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

    try {
      const counts = await persistSidecarPayload({
        signals: doc.signals,
        relationships: doc.relationships,
        jurisdiction: doc.jurisdiction,
        documentDate: doc.document_date,
        sourceUrl: doc.doc_url_full,
        sourceLabel: source.name,
        sourceDocId: docRow.id,
        tuning,
      });
      signalsCreated            += counts.signalsCreated;
      leadsCreated              += counts.leadsCreated;
      relationshipsCreated      += counts.relationshipsCreated;
      signalsDroppedRelevance   += counts.signalsDroppedRelevance;
      signalsDroppedProjectType += counts.signalsDroppedProjectType;
      leadsDroppedValue         += counts.leadsDroppedValue;

      await prisma.marketSourceDoc.update({
        where: { id: docRow.id },
        data: { signalsFound: counts.signalsCreated },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.marketSourceDoc.update({
        where: { id: docRow.id },
        data: { error: message },
      });
    }
  }

  await prisma.marketSource.update({
    where: { id: source.id },
    data: {
      lastScannedAt: new Date(),
      docsProcessed: { increment: scrape.docs_scanned },
    },
  });

  return Response.json({
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
  });
}
