// PATCH  /api/bids/[id]/schedule-v2/activities/[activityId]
//   Update activity fields. Optionally reconcile predecessors.
//   Body: { name?, duration?, notes?, status?, percentComplete?,
//           predecessors?: string (raw predecessor string, e.g. "A1010FS, A1020FS-4d") }
//
// DELETE /api/bids/[id]/schedule-v2/activities/[activityId]
//   Delete the activity and its dependency rows.
//
// Both return { ok, activities } — full updated list.

import {
  getOrCreateSchedule,
  updateActivityV2,
  deleteActivityV2,
  parsePredecessorString,
} from "@/lib/services/schedule/scheduleV2Service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const { id, activityId } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  try {
    const body = (await request.json()) as {
      name?: string;
      duration?: number;
      outlineLevel?: number;
      isMilestone?: boolean;
      csiCode?: string | null;
      trade?: string | null;
      notes?: string;
      status?: string;
      percentComplete?: number;
      weatherCode?: string;
      requiresInspection?: boolean;
      delayReason?: string | null;
      predecessors?: string; // raw string like "A1010FS, A1020FS-4d"
    };

    const scheduleId = await getOrCreateSchedule(bidId);

    // Parse predecessor string if provided
    const depsInput =
      "predecessors" in body
        ? parsePredecessorString(body.predecessors ?? "")
        : undefined;

    const { predecessors: _p, ...activityFields } = body;
    const result = await updateActivityV2(scheduleId, activityId, activityFields, depsInput);

    if (!result.ok) return Response.json(result, { status: 422 });
    return Response.json(result);
  } catch (err) {
    console.error("[PATCH schedule-v2/activities/:id]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const { id, activityId } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  try {
    const scheduleId = await getOrCreateSchedule(bidId);
    const result = await deleteActivityV2(scheduleId, activityId);

    if (!result.ok) return Response.json(result, { status: 422 });
    return Response.json(result);
  } catch (err) {
    console.error("[DELETE schedule-v2/activities/:id]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
