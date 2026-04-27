import { prisma } from "@/lib/prisma";
import { loadUsageForBid } from "@/lib/services/ai/aiUsageLog";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });

  const ledger = await loadUsageForBid(bidId);
  return Response.json(ledger);
}
