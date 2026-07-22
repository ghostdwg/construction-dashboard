// GET  /api/tasks
//   Cross-project task register. Supports filter params:
//     status    — OPEN | IN_PROGRESS | CLOSED | DEFERRED  (default: open)
//     priority  — LOW | MEDIUM | HIGH | CRITICAL
//     bidId     — integer, filter to one project
//     source    — meeting | manual | all  (default: all)
//     overdue   — "true" — only past-due open items
//
// POST /api/tasks
//   Create a manual task (meetingId null, source "manual").
//   Body: { bidId, description, assignedToName?, dueDate?, priority?, notes? }

import { prisma } from "@/lib/prisma";
import { bidScopeFilter, requireBidAccess, requireUser } from "@/lib/auth-helpers";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";

const VALID_STATUSES = new Set(["OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"]);
const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  const { searchParams } = new URL(request.url);
  const statusParam  = searchParams.get("status");
  const priorityParam = searchParams.get("priority");
  const bidIdParam   = searchParams.get("bidId");
  const sourceParam  = searchParams.get("source") ?? "all";
  const overdueOnly  = searchParams.get("overdue") === "true";

  const now = new Date();

  // Build where clause
  const where: Record<string, unknown> = { bid: bidScopeFilter(user) };

  if (statusParam && statusParam !== "all") {
    if (!VALID_STATUSES.has(statusParam.toUpperCase()))
      return Response.json({ error: "Invalid status" }, { status: 400 });
    where.status = statusParam.toUpperCase();
  } else if (!statusParam) {
    // Default: open items only
    where.status = { in: ["OPEN", "IN_PROGRESS"] };
  }

  if (priorityParam && VALID_PRIORITIES.has(priorityParam.toUpperCase())) {
    where.priority = priorityParam.toUpperCase();
  }

  if (bidIdParam) {
    const bid = parseInt(bidIdParam, 10);
    if (!Number.isInteger(bid) || bid <= 0) {
      return Response.json({ error: "Invalid bidId" }, { status: 400 });
    }
    where.bidId = bid;
  }

  if (sourceParam !== "all") {
    where.source = sourceParam;
  }

  if (overdueOnly) {
    where.dueDate = { lt: now, not: null };
  }

  const items = await prisma.meetingActionItem.findMany({
    where,
    include: {
      bid:     { select: { id: true, projectName: true, location: true } },
      meeting: { select: { id: true, title: true, meetingDate: true } },
    },
    orderBy: [{ dueDate: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
    take: 300,
  });

  const shaped = items.map(item => ({
    id:             item.id,
    bidId:          item.bidId,
    meetingId:      item.meetingId,
    source:         item.source,
    description:    item.description,
    assignedToName: item.assignedToName,
    dueDate:        item.dueDate?.toISOString() ?? null,
    priority:       item.priority,
    status:         item.status,
    isGcTask:       item.isGcTask,
    carriedFromDate: item.carriedFromDate,
    closedAt:       item.closedAt?.toISOString() ?? null,
    notes:          item.notes,
    sourceText:     item.sourceText,
    createdAt:      item.createdAt.toISOString(),
    updatedAt:      item.updatedAt.toISOString(),
    project: {
      id:       item.bid.id,
      name:     item.bid.projectName,
      location: item.bid.location,
    },
    meetingRef: item.meeting ? {
      title: item.meeting.title,
      date: item.meeting.meetingDate?.toISOString() ?? null,
    } : null,
    meeting: item.meeting ? {
      id:          item.meeting.id,
      title:       item.meeting.title,
      meetingDate: item.meeting.meetingDate?.toISOString() ?? null,
    } : null,
  }));

  shaped.sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return Response.json(shaped);
}

export async function POST(request: Request) {
  try {
    await requireUser();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  const body = await request.json().catch(() => null) as {
    bidId?: number;
    description?: string;
    assignedToName?: string | null;
    dueDate?: string | null;
    priority?: string;
    notes?: string | null;
  } | null;

  if (!body?.bidId || !body.description?.trim())
    return Response.json({ error: "bidId and description are required" }, { status: 400 });

  const access = await requireBidAccess(body.bidId);
  if (!access.ok) return access.response;

  const priority = body.priority?.toUpperCase();

  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return Response.json({ error: "Invalid dueDate" }, { status: 400 });
  }
  let envelope = null;
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.meetingActionItem.create({
      data: {
        bidId: body.bidId!,
        meetingId: null,
        source: "manual",
        description: body.description!.trim(),
        assignedToName: body.assignedToName?.trim() ?? null,
        dueDate,
        priority: VALID_PRIORITIES.has(priority ?? "") ? priority! : "MEDIUM",
        status: "OPEN",
        notes: body.notes?.trim() ?? null,
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "meeting_action_item_created",
      decision: "manual_task_created",
      subjectKind: "MeetingActionItem",
      subjectId: created.id,
      actor: { id: access.user.id },
      payload: { bidId: body.bidId, source: "manual" },
    });
    return created;
  });
  emitRegisterAuditPostCommit(envelope);

  return Response.json({ ok: true, id: item.id }, { status: 201 });
}
