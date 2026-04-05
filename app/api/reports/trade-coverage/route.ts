import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const activeBids = await prisma.bid.findMany({
      where: { status: { notIn: ["cancelled", "awarded"] } },
      select: {
        id: true,
        projectName: true,
        dueDate: true,
        bidTrades: {
          select: {
            tradeId: true,
            trade: { select: { name: true } },
          },
        },
        selections: {
          select: { tradeId: true },
        },
      },
    });

    type Row = {
      bidId: number;
      bidName: string;
      dueDate: string | null;
      tradeId: number;
      tradeName: string;
      subCount: number;
    };

    const rows: Row[] = [];

    for (const bid of activeBids) {
      // Count selections per tradeId for this bid
      const selectionCounts = new Map<number, number>();
      for (const sel of bid.selections) {
        if (sel.tradeId !== null) {
          selectionCounts.set(
            sel.tradeId,
            (selectionCounts.get(sel.tradeId) ?? 0) + 1
          );
        }
      }

      for (const bt of bid.bidTrades) {
        rows.push({
          bidId: bid.id,
          bidName: bid.projectName,
          dueDate: bid.dueDate ? bid.dueDate.toISOString() : null,
          tradeId: bt.tradeId,
          tradeName: bt.trade.name,
          subCount: selectionCounts.get(bt.tradeId) ?? 0,
        });
      }
    }

    // Sort: uncovered first, then by dueDate ascending (nulls last)
    rows.sort((a, b) => {
      if (a.subCount === 0 && b.subCount > 0) return -1;
      if (a.subCount > 0 && b.subCount === 0) return 1;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });

    return Response.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/reports/trade-coverage] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
