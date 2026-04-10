import { prisma } from "@/lib/prisma";
import { parsePricingTotal } from "@/lib/services/estimate/parsePricingTotal";

// GET /api/bids/[id]/estimates/intelligence
// Auto-generated estimate intelligence summary — pure math, no AI.
// pricingData raw JSON is NEVER returned.

type Severity = "warning" | "caution" | "info";
type RecommendationType = "outlier" | "coverage_gap" | "best_value" | "missing_estimate" | "single_bid";

type Recommendation = {
  type: RecommendationType;
  trade: string;
  detail: string;
  severity: Severity;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Load all data in parallel
  const [estimates, selections, bidTrades, session] = await Promise.all([
    prisma.estimateUpload.findMany({
      where: { bidId, parseStatus: "complete" },
      select: {
        id: true,
        subcontractorId: true,
        subToken: true,
        pricingData: true,
        parsedTotal: true,
      },
    }),
    prisma.bidInviteSelection.findMany({
      where: { bidId },
      select: { subcontractorId: true, tradeId: true },
    }),
    prisma.bidTrade.findMany({
      where: { bidId },
      include: { trade: { select: { id: true, name: true } } },
    }),
    prisma.levelingSession.findUnique({
      where: { bidId },
      select: { id: true },
    }),
  ]);

  const levelingRows = session
    ? await prisma.levelingRow.findMany({
        where: { sessionId: session.id },
        select: { estimateUploadId: true, tradeId: true, status: true },
      })
    : [];

  // Maps
  const subToTrade = new Map<number, number>();
  for (const s of selections) {
    if (s.tradeId != null) subToTrade.set(s.subcontractorId, s.tradeId);
  }
  const tradeNames = new Map(bidTrades.map((bt) => [bt.tradeId, bt.trade.name]));
  const allTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

  // Coverage map
  type CoverageKey = `${number}-${number}`;
  const coverageMap = new Map<CoverageKey, { included: number; total: number }>();
  for (const row of levelingRows) {
    if (row.tradeId == null) continue;
    const key: CoverageKey = `${row.estimateUploadId}-${row.tradeId}`;
    if (!coverageMap.has(key)) coverageMap.set(key, { included: 0, total: 0 });
    const entry = coverageMap.get(key)!;
    entry.total++;
    if (row.status === "included") entry.included++;
  }

  // Parse totals per trade
  type TradeEntry = { subToken: string; total: number; estId: number; scopeCoverage: number };
  const tradeEstimates = new Map<number, TradeEntry[]>();
  const tradesWithEstimates = new Set<number>();

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

    tradesWithEstimates.add(tradeId);
    if (total <= 0) continue;

    const coverageKey: CoverageKey = `${est.id}-${tradeId}`;
    const cov = coverageMap.get(coverageKey);
    const scopeCoverage = cov && cov.total > 0 ? cov.included / cov.total : 0;

    if (!tradeEstimates.has(tradeId)) tradeEstimates.set(tradeId, []);
    tradeEstimates.get(tradeId)!.push({
      subToken: est.subToken ?? `SUB-${est.id}`,
      total,
      estId: est.id,
      scopeCoverage,
    });
  }

  // Generate recommendations
  const recommendations: Recommendation[] = [];
  let overallLow = 0;
  let overallHigh = 0;
  let tradesAnalyzed = 0;

  for (const [tradeId, ests] of tradeEstimates) {
    const tradeName = tradeNames.get(tradeId) ?? `Trade ${tradeId}`;
    tradesAnalyzed++;

    const totals = ests.map((e) => e.total).sort((a, b) => a - b);
    const min = totals[0];
    const max = totals[totals.length - 1];
    const median = totals.length % 2 === 0
      ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
      : totals[Math.floor(totals.length / 2)];

    overallLow += min;
    overallHigh += max;

    // Single bid warning
    if (ests.length === 1) {
      recommendations.push({
        type: "single_bid",
        trade: tradeName,
        detail: `Only one estimate received ($${Math.round(ests[0].total).toLocaleString()}) — no competitive comparison possible`,
        severity: "caution",
      });
      continue;
    }

    // Outlier detection
    for (const est of ests) {
      const deviation = median > 0 ? (est.total - median) / median : 0;
      if (deviation > 0.25) {
        recommendations.push({
          type: "outlier",
          trade: tradeName,
          detail: `${est.subToken} is ${Math.round(deviation * 100)}% above median ($${Math.round(est.total).toLocaleString()} vs $${Math.round(median).toLocaleString()}) — verify scope alignment`,
          severity: "caution",
        });
      }
      if (deviation < -0.25) {
        recommendations.push({
          type: "outlier",
          trade: tradeName,
          detail: `${est.subToken} is ${Math.round(Math.abs(deviation) * 100)}% below median ($${Math.round(est.total).toLocaleString()} vs $${Math.round(median).toLocaleString()}) — verify scope completeness`,
          severity: "warning",
        });
      }
    }

    // Coverage gap on low bidder
    const lowBidder = ests.reduce((a, b) => (a.total < b.total ? a : b));
    if (lowBidder.scopeCoverage > 0 && lowBidder.scopeCoverage < 0.7) {
      recommendations.push({
        type: "coverage_gap",
        trade: tradeName,
        detail: `${lowBidder.subToken} is lowest at $${Math.round(lowBidder.total).toLocaleString()} but covers only ${Math.round(lowBidder.scopeCoverage * 100)}% of spec scope — risk of change orders`,
        severity: "warning",
      });
    }

    // Best value
    for (const est of ests) {
      if (est.scopeCoverage >= 0.85 && est.total <= median) {
        recommendations.push({
          type: "best_value",
          trade: tradeName,
          detail: `${est.subToken} covers ${Math.round(est.scopeCoverage * 100)}% of scope at $${Math.round(est.total).toLocaleString()} (at or below median) — strong candidate`,
          severity: "info",
        });
      }
    }
  }

  // Missing trades
  const missingTrades: string[] = [];
  for (const tradeId of allTradeIds) {
    if (!tradesWithEstimates.has(tradeId)) {
      missingTrades.push(tradeNames.get(tradeId) ?? `Trade ${tradeId}`);
    }
  }
  for (const name of missingTrades) {
    recommendations.push({
      type: "missing_estimate",
      trade: name,
      detail: `No estimates received for ${name}`,
      severity: "warning",
    });
  }

  // Sort: warning first, then caution, then info
  const severityOrder: Record<Severity, number> = { warning: 0, caution: 1, info: 2 };
  recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return Response.json({
    generated: estimates.length > 0,
    summary: {
      totalEstimates: estimates.length,
      tradesAnalyzed,
      totalBidRange: overallLow > 0 ? { low: Math.round(overallLow), high: Math.round(overallHigh) } : null,
      recommendations,
      missingTrades,
    },
  });
}
