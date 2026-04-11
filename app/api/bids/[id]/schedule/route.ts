// GET  /api/bids/[id]/schedule  → list activities + project summary
// POST /api/bids/[id]/schedule  → manually add an activity

import {
  loadScheduleForBid,
  createScheduleActivity,
  type ActivityCreateInput,
} from "@/lib/services/schedule/scheduleService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const data = await loadScheduleForBid(bidId);
    return Response.json(data);
  } catch (err) {
    console.error("[GET /api/bids/:id/schedule]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: ActivityCreateInput;
  try {
    body = (await request.json()) as ActivityCreateInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await createScheduleActivity(bidId, body);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true, id: result.id });
  } catch (err) {
    console.error("[POST /api/bids/:id/schedule]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
