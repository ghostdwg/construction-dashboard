import { prisma } from "@/lib/prisma";

export async function GET() {
  const jobs = await prisma.backgroundJob.findMany({
    where: { jobType: "market_scrape" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Hydrate source names where relatedId points at a MarketSource
  const sourceIds = Array.from(new Set(jobs.map((j) => j.relatedId).filter((v): v is string => !!v)));
  const sources = sourceIds.length
    ? await prisma.marketSource.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, name: true, jurisdiction: true },
      })
    : [];
  const byId = new Map(sources.map((s) => [s.id, s] as const));

  type MaybeRunAfter = { runAfter?: Date | null };
  return Response.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      sourceId: j.relatedId,
      source: j.relatedId ? byId.get(j.relatedId) ?? null : null,
      createdAt: j.createdAt.toISOString(),
      runAfter: (j as typeof j & MaybeRunAfter).runAfter?.toISOString?.() ?? null,
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
      inputSummary: j.inputSummary,
      resultSummary: j.resultSummary,
      errorMessage: j.errorMessage,
    })),
  });
}
