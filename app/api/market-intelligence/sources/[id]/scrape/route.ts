// POST /api/market-intelligence/sources/[id]/scrape
//
// Triggers the sidecar scraper for a configured source.
// Loads already-processed doc URLs for dedup, calls sidecar, then
// persists new MarketSourceDoc rows, MarketSignal rows, RelationshipEdge rows,
// and auto-promotes high-score signals to MarketLead.

import { prisma } from "@/lib/prisma";

const SIDECAR_URL     = process.env.SIDECAR_URL     ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";
const LEAD_THRESHOLD  = 65;
const MAX_DOCS        = 5; // cap per scrape run

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

const VALID_FROM_TYPES = new Set(["GC","ARCHITECT","OWNER","DEVELOPER","ENGINEER","SUB","BROKER"]);
const VALID_REL_TYPES  = new Set(["BUILT","DESIGNED","PARTNERED","OWNED","COMPETING"]);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const source = await prisma.marketSource.findUnique({
    where: { id },
    include: { docs: { select: { docUrl: true } } },
  });
  if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
  if (!source.isActive) return Response.json({ error: "Source is disabled" }, { status: 400 });

  const alreadySeen = source.docs.map((d) => d.docUrl);

  // Call sidecar scraper
  let scraped: {
    docs_found: number; docs_scanned: number; docs_skipped: number;
    total_cost_usd: number;
    results: Array<{
      doc_url: string;
      signals: Array<{
        signal_type: string; headline: string; description?: string;
        location?: string; estimated_value?: number; project_type?: string;
        owner_name?: string; architect_name?: string;
        gc_names?: string[]; sub_names?: string[];
        relevance_score?: number; status?: string;
      }>;
      relationships: Array<{
        from_type: string; from_name: string; to_type: string; to_name: string;
        relationship_type: string; project_name?: string;
        project_value?: number; confidence?: string;
      }>;
      jurisdiction?: string; document_date?: string;
      cost_usd: number; input_tokens: number; output_tokens: number;
      error?: string;
    }>;
  };

  try {
    const res = await fetch(`${SIDECAR_URL}/market/scrape-source`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({
        source_id:    source.id,
        url:          source.url,
        jurisdiction: source.jurisdiction,
        already_seen: alreadySeen,
        max_docs:     MAX_DOCS,
      }),
      signal: AbortSignal.timeout(300_000), // 5 min — multiple docs
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar ${res.status}` })) as { detail?: string };
      return Response.json({ error: err.detail }, { status: 502 });
    }
    scraped = await res.json();
  } catch (err) {
    return Response.json({ error: `Sidecar unavailable: ${err}` }, { status: 503 });
  }

  // Persist results
  let totalSignals = 0;
  let totalLeads   = 0;
  let totalRels    = 0;

  for (const doc of scraped.results) {
    let sigCount  = 0;
    let leadCount = 0;

    if (!doc.error) {
      for (const sig of doc.signals) {
        const score = sig.relevance_score ?? 0;
        const meta: Record<string, unknown> = {};
        if (sig.project_type)   meta.project_type   = sig.project_type;
        if (sig.owner_name)     meta.owner_name      = sig.owner_name;
        if (sig.architect_name) meta.architect_name  = sig.architect_name;
        if (sig.gc_names?.length)  meta.gc_names     = sig.gc_names;
        if (sig.sub_names?.length) meta.sub_names    = sig.sub_names;
        if (sig.status)         meta.status          = sig.status;

        let leadId: string | null = null;
        if (score >= LEAD_THRESHOLD) {
          const lead = await prisma.marketLead.create({
            data: {
              title:          sig.headline,
              leadType:       "MEETING_MINUTE",
              source:         "city_hall",
              sourceUrl:      doc.doc_url,
              status:         "NEW",
              confidence:     score >= 80 ? "HIGH" : "MEDIUM",
              aiScore:        score,
              location:       sig.location ?? null,
              jurisdiction:   doc.jurisdiction ?? source.jurisdiction,
              projectType:    sig.project_type ?? null,
              estimatedValue: sig.estimated_value ?? null,
              aiSummary:      sig.description ?? null,
              rawText:        sig.description ?? null,
            },
          });
          leadId = lead.id;
          leadCount++;
        }

        await prisma.marketSignal.create({
          data: {
            leadId,
            signalType:       sig.signal_type || "MEETING_MINUTE",
            source:           "city_hall",
            sourceUrl:        doc.doc_url,
            sourceDate:       doc.document_date ? new Date(doc.document_date) : null,
            headline:         sig.headline,
            rawText:          sig.description ?? null,
            metadata:         Object.keys(meta).length ? JSON.stringify(meta) : null,
            aiRelevanceScore: score,
          },
        });
        sigCount++;
      }

      for (const rel of doc.relationships) {
        if (!rel.from_name?.trim() || !rel.to_name?.trim()) continue;
        if (!VALID_FROM_TYPES.has(rel.from_type) || !VALID_FROM_TYPES.has(rel.to_type)) continue;
        if (!VALID_REL_TYPES.has(rel.relationship_type)) continue;
        await prisma.relationshipEdge.create({
          data: {
            fromType:         rel.from_type,
            fromName:         rel.from_name.trim(),
            toType:           rel.to_type,
            toName:           rel.to_name.trim(),
            relationshipType: rel.relationship_type,
            projectName:      rel.project_name?.trim() ?? null,
            projectValue:     rel.project_value ?? null,
            location:         doc.jurisdiction ?? source.jurisdiction,
            source:           "city_hall",
            sourceUrl:        doc.doc_url,
            confidence:       rel.confidence ?? "MEDIUM",
          },
        });
        totalRels++;
      }
    }

    // Record this doc as processed (even on error, so we don't retry endlessly)
    await prisma.marketSourceDoc.upsert({
      where:  { docUrl: doc.doc_url },
      create: {
        sourceId:     source.id,
        docUrl:       doc.doc_url,
        docDate:      doc.document_date ? new Date(doc.document_date) : null,
        signalsFound: sigCount,
        leadsCreated: leadCount,
        costUsd:      doc.cost_usd,
      },
      update: {
        signalsFound: sigCount,
        leadsCreated: leadCount,
        costUsd:      doc.cost_usd,
        scannedAt:    new Date(),
      },
    });

    totalSignals += sigCount;
    totalLeads   += leadCount;
  }

  // Update source metadata
  await prisma.marketSource.update({
    where: { id },
    data: {
      lastScannedAt: new Date(),
      docsProcessed: { increment: scraped.docs_scanned },
    },
  });

  return Response.json({
    ok: true,
    docsFound:    scraped.docs_found,
    docsScanned:  scraped.docs_scanned,
    docsSkipped:  scraped.docs_skipped,
    signalsCreated: totalSignals,
    leadsCreated:   totalLeads,
    relationshipsCreated: totalRels,
    totalCostUsd: scraped.total_cost_usd,
  });
}
