import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["city_council", "planning_commission", "permit_feed", "rss"];

type Incoming = {
  name: string;
  jurisdiction: string;
  url: string;
  sourceType?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  minRelevanceScore?: number;
  minEstimatedValue?: number | null;
  projectTypeAllowlist?: string | null;
};

export async function POST(request: Request) {
  const body = await request.json();
  const sources: Incoming[] = Array.isArray(body?.sources) ? body.sources : [];
  if (sources.length === 0) {
    return Response.json({ error: "sources[] is required" }, { status: 400 });
  }
  if (sources.length > 100) {
    return Response.json({ error: "Max 100 sources per bulk request" }, { status: 400 });
  }

  const created: { id: string; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const s of sources) {
    if (!s.name?.trim() || !s.jurisdiction?.trim() || !s.url?.trim()) {
      skipped.push({ name: s.name ?? "(unnamed)", reason: "missing name/jurisdiction/url" });
      continue;
    }
    const sourceType = s.sourceType ?? "city_council";
    if (!VALID_TYPES.includes(sourceType)) {
      skipped.push({ name: s.name, reason: `invalid sourceType: ${sourceType}` });
      continue;
    }
    try { new URL(s.url); }
    catch { skipped.push({ name: s.name, reason: "invalid URL" }); continue; }

    // Dedup by URL (canonical)
    const existing = await prisma.marketSource.findFirst({ where: { url: s.url.trim() } });
    if (existing) {
      skipped.push({ name: s.name, reason: "already exists" });
      continue;
    }

    const row = await prisma.marketSource.create({
      data: {
        name: s.name.trim(),
        jurisdiction: s.jurisdiction.trim(),
        url: s.url.trim(),
        sourceType,
        dateFrom: s.dateFrom ? new Date(s.dateFrom) : null,
        dateTo:   s.dateTo   ? new Date(s.dateTo)   : null,
        minRelevanceScore: typeof s.minRelevanceScore === "number" ? s.minRelevanceScore : 60,
        minEstimatedValue: typeof s.minEstimatedValue === "number" ? s.minEstimatedValue : null,
        projectTypeAllowlist: s.projectTypeAllowlist ?? null,
      },
    });
    created.push({ id: row.id, name: row.name });
  }

  return Response.json({ created, skipped, totalCreated: created.length, totalSkipped: skipped.length });
}
