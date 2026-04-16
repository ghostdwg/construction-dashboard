// PATCH  /api/bids/[id]/meetings/[meetingId]/action-items/[itemId]
//   Update an action item. Accepted fields: description, assignedToName,
//   assignedToId, dueDate, priority, status, notes.
//   Closing (status → CLOSED) automatically sets closedAt.
//
// DELETE /api/bids/[id]/meetings/[meetingId]/action-items/[itemId]

import { prisma } from "@/lib/prisma";

const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const VALID_STATUSES = new Set(["OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; itemId: string }> }
) {
  const { id, meetingId, itemId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  const aId = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(mId) || isNaN(aId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.meetingActionItem.findFirst({
    where: { id: aId, meetingId: mId, bidId },
    select: { id: true, status: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.description !== undefined)
    data.description = String(body.description).trim();
  if (body.assignedToName !== undefined)
    data.assignedToName = body.assignedToName ? String(body.assignedToName).trim() : null;
  if (body.assignedToId !== undefined)
    data.assignedToId = body.assignedToId ? Number(body.assignedToId) : null;
  if (body.dueDate !== undefined)
    data.dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
  if (body.notes !== undefined)
    data.notes = body.notes ? String(body.notes).trim() : null;

  if (body.priority !== undefined) {
    const p = String(body.priority).toUpperCase();
    if (VALID_PRIORITIES.has(p)) data.priority = p;
  }

  if (body.status !== undefined) {
    const s = String(body.status).toUpperCase();
    if (VALID_STATUSES.has(s)) {
      data.status = s;
      // Auto-timestamp close
      if (s === "CLOSED" && existing.status !== "CLOSED") data.closedAt = new Date();
      if (s !== "CLOSED") data.closedAt = null;
    }
  }

  await prisma.meetingActionItem.update({ where: { id: aId }, data });
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; itemId: string }> }
) {
  const { id, meetingId, itemId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  const aId = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(mId) || isNaN(aId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.meetingActionItem.findFirst({
    where: { id: aId, meetingId: mId, bidId },
    select: { id: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.meetingActionItem.delete({ where: { id: aId } });
  return Response.json({ ok: true });
}
