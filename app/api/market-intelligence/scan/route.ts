import { callSidecarScan, persistSidecarPayload } from "@/lib/services/marketIntelligence/sidecarMarket";

export async function POST(request: Request) {
  const body = await request.json();
  const url: string | undefined = body.url?.trim() || undefined;
  const text: string | undefined = body.text?.trim() || undefined;
  const jurisdiction: string | undefined = body.jurisdiction?.trim() || undefined;
  const sourceDate: string | undefined = body.sourceDate || undefined;

  if (!url && !text) {
    return Response.json({ error: "Provide url or text" }, { status: 400 });
  }

  let scan;
  try {
    scan = await callSidecarScan({ url, text, jurisdiction, sourceDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }

  const counts = await persistSidecarPayload({
    signals: scan.signals,
    relationships: scan.relationships,
    jurisdiction: scan.jurisdiction,
    documentDate: scan.document_date,
    sourceUrl: url ?? null,
    sourceLabel: "manual_scan",
    sourceDocId: null,
    tuning: undefined,
  });

  return Response.json({
    signalsCreated: counts.signalsCreated,
    leadsCreated: counts.leadsCreated,
    relationshipsCreated: counts.relationshipsCreated,
    jurisdiction: scan.jurisdiction,
    documentDate: scan.document_date,
    charCount: scan.char_count,
    costUsd: scan.cost_usd,
  });
}
