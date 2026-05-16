import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = await prisma.marketSourceDoc.findUnique({
    where: { id },
    include: {
      source: { select: { id: true, name: true, jurisdiction: true, sourceType: true } },
      signals: {
        select: {
          id: true, headline: true, signalType: true, aiRelevanceScore: true,
          createdAt: true, leadId: true,
        },
        orderBy: { aiRelevanceScore: "desc" },
      },
      leads: {
        select: {
          id: true, title: true, status: true, leadType: true, aiScore: true,
          estimatedValue: true, location: true, detectedAt: true,
        },
        orderBy: { detectedAt: "desc" },
      },
    },
  });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(doc);
}
