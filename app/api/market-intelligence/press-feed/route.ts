/**
 * Press feed route — proxies sidecar /market/press-feed and persists items as
 * MarketSignal rows with signalType=MEETING_MINUTE (placeholder) and
 * signalSubtype=OTHER. Tags source as the press outlet.
 */

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export const maxDuration = 120;

type PressItem = {
  title: string;
  url: string;
  published_at: string | null;
  summary: string;
  source: string;
  location_hint: string | null;
  dollar_hint: number | null;
  company_hint: string | null;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const sources: string[] | undefined = Array.isArray(body?.sources) ? body.sources : undefined;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  const res = await fetch(`${SIDECAR_URL}/market/press-feed`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sources: sources ?? ["governor", "ieda", "partnership_pr", "business_record"] }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return Response.json({ error: `sidecar failed: ${res.status} ${txt.slice(0, 300)}` }, { status: 502 });
  }
  const data = await res.json() as {
    items: PressItem[];
    sources_polled: string[];
    sources_failed: string[];
  };

  let created = 0;
  let skipped = 0;

  for (const it of data.items) {
    // Dedup by URL
    const existing = await prisma.marketSignal.findFirst({
      where: { sourceUrl: it.url, signalType: "MEETING_MINUTE" },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    const publishedDate = it.published_at && !Number.isNaN(Date.parse(it.published_at))
      ? new Date(it.published_at)
      : null;

    await prisma.marketSignal.create({
      data: {
        signalType: "MEETING_MINUTE",
        signalSubtype: "OTHER",
        source: it.source,
        sourceUrl: it.url,
        sourceDate: publishedDate,
        headline: it.title.slice(0, 200),
        rawText: it.summary.slice(0, 1000),
        metadata: JSON.stringify({
          source_outlet: it.source,
          location_hint: it.location_hint,
          dollar_hint: it.dollar_hint,
          company_hint: it.company_hint,
          provenance: "press_release",
        }),
        // Stage-1 signals get a low default relevance (45) — they're rumor-tier
        // until corroborated by Stage 2+ signals. Tune later.
        aiRelevanceScore: 45,
      },
    });
    created++;
  }

  return Response.json({
    polled: data.sources_polled,
    failed: data.sources_failed,
    fetched: data.items.length,
    created,
    skipped,
  });
}

export async function GET() {
  // Convenience — call from a cron or button without a body
  return POST(new Request("http://internal", { method: "POST", body: JSON.stringify({}) }));
}
