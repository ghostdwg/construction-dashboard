import { prisma } from "@/lib/prisma";
import { calculateTimeline, type TimelineEntry } from "@/lib/services/procurement/calculateTimeline";

// ── Urgency sort order ─────────────────────────────────────────────────────
const URGENCY_ORDER = { IMMEDIATE: 0, THIS_WEEK: 1, UPCOMING: 2, OK: 3 };
const TIER_ORDER = { TIER1: 0, TIER2: 1, TIER3: 2 };

// ── GET /api/bids/[id]/procurement/timeline ───────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { dueDate: true, projectType: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  if (!bid.dueDate) {
    return Response.json({ noDueDate: true, timeline: [], summary: null, bidDueDate: null, daysUntilBid: null });
  }

  // Load all bid trades with invite + estimate counts
  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    include: {
      trade: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  });

  // Invite counts per trade (from BidInviteSelection)
  const selections = await prisma.bidInviteSelection.findMany({
    where: { bidId },
    select: { tradeId: true, rfqStatus: true },
  });

  const inviteCountByTrade = new Map<number, number>();
  const estimateCountByTrade = new Map<number, number>();
  for (const sel of selections) {
    if (sel.tradeId == null) continue;
    inviteCountByTrade.set(sel.tradeId, (inviteCountByTrade.get(sel.tradeId) ?? 0) + 1);
    if (["received", "reviewing", "accepted"].includes(sel.rfqStatus)) {
      estimateCountByTrade.set(sel.tradeId, (estimateCountByTrade.get(sel.tradeId) ?? 0) + 1);
    }
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const bidDue = new Date(bid.dueDate);
  bidDue.setUTCHours(0, 0, 0, 0);
  const daysUntilBid = Math.round((bidDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // Build timeline entries
  const entries: (TimelineEntry & {
    rfqSentAt: string | null;
    quotesReceivedAt: string | null;
    rfqNotes: string | null;
    inviteCount: number;
    estimateCount: number;
  })[] = bidTrades.map((bt) => {
    const inviteCount = inviteCountByTrade.get(bt.tradeId) ?? 0;
    const estimateCount = estimateCountByTrade.get(bt.tradeId) ?? 0;

    const entry = calculateTimeline({
      tradeId: bt.tradeId,
      tradeName: bt.trade.name,
      tier: bt.tier,
      leadTimeDays: bt.leadTimeDays,
      bidDueDate: bid.dueDate!,
      projectType: bid.projectType,
      rfqSentAt: bt.rfqSentAt,
      quotesReceivedAt: bt.quotesReceivedAt,
      inviteCount,
      estimateCount,
    });

    return {
      ...entry,
      rfqSendDate: entry.rfqSendDate,
      quoteDueDate: entry.quoteDueDate,
      followUpDate: entry.followUpDate,
      finalQuoteDate: entry.finalQuoteDate,
      rfqSentAt: bt.rfqSentAt?.toISOString() ?? null,
      quotesReceivedAt: bt.quotesReceivedAt?.toISOString() ?? null,
      rfqNotes: bt.rfqNotes ?? null,
      inviteCount,
      estimateCount,
    };
  });

  // Sort: urgency first, then tier, then rfqSendDate asc
  entries.sort((a, b) => {
    const uDiff = (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9);
    if (uDiff !== 0) return uDiff;
    const tDiff = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
    if (tDiff !== 0) return tDiff;
    return a.rfqSendDate.getTime() - b.rfqSendDate.getTime();
  });

  // Summary
  const overdue  = entries.filter((e) => e.status === "OVERDUE").length;
  const atRisk   = entries.filter((e) => e.status === "AT_RISK").length;
  const onTrack  = entries.filter((e) => e.status === "ON_TRACK").length;
  const complete = entries.filter((e) => e.status === "COMPLETE").length;

  // Next action = earliest upcoming rfqSendDate that hasn't been sent yet
  const upcoming = entries
    .filter((e) => !e.rfqSentAt && e.status !== "COMPLETE")
    .sort((a, b) => a.rfqSendDate.getTime() - b.rfqSendDate.getTime());

  const nextAction = upcoming[0] ?? null;

  return Response.json({
    timeline: entries,
    summary: {
      totalTrades: entries.length,
      overdue,
      atRisk,
      onTrack,
      complete,
      nextActionDate: nextAction?.rfqSendDate ?? null,
      nextActionTrade: nextAction?.tradeName ?? null,
    },
    bidDueDate: bid.dueDate,
    daysUntilBid,
  });
}
