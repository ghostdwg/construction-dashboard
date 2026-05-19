import { prisma } from "@/lib/prisma";
import { callSidecarScrape, persistSidecarPayload } from "@/lib/services/marketIntelligence/sidecarMarket";

// Auth: this route runs unattended by an internal worker. The shared
// WORKER_TOKEN env var must match the X-Worker-Token header. If unset,
// the route is disabled.
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

export const maxDuration = 1800; // 30 min — Ollama-prefiltered scrapes can be slow

type OverrideParams = {
  dateFrom: string | null;
  dateTo: string | null;
  maxDocs: number | null;
  includeUndated: boolean | null;
  prefilterMode: "off" | "large" | "always" | null;
  prefilterModel: string | null;
};

function parseOverrides(s: string | null): Partial<OverrideParams> {
  if (!s) return {};
  try { return JSON.parse(s) as Partial<OverrideParams>; } catch { return {}; }
}

function toIso(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return d.toISOString().slice(0, 10);
}

async function runMarketScrape(jobId: string): Promise<{ ok: boolean; summary: string }> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, summary: "job not found" };
  if (!job.relatedId) return { ok: false, summary: "missing relatedId (sourceId)" };

  const source = await prisma.marketSource.findUnique({ where: { id: job.relatedId } });
  if (!source) return { ok: false, summary: "source not found" };
  if (!source.isActive) return { ok: false, summary: "source inactive" };

  const overrides = parseOverrides(job.inputSummary);
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
  const prefilterMode = (overrides.prefilterMode ?? srcAny.prefilterMode ?? "off") as "off" | "large" | "always";
  const prefilterThreshold = srcAny.prefilterCharThreshold ?? 30000;
  const prefilterModel = overrides.prefilterModel ?? srcAny.prefilterModel ?? null;

  const scrape = await callSidecarScrape({
    sourceId: source.id,
    url: source.url,
    jurisdiction: source.jurisdiction,
    alreadySeen,
    maxDocs: overrides.maxDocs ?? undefined,
    dateFrom: overrides.dateFrom ?? toIso(source.dateFrom),
    dateTo:   overrides.dateTo   ?? toIso(source.dateTo),
    includeUndated: overrides.includeUndated ?? false,
    prefilterMode,
    prefilterThreshold,
    prefilterModel,
  });

  const tuning = {
    minRelevanceScore: source.minRelevanceScore ?? 60,
    minEstimatedValue: source.minEstimatedValue ?? null,
    projectTypeAllowlist: source.projectTypeAllowlist ?? null,
  };

  let signalsCreated = 0;
  let leadsCreated = 0;

  for (const doc of scrape.results) {
    const docDate =
      doc.document_date && !Number.isNaN(Date.parse(doc.document_date))
        ? new Date(doc.document_date)
        : null;

    const docRow = await prisma.marketSourceDoc.upsert({
      where: { sourceId_docUrl: { sourceId: source.id, docUrl: doc.doc_url } },
      update: {
        docUrlFull: doc.doc_url_full,
        title: doc.title ?? null,
        scannedAt: new Date(),
        signalsFound: 0,
        jurisdiction: doc.jurisdiction ?? source.jurisdiction,
        documentDate: docDate,
        rawText: doc.raw_text ?? null,
        charCount: doc.char_count ?? 0,
        costUsd: doc.cost_usd,
        error: doc.error ?? null,
      },
      create: {
        sourceId: source.id,
        docUrl: doc.doc_url,
        docUrlFull: doc.doc_url_full,
        title: doc.title ?? null,
        signalsFound: 0,
        jurisdiction: doc.jurisdiction ?? source.jurisdiction,
        documentDate: docDate,
        rawText: doc.raw_text ?? null,
        charCount: doc.char_count ?? 0,
        costUsd: doc.cost_usd,
        error: doc.error ?? null,
      },
    });

    if (doc.error) continue;

    const counts = await persistSidecarPayload({
      signals: doc.signals, relationships: doc.relationships,
      jurisdiction: doc.jurisdiction, documentDate: doc.document_date,
      sourceUrl: doc.doc_url_full, sourceLabel: source.name,
      sourceDocId: docRow.id, tuning,
    });
    signalsCreated += counts.signalsCreated;
    leadsCreated   += counts.leadsCreated;

    await prisma.marketSourceDoc.update({
      where: { id: docRow.id },
      data: { signalsFound: counts.signalsCreated },
    });
  }

  await prisma.marketSource.update({
    where: { id: source.id },
    data: { lastScannedAt: new Date(), docsProcessed: { increment: scrape.docs_scanned } },
  });

  return {
    ok: true,
    summary: `scanned ${scrape.docs_scanned}/${scrape.docs_found} docs · ` +
      `${signalsCreated} signals · ${leadsCreated} leads · $${scrape.total_cost_usd.toFixed(3)}`,
  };
}

export async function POST(request: Request) {
  if (!WORKER_TOKEN) {
    return Response.json({ error: "WORKER_TOKEN not configured" }, { status: 503 });
  }
  if (request.headers.get("x-worker-token") !== WORKER_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.backgroundJob.findMany({
    where: {
      status: "queued",
      OR: [{ runAfter: null }, { runAfter: { lte: now } }],
      jobType: { in: ["market_scrape"] },
    },
    orderBy: { createdAt: "asc" },
    take: 5,   // bound per-tick work
  });

  const results: Array<{ jobId: string; status: string; summary: string }> = [];

  for (const job of due) {
    // Mark running atomically
    try {
      await prisma.backgroundJob.update({
        where: { id: job.id, status: "queued" },
        data:  { status: "running", startedAt: new Date() },
      });
    } catch {
      continue; // another worker grabbed it
    }

    try {
      let outcome: { ok: boolean; summary: string };
      if (job.jobType === "market_scrape") {
        outcome = await runMarketScrape(job.id);
      } else {
        outcome = { ok: false, summary: "unknown jobType: " + job.jobType };
      }

      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: outcome.ok ? "completed" : "failed",
          completedAt: new Date(),
          resultSummary: outcome.summary.slice(0, 500),
          errorMessage: outcome.ok ? null : outcome.summary.slice(0, 500),
          activeSlot: null,
        },
      });
      results.push({ jobId: job.id, status: outcome.ok ? "completed" : "failed", summary: outcome.summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "failed", completedAt: new Date(),
          errorMessage: msg.slice(0, 500), activeSlot: null,
        },
      });
      results.push({ jobId: job.id, status: "failed", summary: msg });
    }
  }

  return Response.json({ processed: results.length, results });
}

export async function GET(request: Request) {
  // Health endpoint for the worker to confirm reachability
  if (!WORKER_TOKEN) return Response.json({ enabled: false });
  const authed = request.headers.get("x-worker-token") === WORKER_TOKEN;
  if (!authed) return Response.json({ enabled: true });
  const queued = await prisma.backgroundJob.count({
    where: { status: "queued", jobType: "market_scrape" },
  });
  return Response.json({ enabled: true, queued });
}
