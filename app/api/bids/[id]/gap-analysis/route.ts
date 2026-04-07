import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/gap-analysis
// Returns all AiGapFindings for the bid grouped by trade name.
// Also returns sanitized estimate counts per trade so the UI
// can distinguish "not yet analyzed" from "no findings".

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const [findings, bidTrades, approvedEstimateCount] = await Promise.all([
    prisma.aiGapFinding.findMany({
      where: { bidId },
      orderBy: [
        // severity ordering: critical → moderate → low
        { severity: "asc" },
        { createdAt: "asc" },
      ],
    }),
    prisma.bidTrade.findMany({
      where: { bidId },
      include: { trade: { select: { id: true, name: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.estimateUpload.count({
      where: {
        bidId,
        approvedForAi: true,
        sanitizedText: { not: null },
      },
    }),
  ]);

  // Group findings by tradeName
  const byTrade: Record<string, typeof findings> = {};
  for (const f of findings) {
    const key = f.tradeName ?? "Unassigned";
    if (!byTrade[key]) byTrade[key] = [];
    byTrade[key].push(f);
  }

  // Sort within each trade: critical first, moderate second, low last
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, moderate: 1, low: 2 };
  for (const key of Object.keys(byTrade)) {
    byTrade[key].sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity ?? ""] ?? 3) -
        (SEVERITY_ORDER[b.severity ?? ""] ?? 3)
    );
  }

  const tradeNames = bidTrades.map((bt) => bt.trade.name);
  const hasFindings = findings.length > 0;
  const isStubMode = process.env.GAP_STUB_MODE === "true";

  return Response.json({
    byTrade,
    tradeNames,
    totalFindings: findings.length,
    approvedEstimateCount,
    hasFindings,
    isStubMode,
  });
}
