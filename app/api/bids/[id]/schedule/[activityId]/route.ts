// PATCH  /api/bids/[id]/schedule/[activityId]  → update one activity
// DELETE /api/bids/[id]/schedule/[activityId]  → delete one activity
//
// Note: the URL param here is the DB primary key (numeric id), not the
// Primavera activityId string. This matches how every other row-level
// endpoint in the app is wired.

import {
  updateScheduleActivity,
  deleteScheduleActivity,
  type ActivityUpdateInput,
} from "@/lib/services/schedule/scheduleService";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const { id, activityId } = await params;
  const bidId = parseInt(id, 10);
  const rowId = parseInt(activityId, 10);

  if (isNaN(bidId) || isNaN(rowId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  let body: ActivityUpdateInput;
  try {
    body = (await request.json()) as ActivityUpdateInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await updateScheduleActivity(bidId, rowId, body);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/bids/:id/schedule/:activityId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const { id, activityId } = await params;
  const bidId = parseInt(id, 10);
  const rowId = parseInt(activityId, 10);

  if (isNaN(bidId) || isNaN(rowId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  try {
    const result = await deleteScheduleActivity(bidId, rowId);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/bids/:id/schedule/:activityId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
