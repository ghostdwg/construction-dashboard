// PATCH  /api/tasks/[id]
//   Update task fields: status, priority, dueDate, assignedToName, notes.
//   Automatically sets or clears closedAt when the status changes.
//
// DELETE /api/tasks/[id]
//   Deletes task. Works on any task (meeting-sourced or manual).

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const VALID_STATUSES = new Set(["OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"]);
const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const taskInclude = {
  bid: { select: { id: true, projectName: true, location: true } },
  meeting: { select: { id: true, title: true, meetingDate: true } },
} satisfies Prisma.MeetingActionItemInclude;

type TaskItemWithRelations = Prisma.MeetingActionItemGetPayload<{
  include: typeof taskInclude;
}>;

function shapeTaskItem(item: TaskItemWithRelations) {
  return {
    id: item.id,
    bidId: item.bidId,
    meetingId: item.meetingId,
    source: item.source,
    description: item.description,
    assignedToName: item.assignedToName,
    dueDate: item.dueDate?.toISOString() ?? null,
    priority: item.priority,
    status: item.status,
    isGcTask: item.isGcTask,
    carriedFromDate: item.carriedFromDate,
    closedAt: item.closedAt?.toISOString() ?? null,
    notes: item.notes,
    sourceText: item.sourceText,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    project: {
      id: item.bid.id,
      name: item.bid.projectName,
      location: item.bid.location,
    },
    meetingRef: item.meeting
      ? {
          title: item.meeting.title,
          date: item.meeting.meetingDate?.toISOString() ?? null,
        }
      : null,
    meeting: item.meeting
      ? {
          id: item.meeting.id,
          title: item.meeting.title,
          meetingDate: item.meeting.meetingDate?.toISOString() ?? null,
        }
      : null,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.meetingActionItem.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, closedAt: true },
  });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: Prisma.MeetingActionItemUpdateInput = {};

  if ("assignedToName" in body) {
    if (
      body.assignedToName !== null &&
      body.assignedToName !== "" &&
      typeof body.assignedToName !== "string"
    ) {
      return Response.json({ error: "assignedToName must be a string or null" }, { status: 400 });
    }

    data.assignedToName =
      typeof body.assignedToName === "string" ? body.assignedToName.trim() || null : null;
  }

  if ("dueDate" in body) {
    if (body.dueDate === null || body.dueDate === "") {
      data.dueDate = null;
    } else if (typeof body.dueDate === "string") {
      const nextDueDate = new Date(body.dueDate);
      if (Number.isNaN(nextDueDate.getTime())) {
        return Response.json({ error: "Invalid dueDate" }, { status: 400 });
      }
      data.dueDate = nextDueDate;
    } else {
      return Response.json({ error: "dueDate must be a string or null" }, { status: 400 });
    }
  }

  if ("priority" in body) {
    if (typeof body.priority !== "string") {
      return Response.json({ error: "priority must be a string" }, { status: 400 });
    }

    const priority = body.priority.toUpperCase();
    if (!VALID_PRIORITIES.has(priority)) {
      return Response.json({ error: "Invalid priority" }, { status: 400 });
    }

    data.priority = priority;
  }

  if ("status" in body) {
    if (typeof body.status !== "string") {
      return Response.json({ error: "status must be a string" }, { status: 400 });
    }

    const status = body.status.toUpperCase();
    if (!VALID_STATUSES.has(status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }

    data.status = status;
    if (status === "CLOSED" && existing.status !== "CLOSED") {
      data.closedAt = new Date();
    } else if (status !== "CLOSED") {
      data.closedAt = null;
    }
  }

  if ("notes" in body) {
    if (body.notes !== null && body.notes !== "" && typeof body.notes !== "string") {
      return Response.json({ error: "notes must be a string or null" }, { status: 400 });
    }

    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const item = await prisma.meetingActionItem.update({
    where: { id: taskId },
    data,
    include: taskInclude,
  });

  return Response.json({ ok: true, item: shapeTaskItem(item) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.meetingActionItem.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.meetingActionItem.delete({ where: { id: taskId } });
  return Response.json({ ok: true });
}
