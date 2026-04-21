// GET /api/bids/[id]/jobs
//
// GWX-007 — Bid-scoped job history for the morning summary panel.
// Returns recent BackgroundJob records for a bid, newest first.
// Reads from durable DB state — does not depend on sidecar in-memory state.

import { listJobsForBid } from "@/lib/services/jobs/backgroundJobService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "invalid bid id" }, { status: 400 });
  }

  const jobs = await listJobsForBid(bidId, 20);
  return Response.json({ jobs });
}
