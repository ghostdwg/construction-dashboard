// GET  /api/market-intelligence/sources — list all sources
// POST /api/market-intelligence/sources — create a source

import { prisma } from "@/lib/prisma";

const VALID_TYPES = new Set(["city_council","planning_commission","permit_feed","rss"]);

export async function GET() {
  const sources = await prisma.marketSource.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { docs: true } },
      docs: { orderBy: { scannedAt: "desc" }, take: 1, select: { scannedAt: true, signalsFound: true } },
    },
  });
  return Response.json({ sources });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: string; jurisdiction?: string; url?: string;
    sourceType?: string; notes?: string;
  } | null;

  if (!body?.name?.trim() || !body?.url?.trim() || !body?.jurisdiction?.trim()) {
    return Response.json({ error: "name, url, and jurisdiction are required" }, { status: 400 });
  }

  const source = await prisma.marketSource.create({
    data: {
      name:         body.name.trim(),
      jurisdiction: body.jurisdiction.trim(),
      url:          body.url.trim(),
      sourceType:   VALID_TYPES.has(body.sourceType ?? "") ? body.sourceType! : "city_council",
      notes:        body.notes?.trim() || null,
    },
  });

  return Response.json(source, { status: 201 });
}
