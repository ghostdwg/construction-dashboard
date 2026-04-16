// POST /api/bids/[id]/schedule-v2/activities
//   Creates a new activity in the bid's schedule.
//   Body: { name, duration?, outlineLevel?, isMilestone?, csiCode?, trade?,
//           notes?, insertAfterSortOrder? }
//
// Returns { ok, activityId, activities } — the full updated activity list is
// returned so the client can update its store in one round trip.

import { getOrCreateSchedule, createActivityV2 } from "@/lib/services/schedule/scheduleV2Service";
import type { ActivityCreateInput } from "@/lib/services/schedule/scheduleV2Service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  try {
    const body = (await request.json()) as ActivityCreateInput & { insertAfterSortOrder?: number };

    const scheduleId = await getOrCreateSchedule(bidId);
    const result = await createActivityV2(scheduleId, body);

    if (!result.ok) return Response.json(result, { status: 422 });
    return Response.json(result, { status: 201 });
  } catch (err) {
    console.error("[POST schedule-v2/activities]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
