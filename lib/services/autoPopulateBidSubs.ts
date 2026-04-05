import { prisma } from "@/lib/prisma";

/**
 * Adds preferred subs for every trade on the bid as BidInviteSelection records.
 * Safe to call multiple times — skips any (bidId, subcontractorId, tradeId)
 * combinations that already exist.
 */
export async function autoPopulateBidSubs(
  bidId: number
): Promise<{ added: number }> {
  const bidTrades = await prisma.bidTrade.findMany({ where: { bidId } });
  if (bidTrades.length === 0) return { added: 0 };

  const tradeIds = bidTrades.map((bt) => bt.tradeId);

  const preferredSubs = await prisma.preferredSub.findMany({
    where: { tradeId: { in: tradeIds } },
  });
  if (preferredSubs.length === 0) return { added: 0 };

  // Fetch existing selections to avoid duplicates (no DB unique constraint)
  const existing = await prisma.bidInviteSelection.findMany({
    where: { bidId },
    select: { subcontractorId: true, tradeId: true },
  });
  const existingSet = new Set(
    existing.map((e) => `${e.subcontractorId}-${e.tradeId ?? "null"}`)
  );

  const toCreate = preferredSubs.filter(
    (ps) => !existingSet.has(`${ps.subcontractorId}-${ps.tradeId}`)
  );
  if (toCreate.length === 0) return { added: 0 };

  await prisma.bidInviteSelection.createMany({
    data: toCreate.map((ps) => ({
      bidId,
      subcontractorId: ps.subcontractorId,
      tradeId: ps.tradeId,
      rfqStatus: "no_response",
    })),
  });

  return { added: toCreate.length };
}
