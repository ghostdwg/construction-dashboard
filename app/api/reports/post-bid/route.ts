import { prisma } from "@/lib/prisma";

// GET /api/reports/post-bid
// Aggregates all BidSubmission records into win rate / accuracy / margin dashboard.
// Pure SQL — no AI, no pricing data leakage.

export async function GET() {
  const submissions = await prisma.bidSubmission.findMany({
    include: {
      bid: { select: { id: true, projectName: true, projectType: true } },
    },
    orderBy: { submittedAt: "desc" },
  });

  // ── Summary ────────────────────────────────────────────────────────────
  const totalSubmitted = submissions.length;
  const won = submissions.filter((s) => s.outcome === "won").length;
  const lost = submissions.filter((s) => s.outcome === "lost").length;
  const withdrawn = submissions.filter((s) => s.outcome === "withdrawn").length;
  const decided = won + lost;
  const winRate = decided > 0 ? Math.round((won / decided) * 1000) / 10 : 0;

  const ranks = submissions
    .filter((s) => typeof s.ourRank === "number")
    .map((s) => s.ourRank as number);
  const avgRank = ranks.length > 0 ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null;

  const gaps = submissions
    .filter((s) => s.outcome === "lost" && s.ourBidAmount && s.winningBidAmount)
    .map((s) => ((s.ourBidAmount! - s.winningBidAmount!) / s.winningBidAmount!) * 100);
  const avgGapToWinner = gaps.length > 0 ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null;

  // ── By project type ───────────────────────────────────────────────────
  const byProjectType: Record<string, { submitted: number; won: number; lost: number; winRate: number }> = {};
  for (const s of submissions) {
    const type = s.bid.projectType;
    if (!byProjectType[type]) byProjectType[type] = { submitted: 0, won: 0, lost: 0, winRate: 0 };
    byProjectType[type].submitted++;
    if (s.outcome === "won") byProjectType[type].won++;
    if (s.outcome === "lost") byProjectType[type].lost++;
  }
  for (const type of Object.keys(byProjectType)) {
    const t = byProjectType[type];
    const dec = t.won + t.lost;
    t.winRate = dec > 0 ? Math.round((t.won / dec) * 1000) / 10 : 0;
  }

  // ── Lost reasons ──────────────────────────────────────────────────────
  const lostReasonCounts: Record<string, number> = {};
  for (const s of submissions) {
    if (s.outcome === "lost" && s.lostReason) {
      lostReasonCounts[s.lostReason] = (lostReasonCounts[s.lostReason] ?? 0) + 1;
    }
  }
  const lostReasons = Object.entries(lostReasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // ── Recent bids ───────────────────────────────────────────────────────
  const recentBids = submissions.slice(0, 10).map((s) => ({
    id: s.bid.id,
    projectName: s.bid.projectName,
    projectType: s.bid.projectType,
    outcome: s.outcome,
    ourBidAmount: s.ourBidAmount,
    winningBidAmount: s.winningBidAmount,
    submittedAt: s.submittedAt,
    outcomeAt: s.outcomeAt,
  }));

  return Response.json({
    summary: {
      totalSubmitted,
      won,
      lost,
      withdrawn,
      pending: totalSubmitted - won - lost - withdrawn,
      winRate,
      avgRank,
      avgGapToWinner,
    },
    byProjectType,
    lostReasons,
    recentBids,
  });
}
