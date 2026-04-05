import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const logs = await prisma.outreachLog.findMany({
      where: {
        OR: [
          { status: "needs_follow_up" },
          { status: "exported", sentAt: { lt: sevenDaysAgo } },
        ],
      },
      include: {
        bid: { select: { projectName: true } },
        subcontractor: { select: { company: true } },
        question: { select: { tradeName: true } },
      },
    });

    const now = Date.now();

    const result = logs
      .map((log) => {
        const lastActivityDate = log.sentAt ?? log.createdAt;
        const daysSince = Math.floor(
          (now - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        return {
          id: log.id,
          company: log.subcontractor?.company ?? "—",
          tradeName: log.question?.tradeName ?? "—",
          bidName: log.bid?.projectName ?? `Bid ${log.bidId}`,
          lastActivity: lastActivityDate.toISOString(),
          daysSince,
          status: log.status,
        };
      })
      .sort((a, b) => b.daysSince - a.daysSince); // oldest first

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/reports/follow-up-aging] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
