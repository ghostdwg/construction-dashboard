import { prisma } from "@/lib/prisma";

const ACTIVE_STATUSES_EXCLUDED = ["cancelled", "awarded"];

export async function GET() {
  try {
    // Active bid ids — reused for coverage query
    const activeBids = await prisma.bid.findMany({
      where: { status: { notIn: ACTIVE_STATUSES_EXCLUDED } },
      select: { id: true },
    });
    const activeBidIds = activeBids.map((b) => b.id);

    // Trades with no sub coverage on active bids
    const [bidTrades, selections] = await Promise.all([
      prisma.bidTrade.findMany({
        where: { bidId: { in: activeBidIds } },
        select: { bidId: true, tradeId: true },
      }),
      prisma.bidInviteSelection.findMany({
        where: { bidId: { in: activeBidIds }, tradeId: { not: null } },
        select: { bidId: true, tradeId: true },
      }),
    ]);
    const selectionSet = new Set(
      selections.map((s) => `${s.bidId}:${s.tradeId}`)
    );
    const tradesNoCoverage = bidTrades.filter(
      (bt) => !selectionSet.has(`${bt.bidId}:${bt.tradeId}`)
    ).length;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activeBidCount,
      openQuestions,
      unansweredQuestions,
      gapFindings,
      exportsThisMonth,
    ] = await Promise.all([
      Promise.resolve(activeBidIds.length),
      prisma.generatedQuestion.count({
        where: { status: { in: ["OPEN", "SENT"] } },
      }),
      prisma.generatedQuestion.count({ where: { status: "NO_RESPONSE" } }),
      prisma.aiGapFinding.count({ where: { status: "pending_review" } }),
      prisma.exportBatch.count({ where: { exportedAt: { gte: startOfMonth } } }),
    ]);

    return Response.json({
      activeBids: activeBidCount,
      tradesNoCoverage,
      openQuestions,
      unansweredQuestions,
      gapFindings,
      exportsThisMonth,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/reports/summary] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
