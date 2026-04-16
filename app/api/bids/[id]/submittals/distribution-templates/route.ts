// GET  /api/bids/[id]/submittals/distribution-templates
//   Returns all routing templates for the bid plus all bid trades (for the
//   "add template" dropdown). Each template includes the trade name and the
//   buyout-awarded contractor name so the UI can pre-suggest it.
//
// POST /api/bids/[id]/submittals/distribution-templates
//   Upsert a template by (bidId, bidTradeId). Creates if not present, updates
//   if present. Body: { bidTradeId?, responsibleContractor?, submittalManager?,
//   reviewers?, distribution? }

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const [templates, bidTrades] = await Promise.all([
    prisma.submittalDistributionTemplate.findMany({
      where: { bidId },
      include: {
        bidTrade: {
          include: {
            trade: { select: { name: true, csiCode: true } },
            buyoutItem: {
              include: { subcontractor: { select: { company: true } } },
            },
          },
        },
      },
      orderBy: { bidTrade: { trade: { name: "asc" } } },
    }),
    prisma.bidTrade.findMany({
      where: { bidId },
      include: {
        trade: { select: { name: true, csiCode: true } },
        buyoutItem: {
          include: { subcontractor: { select: { company: true } } },
        },
      },
      orderBy: { trade: { name: "asc" } },
    }),
  ]);

  const safeArr = (raw: string): string[] => {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  };

  return Response.json({
    templates: templates.map((t) => ({
      id: t.id,
      bidTradeId: t.bidTradeId,
      tradeName: t.bidTrade?.trade.name ?? null,
      tradeCsiCode: t.bidTrade?.trade.csiCode ?? null,
      awardedContractor: t.bidTrade?.buyoutItem?.subcontractor?.company ?? null,
      responsibleContractor: t.responsibleContractor,
      submittalManager: t.submittalManager,
      reviewers: safeArr(t.reviewers),
      distribution: safeArr(t.distribution),
      updatedAt: t.updatedAt.toISOString(),
    })),
    bidTrades: bidTrades.map((bt) => ({
      id: bt.id,
      tradeName: bt.trade.name,
      tradeCsiCode: bt.trade.csiCode,
      awardedContractor: bt.buyoutItem?.subcontractor?.company ?? null,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json()) as {
    bidTradeId?: number | null;
    responsibleContractor?: string | null;
    submittalManager?: string | null;
    reviewers?: string[];
    distribution?: string[];
  };

  // Verify bidTradeId belongs to this bid
  if (body.bidTradeId != null) {
    const bt = await prisma.bidTrade.findFirst({
      where: { id: body.bidTradeId, bidId },
      select: { id: true },
    });
    if (!bt)
      return Response.json(
        { error: "Trade not found for this bid" },
        { status: 400 }
      );
  }

  const reviewers = Array.isArray(body.reviewers)
    ? JSON.stringify(body.reviewers.map((r) => String(r).trim()).filter(Boolean))
    : undefined;
  const distribution = Array.isArray(body.distribution)
    ? JSON.stringify(body.distribution.map((r) => String(r).trim()).filter(Boolean))
    : undefined;

  const existing = await prisma.submittalDistributionTemplate.findFirst({
    where: { bidId, bidTradeId: body.bidTradeId ?? null },
    select: { id: true },
  });

  let templateId: number;
  if (existing) {
    const updateData: Record<string, unknown> = {};
    if (body.responsibleContractor !== undefined)
      updateData.responsibleContractor = body.responsibleContractor?.trim() || null;
    if (body.submittalManager !== undefined)
      updateData.submittalManager = body.submittalManager?.trim() || null;
    if (reviewers !== undefined) updateData.reviewers = reviewers;
    if (distribution !== undefined) updateData.distribution = distribution;
    await prisma.submittalDistributionTemplate.update({
      where: { id: existing.id },
      data: updateData,
    });
    templateId = existing.id;
  } else {
    const created = await prisma.submittalDistributionTemplate.create({
      data: {
        bidId,
        bidTradeId: body.bidTradeId ?? null,
        responsibleContractor: body.responsibleContractor?.trim() || null,
        submittalManager: body.submittalManager?.trim() || null,
        reviewers: reviewers ?? "[]",
        distribution: distribution ?? "[]",
      },
    });
    templateId = created.id;
  }

  return Response.json({ ok: true, id: templateId });
}
