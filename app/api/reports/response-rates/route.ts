import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const logs = await prisma.outreachLog.findMany({
      select: {
        status: true,
        question: { select: { tradeName: true } },
      },
    });

    const groups = new Map<string, { exported: number; responded: number }>();

    for (const log of logs) {
      const name = log.question?.tradeName ?? "Unassigned";
      if (!groups.has(name)) groups.set(name, { exported: 0, responded: 0 });
      const g = groups.get(name)!;
      g.exported++;
      if (log.status === "responded") g.responded++;
    }

    const result = Array.from(groups.entries())
      .map(([tradeName, { exported, responded }]) => ({
        tradeName,
        exported,
        responded,
        rate: exported > 0 ? Math.round((responded / exported) * 100) : 0,
      }))
      .sort((a, b) => b.exported - a.exported);

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/reports/response-rates] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
