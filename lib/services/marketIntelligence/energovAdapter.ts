/**
 * EnerGov adapter — Next-side helper.
 *
 * Calls sidecar `/market/scrape-energov` and persists records as MarketSignal
 * rows. No Claude calls — EnerGov data is structured. Optional Tier 1
 * Ollama summary on the description field could go in a future pass.
 */

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export type EnergovScrapeResult = {
  docsScanned: number;
  signalsCreated: number;
  leadsCreated: number;
  highValueRecords: number;
  rawRecordsReturned: number;
  // O2.2 PR1: row IDs of freshly-created rows, exposed so the scrape bridge
  // can hand each one to liveIngestion. EnerGov never produces relationship
  // edges (structured permit data only), so no createdEdgeIds field.
  createdSignalIds: string[];
  createdLeadIds: string[];
};

type EnergovRecord = {
  permit_number: string;
  record_type: string;
  module: string;
  status: string;
  address: string | null;
  description: string;
  valuation: number | null;
  owner_name: string | null;
  contractor_name: string | null;
  applied_date: string | null;
  issued_date: string | null;
  source_keyword: string;
  source_url: string;
  raw_id: string | null;
};

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inferSubtype(module: string): string {
  if (module === "Plan") return "SITE_PLAN";
  if (module === "Permit") return "PERMIT_AWARD";
  if (module === "Project") return "OTHER";
  return "OTHER";
}

function tier0Relevance(rec: EnergovRecord): number {
  // Heuristic: higher relevance for higher valuation + commercial keywords
  let score = 50;
  const blob = (rec.description + " " + rec.permit_number).toLowerCase();
  if (/\b(commercial|shell|tenant improvement|warehouse|office|retail|industrial|hotel|restaurant)\b/.test(blob)) score += 25;
  if (/\b(multi family|multifamily|apartment|mixed use)\b/.test(blob)) score += 15;
  if (rec.valuation && rec.valuation >= 1_000_000) score += 20;
  else if (rec.valuation && rec.valuation >= 250_000) score += 10;
  if (rec.contractor_name) score += 5;
  return Math.min(100, score);
}

export async function scrapeEnergovSource(args: {
  sourceId: string;
  baseUrl: string;
  sourceName: string;
  jurisdiction: string;
  modules?: string[];
  keywords?: string[];
  dateFrom?: string;
  dateTo?: string;
  maxRecords?: number;
}): Promise<EnergovScrapeResult> {
  const res = await fetch(`${SIDECAR_URL}/market/scrape-energov`, {
    method: "POST",
    headers: sidecarHeaders(),
    body: JSON.stringify({
      base_url:    args.baseUrl,
      modules:     args.modules ?? ["Plan", "Permit"],
      date_from:   args.dateFrom,
      date_to:     args.dateTo,
      max_records: args.maxRecords ?? 500,
    }),
    signal: AbortSignal.timeout(580_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`EnerGov sidecar failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = await res.json() as {
    records: EnergovRecord[];
    stats: { commercial_records: number; high_value_records: number; raw_records_returned: number };
  };

  let signalsCreated = 0;
  let leadsCreated = 0;
  const createdSignalIds: string[] = [];
  const createdLeadIds: string[] = [];

  for (const rec of data.records) {
    const score = tier0Relevance(rec);
    const subtype = inferSubtype(rec.module);
    const sourceDate = parseISO(rec.applied_date) ?? parseISO(rec.issued_date);

    // Dedupe by permit_number across all signals for this source
    const existing = await prisma.marketSignal.findFirst({
      where: {
        source: args.sourceName,
        // EnerGov-specific dedup key — permit number in headline
        headline: { startsWith: rec.permit_number },
      },
      select: { id: true },
    });
    if (existing) continue;

    let leadId: string | null = null;
    const shouldCreateLead =
      score >= 70 &&
      rec.valuation !== null &&
      rec.valuation >= 250_000;

    if (shouldCreateLead) {
      const lead = await prisma.marketLead.create({
        data: {
          title: (rec.permit_number ? `${rec.permit_number} — ` : "") + rec.description.slice(0, 180),
          leadType: "PERMIT",
          source: args.sourceName,
          sourceUrl: rec.source_url,
          aiScore: score,
          confidence: score >= 85 ? "HIGH" : "MEDIUM",
          location: rec.address,
          jurisdiction: args.jurisdiction,
          projectType: rec.module.toLowerCase(),
          estimatedValue: rec.valuation,
          rawText: rec.description,
          aiSummary: rec.description.slice(0, 280),
          aiInsights: JSON.stringify({
            owner: rec.owner_name,
            contractor: rec.contractor_name,
            permit_number: rec.permit_number,
            module: rec.module,
            status: rec.status,
            source: "energov",
          }),
          detectedAt: sourceDate ?? new Date(),
        },
      });
      leadId = lead.id;
      leadsCreated += 1;
      createdLeadIds.push(lead.id);
    }

    const created = await prisma.marketSignal.create({
      data: {
        leadId,
        signalType: "PERMIT",
        signalSubtype: subtype,
        source: args.sourceName,
        sourceUrl: rec.source_url,
        sourceDate,
        headline: `${rec.permit_number} · ${rec.description.slice(0, 140)}`,
        rawText: rec.description,
        metadata: JSON.stringify({
          module: rec.module,
          status: rec.status,
          address: rec.address,
          valuation: rec.valuation,
          owner_name: rec.owner_name,
          contractor_name: rec.contractor_name,
          applied_date: rec.applied_date,
          issued_date: rec.issued_date,
          source: "energov",
          source_keyword: rec.source_keyword,
        }),
        aiRelevanceScore: score,
      },
    });
    signalsCreated += 1;
    createdSignalIds.push(created.id);
  }

  return {
    docsScanned: data.records.length,
    signalsCreated,
    leadsCreated,
    highValueRecords: data.stats.high_value_records,
    rawRecordsReturned: data.stats.raw_records_returned,
    createdSignalIds,
    createdLeadIds,
  };
}
