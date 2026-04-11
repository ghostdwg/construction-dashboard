// POST /api/bids/[id]/schedule/recalculate
//
// Walks forward from Bid.constructionStartDate and recomputes start/finish
// dates for every activity based on duration + predecessor chain. Also
// updates Bid.projectDurationDays. Returns the project start/finish span.
//
// Most mutation endpoints already trigger a recalculation internally; this
// route is for manual "Recalculate" buttons and for when the construction
// start date itself changes via JobIntakePanel.

import { recalculateSchedule } from "@/lib/services/schedule/scheduleService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const result = await recalculateSchedule(bidId);
    return Response.json(result);
  } catch (err) {
    console.error("[POST /api/bids/:id/schedule/recalculate]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
