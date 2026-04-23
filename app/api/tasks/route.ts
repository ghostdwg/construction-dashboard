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

const VALID_STATUSES = new Set(["OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"]);
const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam  = searchParams.get("status");
  const priorityParam = searchParams.get("priority");
  const bidIdParam   = searchParams.get("bidId");
  const sourceParam  = searchParams.get("source") ?? "all";
  const overdueOnly  = searchParams.get("overdue") === "true";

  const now = new Date();

  // Build where clause
  const where: Record<string, unknown> = {};

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
    if (!isNaN(bid)) where.bidId = bid;
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

  return Response.json(items.map(item => ({
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
    meeting: item.meeting ? {
      id:          item.meeting.id,
      title:       item.meeting.title,
      meetingDate: item.meeting.meetingDate?.toISOString() ?? null,
    } : null,
  })));
}

export async function POST(request: Request) {
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

  const bid = await prisma.bid.findUnique({ where: { id: body.bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const priority = body.priority?.toUpperCase();

  const item = await prisma.meetingActionItem.create({
    data: {
      bidId:         body.bidId,
      meetingId:     null,
      source:        "manual",
      description:   body.description.trim(),
      assignedToName: body.assignedToName?.trim() ?? null,
      dueDate:       body.dueDate ? new Date(body.dueDate) : null,
      priority:      VALID_PRIORITIES.has(priority ?? "") ? priority! : "MEDIUM",
      status:        "OPEN",
      notes:         body.notes?.trim() ?? null,
    },
  });

  return Response.json({ ok: true, id: item.id }, { status: 201 });
}
