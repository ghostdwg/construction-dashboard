import { prisma } from "@/lib/prisma";
import { generateBidIntelligenceBrief } from "@/lib/services/ai/generateBidIntelligenceBrief";

// GET /api/bids/[id]/intelligence
// Returns the current BidIntelligenceBrief or { brief: null }.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const brief = await prisma.bidIntelligenceBrief.findUnique({
    where: { bidId },
  });

  return Response.json({ brief: brief ?? null });
}

// POST /api/bids/[id]/intelligence
// Manually triggers brief regeneration.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set — AI generation unavailable" },
      { status: 503 }
    );
  }

  try {
    const { status, sourceContext } = await generateBidIntelligenceBrief(bidId, "manual");
    return Response.json({ success: true, status, sourceContext });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /intelligence] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
