import { prisma } from "@/lib/prisma";
import {
  triggerBriefRefresh,
  TriggerError,
} from "@/lib/services/jobs/briefRefreshAutomation";

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
// Manually triggers brief regeneration via the shared durable brief-refresh path.
// Reuses triggerBriefRefresh() so manual and automation runs share the same
// duplicate guard, BackgroundJob record, and completion tracking.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const outcome = await triggerBriefRefresh(bidId, { triggerSource: "user" });

    if (outcome.status === "skipped") {
      return Response.json(
        { error: "A brief refresh is already in progress", reason: outcome.reason },
        { status: 409 }
      );
    }

    return Response.json({ success: true, status: outcome.briefStatus });
  } catch (err) {
    if (err instanceof TriggerError) {
      return Response.json({ error: err.message }, { status: err.httpStatus });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /intelligence] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
