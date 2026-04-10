import { prisma } from "@/lib/prisma";
import { parsePricingTotal } from "@/lib/services/estimate/parsePricingTotal";

// GET /api/bids/[id]/estimates/value-matrix
// Returns scope coverage + cost position per estimate per trade.
// pricingData raw JSON is NEVER returned.

type CostPosition = "low" | "median" | "high";
type ValueFlag = "best_value" | "low_coverage" | "high_cost" | "ok";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Load estimates with pricing
  const estimates = await prisma.estimateUpload.findMany({
    where: { bidId, parseStatus: "complete" },
    select: {
      id: true,
      subcontractorId: true,
      subToken: true,
      pricingData: true,
      parsedTotal: true,
    },
  });

  // Load selections for sub → trade mapping
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

  // Load leveling session + rows for scope coverage
  const session = await prisma.levelingSession.findUnique({
    where: { bidId },
    select: { id: true },
  });

  const levelingRows = session
    ? await prisma.levelingRow.findMany({
        where: { sessionId: session.id },
        select: { estimateUploadId: true, tradeId: true, status: true },
      })
    : [];

  // Group leveling by estimate+trade → coverage
  type CoverageKey = `${number}-${number}`;
  const coverageMap = new Map<CoverageKey, { included: number; total: number }>();
  for (const row of levelingRows) {
    const tradeId = row.tradeId;
    if (tradeId == null) continue;
    const key: CoverageKey = `${row.estimateUploadId}-${tradeId}`;
    if (!coverageMap.has(key)) coverageMap.set(key, { included: 0, total: 0 });
    const entry = coverageMap.get(key)!;
    entry.total++;
    if (row.status === "included") entry.included++;
  }

  // Build per-trade data
  type TradeEstimate = {
    subToken: string;
    total: number;
    scopeCoverage: number;
    scopeIncluded: number;
    scopeTotal: number;
    costPosition: CostPosition;
    valueFlag: ValueFlag;
  };

  const tradeData = new Map<number, TradeEstimate[]>();

  for (const est of estimates) {
    const tradeId = subToTrade.get(est.subcontractorId);
    if (tradeId == null) continue;

    let total = est.parsedTotal;
    if (total == null) {
      const result = parsePricingTotal(est.pricingData);
      total = result.total;
      await prisma.estimateUpload.update({
        where: { id: est.id },
        data: { parsedTotal: total, parsedLineCount: result.lineCount },
      });
    }
    if (total <= 0) continue;

    const coverageKey: CoverageKey = `${est.id}-${tradeId}`;
    const coverage = coverageMap.get(coverageKey) ?? { included: 0, total: 0 };
    const scopeCoverage = coverage.total > 0 ? coverage.included / coverage.total : 0;

    if (!tradeData.has(tradeId)) tradeData.set(tradeId, []);
    tradeData.get(tradeId)!.push({
      subToken: est.subToken ?? `SUB-${est.id}`,
      total: Math.round(total),
      scopeCoverage: Math.round(scopeCoverage * 100) / 100,
      scopeIncluded: coverage.included,
      scopeTotal: coverage.total,
      costPosition: "median", // placeholder — computed below
      valueFlag: "ok",        // placeholder — computed below
    });
  }

  // Compute cost positions and value flags per trade
  const trades = Array.from(tradeData.entries()).map(([tradeId, ests]) => {
    const totals = ests.map((e) => e.total).sort((a, b) => a - b);
    const median = totals.length % 2 === 0
      ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
      : totals[Math.floor(totals.length / 2)];

    for (const est of ests) {
      // Cost position
      if (totals.length <= 1) {
        est.costPosition = "median";
      } else if (est.total <= totals[Math.floor(totals.length * 0.33)]) {
        est.costPosition = "low";
      } else if (est.total >= totals[Math.ceil(totals.length * 0.67)]) {
        est.costPosition = "high";
      } else {
        est.costPosition = "median";
      }

      // Value flag
      const aboveMedianPct = median > 0 ? (est.total - median) / median : 0;
      if (est.scopeCoverage >= 0.85 && est.costPosition !== "high") {
        est.valueFlag = "best_value";
      } else if (est.scopeCoverage < 0.7) {
        est.valueFlag = "low_coverage";
      } else if (aboveMedianPct > 0.25) {
        est.valueFlag = "high_cost";
      } else {
        est.valueFlag = "ok";
      }
    }

    return {
      tradeId,
      tradeName: tradeNames.get(tradeId) ?? `Trade ${tradeId}`,
      estimates: ests,
    };
  });

  return Response.json({ trades });
}
