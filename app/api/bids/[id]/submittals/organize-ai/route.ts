// POST /api/bids/[id]/submittals/organize-ai
//
// Runs the AI Submittal Register Organizer on all auto-generated items for a bid.
// Replaces ai_extraction / csi_baseline / regex_seed / drawing_analysis / ai_organized
// items with a deduplicated, trade-packaged, Procore-ready register.
//
// Manual items (source: "manual") and packages containing manual items are never touched.

import { prisma } from "@/lib/prisma";
import { organizeSubmittalsWithAi } from "@/lib/services/submittal/organizeWithAi";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  try {
    const result = await organizeSubmittalsWithAi(bidId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
