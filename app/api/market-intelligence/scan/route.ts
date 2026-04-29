// POST /api/market-intelligence/scan
//
// Feeds a URL or raw text to the sidecar market scanner.
// Creates MarketSignal records for each extracted item.
// Signals with relevance >= 65 are auto-grouped into MarketLead records.
// GC/sub/architect relationships are saved as RelationshipEdge records.
//
// Body: { url?: string, text?: string, jurisdiction?: string, sourceDate?: string }

import { prisma } from "@/lib/prisma";

const SIDECAR_URL     = process.env.SIDECAR_URL     ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

const LEAD_THRESHOLD = 65; // signals above this score auto-create a lead

type SidecarSignal = {
  signal_type: string;
  headline: string;
  description?: string;
  location?: string;
  estimated_value?: number;
  project_type?: string;
  owner_name?: string;
  architect_name?: string;
  gc_names?: string[];
  sub_names?: string[];
  relevance_score?: number;
  status?: string;
};

type SidecarRelationship = {
  from_type: string;
  from_name: string;
  to_type: string;
  to_name: string;
  relationship_type: string;
  project_name?: string;
  project_value?: number;
  confidence?: string;
};

type SidecarResponse = {
  signals_found: number;
  relationships_found: number;
  jurisdiction?: string;
  document_date?: string;
  signals: SidecarSignal[];
  relationships: SidecarRelationship[];
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    url?: string;
    text?: string;
    jurisdiction?: string;
    sourceDate?: string;
  } | null;

  if (!body?.url && !body?.text) {
    return Response.json({ error: "Provide url or text" }, { status: 400 });
  }

  // Call sidecar scanner
  let sidecar: SidecarResponse;
  try {
    const res = await fetch(`${SIDECAR_URL}/market/scan-document`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({
        url:          body.url ?? null,
        text:         body.text ?? null,
        jurisdiction: body.jurisdiction ?? null,
        source_date:  body.sourceDate ?? null,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar ${res.status}` })) as { detail?: string };
      return Response.json({ error: err.detail ?? "Sidecar error" }, { status: 502 });
    }
    sidecar = await res.json() as SidecarResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Sidecar unavailable: ${msg}` }, { status: 503 });
  }

  const jurisdiction = body.jurisdiction || sidecar.jurisdiction || null;
  const sourceDate   = body.sourceDate
    ? new Date(body.sourceDate)
    : sidecar.document_date
      ? new Date(sidecar.document_date)
      : null;
  const source = body.url ? "city_hall" : "manual";

  let signalsCreated     = 0;
  let leadsCreated       = 0;
  let relationshipsCreated = 0;

  // ── Signals + auto-leads ──────────────────────────────────────────────────
  for (const sig of sidecar.signals) {
    const score = sig.relevance_score ?? 0;

    const metadata: Record<string, unknown> = {};
    if (sig.project_type)  metadata.project_type  = sig.project_type;
    if (sig.owner_name)    metadata.owner_name     = sig.owner_name;
    if (sig.architect_name)metadata.architect_name = sig.architect_name;
    if (sig.gc_names?.length)  metadata.gc_names   = sig.gc_names;
    if (sig.sub_names?.length) metadata.sub_names  = sig.sub_names;
    if (sig.status)        metadata.status         = sig.status;

    // Auto-create lead for high-score signals
    let leadId: string | null = null;
    if (score >= LEAD_THRESHOLD) {
      const lead = await prisma.marketLead.create({
        data: {
          title:          sig.headline,
          leadType:       "MEETING_MINUTE",
          source,
          sourceUrl:      body.url ?? null,
          status:         "NEW",
          confidence:     score >= 80 ? "HIGH" : "MEDIUM",
          aiScore:        score,
          location:       sig.location ?? null,
          jurisdiction,
          projectType:    sig.project_type ?? null,
          estimatedValue: sig.estimated_value ?? null,
          aiSummary:      sig.description ?? null,
          rawText:        sig.description ?? null,
        },
      });
      leadId = lead.id;
      leadsCreated++;
    }

    await prisma.marketSignal.create({
      data: {
        leadId,
        signalType:       sig.signal_type || "MEETING_MINUTE",
        source,
        sourceUrl:        body.url ?? null,
        sourceDate:       sourceDate ?? (sig.relevance_score != null ? undefined : undefined),
        headline:         sig.headline,
        rawText:          sig.description ?? null,
        metadata:         Object.keys(metadata).length ? JSON.stringify(metadata) : null,
        aiRelevanceScore: score,
      },
    });
    signalsCreated++;
  }

  // ── Relationship edges ────────────────────────────────────────────────────
  const VALID_FROM_TYPES = new Set(["GC","ARCHITECT","OWNER","DEVELOPER","ENGINEER","SUB","BROKER"]);
  const VALID_REL_TYPES  = new Set(["BUILT","DESIGNED","PARTNERED","OWNED","COMPETING"]);

  for (const rel of sidecar.relationships) {
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
        location:         jurisdiction ?? null,
        source,
        sourceUrl:        body.url ?? null,
        confidence:       rel.confidence ?? "MEDIUM",
      },
    });
    relationshipsCreated++;
  }

  return Response.json({
    ok: true,
    signalsCreated,
    leadsCreated,
    relationshipsCreated,
    jurisdiction,
    documentDate:  sidecar.document_date ?? null,
    costUsd:       sidecar.cost_usd,
    inputTokens:   sidecar.input_tokens,
    outputTokens:  sidecar.output_tokens,
  });
}
