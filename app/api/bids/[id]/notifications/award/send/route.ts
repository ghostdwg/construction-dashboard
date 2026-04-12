// POST /api/bids/[id]/notifications/award/send
//
// Module H8 — Sends award notification emails to awarded subs and/or the
// project team. Body: { estimatorName, estimatorEmail, customMessage?,
// sendToSubs, sendToTeam }. Returns { sent, skipped, failed }.

import {
  sendAwardNotifications,
  type SendOptions,
} from "@/lib/services/notifications/awardNotificationService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: SendOptions;
  try {
    body = (await request.json()) as SendOptions;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.estimatorName?.trim()) {
    return Response.json({ error: "estimatorName is required" }, { status: 400 });
  }
  if (!body.estimatorEmail?.trim() || !body.estimatorEmail.includes("@")) {
    return Response.json({ error: "estimatorEmail is required" }, { status: 400 });
  }
  if (!body.sendToSubs && !body.sendToTeam) {
    return Response.json({ error: "At least one of sendToSubs or sendToTeam must be true" }, { status: 400 });
  }

  try {
    const result = await sendAwardNotifications(bidId, body);
    return Response.json(result);
  } catch (err) {
    console.error("[POST /api/bids/:id/notifications/award/send]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
