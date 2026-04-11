// POST /api/bids/[id]/schedule/seed
//
// Runs the schedule seeder: one construction activity per BidTrade plus
// two milestones, in canonical CSI order, with default durations and a
// forward FS chain. Idempotent — existing activities are skipped.

import { seedScheduleActivities } from "@/lib/services/schedule/scheduleService";

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
    const result = await seedScheduleActivities(bidId);
    return Response.json(result);
  } catch (err) {
    console.error("[POST /api/bids/:id/schedule/seed]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
