import { prisma } from "@/lib/prisma";
import { parsePricingTotal } from "@/lib/services/estimate/parsePricingTotal";

// ── Types ──────────────────────────────────────────────────────────────────

export type BidSnapshot = {
  brief: {
    status: string;
    hasContent: boolean;
    riskFlagCount: number;
    criticalRiskCount: number;
    assumptionCount: number;
  } | null;
  questions: {
    total: number;
    open: number;
    sent: number;
    answered: number;
    closed: number;
    noResponse: number;
    criticalOpen: number;
    impactFlagged: number;
  };
  compliance: {
    applicable: boolean;
    total: number;
    checked: number;
    percentage: number;
  } | null;
  spread: {
    tradesWithPricing: number;
    overallLow: number;
    overallHigh: number;
    perTrade: Array<{
      tradeName: string;
      min: number;
      max: number;
      median: number;
      rangePercent: number;
      estimateCount: number;
    }>;
  };
  intelligence: {
    warningCount: number;
    cautionCount: number;
    infoCount: number;
  };
};

// ── Snapshot capture ───────────────────────────────────────────────────────

export async function captureBidSnapshot(bidId: number): Promise<BidSnapshot> {
  const [bid, brief, questions, estimates, selections, bidTrades, gapFindings] = await Promise.all([
    prisma.bid.findUnique({
      where: { id: bidId },
      select: { id: true, projectType: true, complianceChecklist: true },
    }),
    prisma.bidIntelligenceBrief.findUnique({
      where: { bidId },
      select: { status: true, whatIsThisJob: true, riskFlags: true, assumptionsToResolve: true },
    }),
    prisma.generatedQuestion.findMany({
      where: { OR: [{ bidId }, { gapFinding: { bidId } }] },
      select: { status: true, priority: true, impactFlag: true },
    }),
    prisma.estimateUpload.findMany({
      where: { bidId, parseStatus: "complete" },
      select: { id: true, subcontractorId: true, pricingData: true, parsedTotal: true },
    }),
    prisma.bidInviteSelection.findMany({
      where: { bidId },
      select: { subcontractorId: true, tradeId: true },
    }),
    prisma.bidTrade.findMany({
      where: { bidId },
      include: { trade: { select: { id: true, name: true } } },
    }),
    prisma.aiGapFinding.findMany({
      where: { bidId },
      select: { severity: true, generatedQuestions: { select: { id: true } } },
    }),
  ]);

  if (!bid) throw new Error(`Bid ${bidId} not found`);

  // ── Brief snapshot ────────────────────────────────────────────────────────
  let briefSnap: BidSnapshot["brief"] = null;
  if (brief) {
    let riskFlagCount = 0;
    let criticalRiskCount = 0;
    let assumptionCount = 0;
    if (brief.riskFlags) {
      try {
        const flags = JSON.parse(brief.riskFlags) as { severity?: string }[];
        riskFlagCount = flags.length;
        criticalRiskCount = flags.filter((f) => f.severity === "critical").length;
      } catch { /* ignore */ }
    }
    if (brief.assumptionsToResolve) {
      try {
        const assumps = JSON.parse(brief.assumptionsToResolve) as unknown[];
        assumptionCount = assumps.length;
      } catch { /* ignore */ }
    }
    briefSnap = {
      status: brief.status,
      hasContent: !!brief.whatIsThisJob,
      riskFlagCount,
      criticalRiskCount,
      assumptionCount,
    };
  }

  // ── Questions snapshot ────────────────────────────────────────────────────
  const qSnap = {
    total: questions.length,
    open: questions.filter((q) => q.status === "OPEN").length,
    sent: questions.filter((q) => q.status === "SENT").length,
    answered: questions.filter((q) => q.status === "ANSWERED").length,
    closed: questions.filter((q) => q.status === "CLOSED").length,
    noResponse: questions.filter((q) => q.status === "NO_RESPONSE").length,
    criticalOpen: questions.filter(
      (q) => q.priority === "CRITICAL" && ["OPEN", "SENT", "NO_RESPONSE"].includes(q.status)
    ).length,
    impactFlagged: questions.filter((q) => q.impactFlag).length,
  };

  // ── Compliance snapshot ───────────────────────────────────────────────────
  let compSnap: BidSnapshot["compliance"] = null;
  if (bid.projectType === "PUBLIC") {
    let total = 0;
    let checked = 0;
    if (bid.complianceChecklist) {
      try {
        const items = JSON.parse(bid.complianceChecklist) as { checked?: boolean }[];
        total = items.length;
        checked = items.filter((i) => i.checked).length;
      } catch { /* ignore */ }
    }
    compSnap = {
      applicable: true,
      total,
      checked,
      percentage: total > 0 ? Math.round((checked / total) * 100) : 0,
    };
  }

  // ── Spread snapshot ───────────────────────────────────────────────────────
  const subToTrade = new Map<number, number>();
  for (const s of selections) {
    if (s.tradeId != null) subToTrade.set(s.subcontractorId, s.tradeId);
  }
  const tradeNames = new Map(bidTrades.map((bt) => [bt.tradeId, bt.trade.name]));

  const tradeTotals = new Map<number, number[]>();
  for (const est of estimates) {
    const tradeId = subToTrade.get(est.subcontractorId);
    if (tradeId == null) continue;

    let total = est.parsedTotal;
    if (total == null) {
      const result = parsePricingTotal(est.pricingData);
      total = result.total;
    }
    if (total <= 0) continue;

    if (!tradeTotals.has(tradeId)) tradeTotals.set(tradeId, []);
    tradeTotals.get(tradeId)!.push(total);
  }

  let overallLow = 0;
  let overallHigh = 0;
  const perTrade = Array.from(tradeTotals.entries()).map(([tradeId, totals]) => {
    const sorted = [...totals].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const rangePercent = median > 0 ? Math.round(((max - min) / median) * 1000) / 10 : 0;
    overallLow += min;
    overallHigh += max;
    return {
      tradeName: tradeNames.get(tradeId) ?? `Trade ${tradeId}`,
      min: Math.round(min),
      max: Math.round(max),
      median: Math.round(median),
      rangePercent,
      estimateCount: totals.length,
    };
  });

  const spreadSnap = {
    tradesWithPricing: perTrade.length,
    overallLow: Math.round(overallLow),
    overallHigh: Math.round(overallHigh),
    perTrade,
  };

  // ── Intelligence snapshot (count outliers, gaps, single bids) ─────────────
  // Compact version of the intelligence route logic. Note: best_value/info-level
  // recommendations require per-estimate coverage data which the snapshot
  // doesn't load — they're tracked in the live intelligence route only.
  let warningCount = 0;
  let cautionCount = 0;
  const infoCount = 0; // not computed in snapshot — see comment above

  for (const trade of perTrade) {
    if (trade.estimateCount === 1) cautionCount++;
    else if (trade.rangePercent > 25) cautionCount++;
  }
  // Missing trades = bidTrades not in tradeTotals
  const tradesWithEstimates = new Set(tradeTotals.keys());
  for (const bt of bidTrades) {
    if (!tradesWithEstimates.has(bt.tradeId)) warningCount++;
  }
  // Critical unresolved gaps
  for (const finding of gapFindings) {
    if (finding.severity === "critical" && finding.generatedQuestions.length === 0) {
      warningCount++;
    }
  }

  return {
    brief: briefSnap,
    questions: qSnap,
    compliance: compSnap,
    spread: spreadSnap,
    intelligence: { warningCount, cautionCount, infoCount },
  };
}
