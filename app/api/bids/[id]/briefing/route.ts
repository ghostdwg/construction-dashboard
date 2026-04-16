// POST /api/bids/[id]/briefing
//
// Assembles project data (schedule, submittals, action items, risk flags)
// and proxies to the Python sidecar to generate a WeasyPrint PDF briefing.
// Returns the PDF bytes as an attachment.

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivityShape = {
  name: string;
  startDate: string | null;
  finishDate: string | null;
  percentComplete: number;
  status: string;
  trade: string | null;
  isMilestone: boolean;
};

type SubmittalShape = {
  title: string;
  trade: string | null;
  type: string;
  submitByDate: string | null;
  requiredBy: string | null;
  status: string;
  isOverdue: boolean;
  isApproaching: boolean;
};

type ActionItemShape = {
  description: string;
  assignedToName: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  meetingTitle: string | null;
};

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as {
    asOfDate?: string;
    lookaheadDays?: number;
  };

  const asOfDate = body.asOfDate ? new Date(body.asOfDate) : new Date();
  const lookaheadDays = typeof body.lookaheadDays === "number" ? body.lookaheadDays : 14;

  if (isNaN(asOfDate.getTime()))
    return Response.json({ error: "Invalid asOfDate" }, { status: 400 });

  // ── Parallel data fetch ────────────────────────────────────────────────────

  const [bid, v2Schedule, legacyActivities, submittalRows, actionItemRows] =
    await Promise.all([
      // Bid + intelligence brief
      prisma.bid.findUnique({
        where: { id: bidId },
        select: {
          id: true,
          projectName: true,
          location: true,
          intelligenceBrief: { select: { riskFlags: true } },
        },
      }),

      // Phase 5C Schedule V2
      prisma.schedule.findFirst({
        where: { bidId },
        include: {
          activities: { orderBy: { sortOrder: "asc" } },
        },
      }),

      // H4 Legacy activities (fallback)
      prisma.scheduleActivity.findMany({
        where: { bidId },
        include: { bidTrade: { include: { trade: true } } },
        orderBy: { sequence: "asc" },
      }),

      // Submittals (exclude approved)
      prisma.submittalItem.findMany({
        where: {
          bidId,
          status: { notIn: ["APPROVED", "APPROVED_AS_NOTED"] },
        },
        include: { bidTrade: { include: { trade: true } } },
        orderBy: [{ submitByDate: "asc" }, { requiredBy: "asc" }],
      }),

      // Open action items (exclude closed)
      prisma.meetingActionItem.findMany({
        where: {
          bidId,
          status: { notIn: ["CLOSED"] },
        },
        include: { meeting: { select: { title: true, meetingDate: true } } },
        orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      }),
    ]);

  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // ── Activity classification ────────────────────────────────────────────────

  const weekMs = 7 * 86400000;
  const lookaheadMs = lookaheadDays * 86400000;
  const asOfMs = asOfDate.getTime();
  const weekEnd = new Date(asOfMs + weekMs);
  const lookaheadEnd = new Date(asOfMs + lookaheadMs);

  let allActivities: ActivityShape[] = [];

  if (v2Schedule && v2Schedule.activities.length > 0) {
    allActivities = v2Schedule.activities.map((a) => ({
      name: a.name,
      startDate: a.startDate?.toISOString() ?? null,
      finishDate: a.finishDate?.toISOString() ?? null,
      percentComplete: a.percentComplete,
      status: a.status,
      trade: a.trade ?? null,
      isMilestone: a.isMilestone,
    }));
  } else if (legacyActivities.length > 0) {
    allActivities = legacyActivities.map((a) => ({
      name: a.name,
      startDate: a.startDate?.toISOString() ?? null,
      finishDate: a.finishDate?.toISOString() ?? null,
      percentComplete: 0,
      status: "not_started",
      trade: a.bidTrade?.trade?.name ?? null,
      isMilestone: a.kind === "MILESTONE",
    }));
  }

  const scheduleThisWeek: ActivityShape[] = [];
  const scheduleOverdue: ActivityShape[] = [];
  const scheduleLookahead: ActivityShape[] = [];

  for (const a of allActivities) {
    const startMs = a.startDate ? new Date(a.startDate).getTime() : null;
    const finishMs = a.finishDate ? new Date(a.finishDate).getTime() : null;

    const isComplete = a.status === "complete";
    const isNotStarted = a.status === "not_started";

    // Overdue: finish < asOfDate, not complete, not "not_started"
    if (
      finishMs !== null &&
      finishMs < asOfMs &&
      !isComplete &&
      !isNotStarted
    ) {
      scheduleOverdue.push(a);
      continue;
    }

    // This week: in_progress OR start within [asOfDate, asOfDate+7d]
    if (
      a.status === "in_progress" ||
      (startMs !== null && startMs >= asOfMs && startMs <= weekEnd.getTime())
    ) {
      scheduleThisWeek.push(a);
      continue;
    }

    // Lookahead: start > asOfDate+7d AND start <= asOfDate+lookaheadDays
    if (
      startMs !== null &&
      startMs > weekEnd.getTime() &&
      startMs <= lookaheadEnd.getTime()
    ) {
      scheduleLookahead.push(a);
    }
  }

  // ── Submittal mapping ──────────────────────────────────────────────────────

  const mappedSubmittals: SubmittalShape[] = submittalRows.map((s) => {
    const dueDateMs =
      s.submitByDate?.getTime() ?? s.requiredBy?.getTime() ?? null;
    const isOverdue = dueDateMs !== null && dueDateMs < asOfMs;
    const isApproaching =
      !isOverdue &&
      dueDateMs !== null &&
      dueDateMs <= asOfMs + lookaheadMs;

    return {
      title: s.title,
      trade: s.bidTrade?.trade?.name ?? null,
      type: s.type,
      submitByDate: s.submitByDate?.toISOString() ?? null,
      requiredBy: s.requiredBy?.toISOString() ?? null,
      status: s.status,
      isOverdue,
      isApproaching,
    };
  });

  // ── Action items ───────────────────────────────────────────────────────────

  const mappedActionItems: ActionItemShape[] = actionItemRows.map((item) => ({
    description: item.description,
    assignedToName: item.assignedToName ?? null,
    dueDate: item.dueDate?.toISOString() ?? null,
    priority: item.priority,
    status: item.status,
    meetingTitle: item.meeting?.title ?? null,
  }));

  // ── Risk flags from intelligence brief ────────────────────────────────────

  let riskFlags: string[] = [];
  const rawRiskFlags = bid.intelligenceBrief?.riskFlags;
  if (rawRiskFlags) {
    try {
      const parsed = JSON.parse(rawRiskFlags);
      if (Array.isArray(parsed)) {
        riskFlags = parsed.map((r) =>
          typeof r === "string" ? r : (r as { flag?: string; text?: string }).flag ?? JSON.stringify(r)
        );
      }
    } catch {
      // silently ignore parse failures
    }
  }

  // ── Build payload + call sidecar ──────────────────────────────────────────

  const payload = {
    bid: {
      projectName: bid.projectName,
      location: bid.location ?? null,
    },
    asOfDate: asOfDate.toISOString(),
    lookaheadDays,
    schedule: {
      thisWeek: scheduleThisWeek,
      overdue: scheduleOverdue,
      lookahead: scheduleLookahead,
    },
    submittals: mappedSubmittals,
    actionItems: mappedActionItems,
    riskFlags,
  };

  const sidecarHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SIDECAR_API_KEY) sidecarHeaders["X-API-Key"] = SIDECAR_API_KEY;

  let sidecarResp: Response;
  try {
    sidecarResp = await fetch(`${SIDECAR_URL}/briefing/generate`, {
      method: "POST",
      headers: sidecarHeaders,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return Response.json(
      { error: `Sidecar unreachable: ${String(err)}` },
      { status: 502 }
    );
  }

  if (!sidecarResp.ok) {
    const detail = await sidecarResp.json().catch(() => ({ detail: "Sidecar error" }));
    return Response.json(
      { error: (detail as { detail?: string }).detail ?? "Sidecar error" },
      { status: 502 }
    );
  }

  // ── Stream PDF back ────────────────────────────────────────────────────────

  const pdfBytes = await sidecarResp.arrayBuffer();
  const safeName = (bid.projectName ?? "project")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="briefing-${safeName}-${asOfDate.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
