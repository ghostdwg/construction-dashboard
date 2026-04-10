import { prisma } from "@/lib/prisma";
import { parsePricingTotal } from "@/lib/services/estimate/parsePricingTotal";

// GET /api/bids/[id]/estimates/spread
// Returns per-trade cost spread from parsed pricing data.
// pricingData raw JSON is NEVER returned — only computed aggregates.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Load estimates with pricingData (server-side only — never returned)
  const estimates = await prisma.estimateUpload.findMany({
    where: { bidId, parseStatus: "complete" },
    select: {
      id: true,
      subcontractorId: true,
      subToken: true,
      pricingData: true,
      parsedTotal: true,
      parsedLineCount: true,
    },
  });

  // Load selections to map sub → trade
  const selections = await prisma.bidInviteSelection.findMany({
    where: { bidId },
    select: { subcontractorId: true, tradeId: true },
  });
  const subToTrade = new Map<number, number>();
  for (const s of selections) {
    if (s.tradeId != null) subToTrade.set(s.subcontractorId, s.tradeId);
  }

  // Load trade names
  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    include: { trade: { select: { id: true, name: true } } },
  });
  const tradeNames = new Map(bidTrades.map((bt) => [bt.tradeId, bt.trade.name]));

  // Parse totals and cache if not already done
  type EstimateEntry = { subToken: string; total: number; lineCount: number; warnings: string[] };
  const tradeEstimates = new Map<number, EstimateEntry[]>();
  let totalWarnings = 0;

  for (const est of estimates) {
    // Parse if not cached
    let total = est.parsedTotal;
    let lineCount = est.parsedLineCount;
    const warnings: string[] = [];

    if (total == null) {
      const result = parsePricingTotal(est.pricingData);
      total = result.total;
      lineCount = result.lineCount;
      warnings.push(...result.warnings);

      // Cache on the record
      await prisma.estimateUpload.update({
        where: { id: est.id },
        data: { parsedTotal: total, parsedLineCount: lineCount },
      });
    }

    if (total <= 0) {
      totalWarnings++;
      continue;
    }

    const tradeId = subToTrade.get(est.subcontractorId);
    if (tradeId == null) continue;

    if (!tradeEstimates.has(tradeId)) tradeEstimates.set(tradeId, []);
    tradeEstimates.get(tradeId)!.push({
      subToken: est.subToken ?? `SUB-${est.id}`,
      total,
      lineCount: lineCount ?? 0,
      warnings,
    });

    if (warnings.length > 0) totalWarnings++;
  }

  // Compute spread per trade
  const trades = Array.from(tradeEstimates.entries())
    .map(([tradeId, ests]) => {
      const totals = ests.map((e) => e.total).sort((a, b) => a - b);
      const min = totals[0];
      const max = totals[totals.length - 1];
      const median = totals.length % 2 === 0
        ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
        : totals[Math.floor(totals.length / 2)];
      const range = max - min;
      const rangePercent = median > 0 ? Math.round((range / median) * 1000) / 10 : 0;

      return {
        tradeId,
        tradeName: tradeNames.get(tradeId) ?? `Trade ${tradeId}`,
        estimates: ests.map((e) => ({
          subToken: e.subToken,
          total: Math.round(e.total),
          lineCount: e.lineCount,
        })),
        spread: {
          min: Math.round(min),
          max: Math.round(max),
          median: Math.round(median),
          range: Math.round(range),
          rangePercent,
        },
      };
    })
    .sort((a, b) => b.spread.max - a.spread.max);

  return Response.json({
    bidId,
    trades,
    overall: {
      estimateCount: estimates.length,
      tradesWithPricing: trades.length,
      totalSpreadWarnings: totalWarnings,
    },
  });
}
