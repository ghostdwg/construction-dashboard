import { prisma } from "@/lib/prisma";
import { autoPopulateBidSubs } from "@/lib/services/autoPopulateBidSubs";

// POST /api/bids/[id]/sync-preferred-subs
// Runs auto-populate and returns { added, selections } for client state update.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const { added } = await autoPopulateBidSubs(bidId);

    const selections = await prisma.bidInviteSelection.findMany({
      where: { bidId },
      include: {
        subcontractor: {
          include: {
            contacts: { where: { isPrimary: true }, take: 1 },
            subTrades: { include: { trade: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    return Response.json({ added, selections });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/sync-preferred-subs] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
