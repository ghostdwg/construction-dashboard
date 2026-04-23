// PATCH  /api/tasks/[id]
//   Update task fields: status, priority, dueDate, assignedToName, notes, description.
//   Automatically sets closedAt when status transitions to CLOSED.
//
// DELETE /api/tasks/[id]
//   Deletes task. Works on any task (meeting-sourced or manual).

import { prisma } from "@/lib/prisma";

const VALID_STATUSES   = new Set(["OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"]);
const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.meetingActionItem.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, closedAt: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.description !== undefined && typeof body.description === "string")
    data.description = body.description.trim();

  if (body.assignedToName !== undefined)
    data.assignedToName = body.assignedToName ? String(body.assignedToName).trim() : null;

  if (body.dueDate !== undefined) {
    data.dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
  }

  if (body.priority !== undefined) {
    const p = String(body.priority).toUpperCase();
    if (VALID_PRIORITIES.has(p)) data.priority = p;
  }

  if (body.status !== undefined) {
    const s = String(body.status).toUpperCase();
    if (VALID_STATUSES.has(s)) {
      data.status = s;
      if (s === "CLOSED" && !existing.closedAt) data.closedAt = new Date();
      if (s !== "CLOSED") data.closedAt = null;
    }
  }

  if (body.notes !== undefined)
    data.notes = body.notes ? String(body.notes).trim() : null;

  if (Object.keys(data).length === 0)
    return Response.json({ error: "No valid fields to update" }, { status: 400 });

  await prisma.meetingActionItem.update({ where: { id: taskId }, data });
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.meetingActionItem.findUnique({
    where: { id: taskId }, select: { id: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.meetingActionItem.delete({ where: { id: taskId } });
  return Response.json({ ok: true });
}
