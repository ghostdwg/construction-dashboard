// POST /api/bids/[id]/briefing
//
// Phase 5E — Superintendent Initial Assessment PDF
//
// Assembles a one-time project onboarding brief for the superintendent:
//   - Contract & spec risk flags (intelligence brief + spec pain points)
//   - Required inspections extracted from spec analysis (special, AHJ, third-party)
//   - Warranty requirements (manufacturer / installer / system — including install-date triggers)
//   - Training requirements for owner / maintenance staff
//   - Closeout deliverables checklist
//   - Long-lead / overdue submittals
//   - Schedule milestones (lookahead from reference date)
//   - Open preconstruction commitments (meeting action items)

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

const SEV_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, INFO: 4,
};

// ── AI extraction types ────────────────────────────────────────────────────────

type AiInspection = {
  type?: string;
  activity?: string;
  standard?: string;
  frequency?: string;
  timing?: string;
  who?: string;
  acceptance_criteria?: string;
};

type AiWarranty = {
  duration?: string;
  type?: string;
  scope?: string;
};

type AiTraining = {
  audience?: string;
  topic?: string;
  requirement?: string;
  duration?: string;
  timing?: string;
};

type AiCloseout = {
  type?: string;
  description?: string;
  quantity?: string;
  timing?: string;
};

type AiPainPoint = {
  issue?: string;
  severity?: string;
};

type FullExtraction = {
  severity?: string;
  inspections?: AiInspection[];
  warranty?: AiWarranty[];
  training?: AiTraining[];
  closeout?: AiCloseout[];
  pain_points?: AiPainPoint[];
  flags?: string[];
};

// ── Activity / submittal shapes ────────────────────────────────────────────────

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

// ── Spec extraction shapes (sent to sidecar) ───────────────────────────────────

type InspectionRow = AiInspection & { csiNumber: string; csiTitle: string; sectionSeverity: string | null };
type WarrantyRow   = AiWarranty   & { csiNumber: string; csiTitle: string };
type TrainingRow   = AiTraining   & { csiNumber: string; csiTitle: string };
type CloseoutRow   = AiCloseout   & { csiNumber: string; csiTitle: string; sectionSeverity: string | null };
type SpecFlag      = { csiNumber: string; csiTitle: string; flag: string; sectionSeverity: string | null };

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

  const asOfDate    = body.asOfDate ? new Date(body.asOfDate) : new Date();
  const lookaheadDays = typeof body.lookaheadDays === "number" ? body.lookaheadDays : 30;

  if (isNaN(asOfDate.getTime()))
    return Response.json({ error: "Invalid asOfDate" }, { status: 400 });

  // ── Find most recent analyzed spec book ────────────────────────────────────
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { id: true },
  });

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [bid, v2Schedule, legacyActivities, submittalRows, actionItemRows, specSections] =
    await Promise.all([
      prisma.bid.findUnique({
        where: { id: bidId },
        select: {
          id: true,
          projectName: true,
          location: true,
          intelligenceBrief: { select: { riskFlags: true } },
        },
      }),
      prisma.schedule.findFirst({
        where: { bidId },
        include: { activities: { orderBy: { sortOrder: "asc" } } },
      }),
      prisma.scheduleActivity.findMany({
        where: { bidId },
        include: { bidTrade: { include: { trade: true } } },
        orderBy: { sequence: "asc" },
      }),
      prisma.submittalItem.findMany({
        where: { bidId, status: { notIn: ["APPROVED", "APPROVED_AS_NOTED"] } },
        include: { bidTrade: { include: { trade: true } } },
        orderBy: [{ submitByDate: "asc" }, { requiredBy: "asc" }],
      }),
      prisma.meetingActionItem.findMany({
        where: { bidId, status: { notIn: ["CLOSED"] } },
        include: { meeting: { select: { title: true, meetingDate: true } } },
        orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      }),
      specBook
        ? prisma.specSection.findMany({
            where: { specBookId: specBook.id, aiExtractions: { not: null } },
            select: {
              id: true,
              csiNumber: true,
              csiTitle: true,
              csiCanonicalTitle: true,
              aiExtractions: true,
            },
            orderBy: { csiNumber: "asc" },
          })
        : Promise.resolve([]),
    ]);

  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // ── Flatten spec extractions ───────────────────────────────────────────────
  const inspections: InspectionRow[] = [];
  const warranties:  WarrantyRow[]   = [];
  const trainings:   TrainingRow[]   = [];
  const closeouts:   CloseoutRow[]   = [];
  const specFlags:   SpecFlag[]      = [];

  for (const section of specSections) {
    if (!section.aiExtractions) continue;
    let ext: FullExtraction;
    try { ext = JSON.parse(section.aiExtractions) as FullExtraction; }
    catch { continue; }

    const csiNumber    = section.csiNumber;
    const csiTitle     = section.csiCanonicalTitle ?? section.csiTitle;
    const sectionSeverity = ext.severity ?? null;

    for (const ins of ext.inspections ?? []) {
      if (!ins.activity?.trim()) continue;
      inspections.push({ ...ins, csiNumber, csiTitle, sectionSeverity });
    }
    for (const w of ext.warranty ?? []) {
      if (!w.scope?.trim() && !w.duration?.trim()) continue;
      warranties.push({ ...w, csiNumber, csiTitle });
    }
    for (const t of ext.training ?? []) {
      if (!t.topic?.trim()) continue;
      trainings.push({ ...t, csiNumber, csiTitle });
    }
    for (const c of ext.closeout ?? []) {
      if (!c.description?.trim()) continue;
      closeouts.push({ ...c, csiNumber, csiTitle, sectionSeverity });
    }
    for (const f of ext.flags ?? []) {
      if (!f.trim()) continue;
      specFlags.push({ csiNumber, csiTitle, flag: f, sectionSeverity });
    }
    // Surface HIGH/CRITICAL pain points as flags
    for (const pp of ext.pain_points ?? []) {
      if (!pp.issue?.trim()) continue;
      if (pp.severity === "HIGH" || pp.severity === "CRITICAL") {
        specFlags.push({ csiNumber, csiTitle, flag: pp.issue, sectionSeverity });
      }
    }
  }

  // Sort inspections: SPECIAL first, then by section severity
  const INS_TYPE_ORDER: Record<string, number> = {
    SPECIAL: 0, AHJ: 1, THIRD_PARTY: 2, OWNER_WITNESS: 3, CONTRACTOR_QC: 4, OTHER: 5,
  };
  inspections.sort((a, b) => {
    const ta = INS_TYPE_ORDER[a.type?.toUpperCase() ?? "OTHER"] ?? 5;
    const tb = INS_TYPE_ORDER[b.type?.toUpperCase() ?? "OTHER"] ?? 5;
    if (ta !== tb) return ta - tb;
    return (SEV_ORDER[a.sectionSeverity ?? "INFO"] ?? 4) - (SEV_ORDER[b.sectionSeverity ?? "INFO"] ?? 4);
  });

  // Sort specFlags by section severity
  specFlags.sort((a, b) =>
    (SEV_ORDER[a.sectionSeverity ?? "INFO"] ?? 4) - (SEV_ORDER[b.sectionSeverity ?? "INFO"] ?? 4)
  );

  // ── Intelligence brief risk flags ─────────────────────────────────────────
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
    } catch { /* ignore */ }
  }

  // ── Activity classification ────────────────────────────────────────────────
  const weekMs       = 7 * 86400000;
  const lookaheadMs  = lookaheadDays * 86400000;
  const asOfMs       = asOfDate.getTime();
  const weekEnd      = new Date(asOfMs + weekMs);
  const lookaheadEnd = new Date(asOfMs + lookaheadMs);

  let allActivities: ActivityShape[] = [];
  if (v2Schedule && v2Schedule.activities.length > 0) {
    allActivities = v2Schedule.activities.map((a) => ({
      name: a.name, startDate: a.startDate?.toISOString() ?? null,
      finishDate: a.finishDate?.toISOString() ?? null,
      percentComplete: a.percentComplete, status: a.status,
      trade: a.trade ?? null, isMilestone: a.isMilestone,
    }));
  } else {
    allActivities = legacyActivities.map((a) => ({
      name: a.name, startDate: a.startDate?.toISOString() ?? null,
      finishDate: a.finishDate?.toISOString() ?? null,
      percentComplete: 0, status: "not_started",
      trade: a.bidTrade?.trade?.name ?? null, isMilestone: a.kind === "MILESTONE",
    }));
  }

  const scheduleThisWeek: ActivityShape[]  = [];
  const scheduleOverdue: ActivityShape[]   = [];
  const scheduleLookahead: ActivityShape[] = [];

  for (const a of allActivities) {
    const startMs  = a.startDate  ? new Date(a.startDate).getTime()  : null;
    const finishMs = a.finishDate ? new Date(a.finishDate).getTime() : null;
    const isComplete   = a.status === "complete";
    const isNotStarted = a.status === "not_started";

    if (finishMs !== null && finishMs < asOfMs && !isComplete && !isNotStarted) {
      scheduleOverdue.push(a); continue;
    }
    if (a.status === "in_progress" || (startMs !== null && startMs >= asOfMs && startMs <= weekEnd.getTime())) {
      scheduleThisWeek.push(a); continue;
    }
    if (startMs !== null && startMs > weekEnd.getTime() && startMs <= lookaheadEnd.getTime()) {
      scheduleLookahead.push(a);
    }
  }

  // ── Submittal mapping ──────────────────────────────────────────────────────
  const mappedSubmittals: SubmittalShape[] = submittalRows.map((s) => {
    const dueDateMs = s.submitByDate?.getTime() ?? s.requiredBy?.getTime() ?? null;
    const isOverdue    = dueDateMs !== null && dueDateMs < asOfMs;
    const isApproaching = !isOverdue && dueDateMs !== null && dueDateMs <= asOfMs + lookaheadMs;
    return {
      title: s.title, trade: s.bidTrade?.trade?.name ?? null, type: s.type,
      submitByDate: s.submitByDate?.toISOString() ?? null,
      requiredBy: s.requiredBy?.toISOString() ?? null,
      status: s.status, isOverdue, isApproaching,
    };
  });

  // ── Action items ───────────────────────────────────────────────────────────
  const mappedActionItems: ActionItemShape[] = actionItemRows.map((item) => ({
    description: item.description, assignedToName: item.assignedToName ?? null,
    dueDate: item.dueDate?.toISOString() ?? null, priority: item.priority,
    status: item.status, meetingTitle: item.meeting?.title ?? null,
  }));

  // ── Build payload ──────────────────────────────────────────────────────────
  const payload = {
    bid:          { projectName: bid.projectName, location: bid.location ?? null },
    asOfDate:     asOfDate.toISOString(),
    lookaheadDays,
    riskFlags,
    specFlags,
    inspections,
    warranties,
    trainings,
    closeouts,
    schedule:     { thisWeek: scheduleThisWeek, overdue: scheduleOverdue, lookahead: scheduleLookahead },
    submittals:   mappedSubmittals,
    actionItems:  mappedActionItems,
  };

  const sidecarHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) sidecarHeaders["X-API-Key"] = SIDECAR_API_KEY;

  let sidecarResp: Response;
  try {
    sidecarResp = await fetch(`${SIDECAR_URL}/briefing/generate`, {
      method: "POST", headers: sidecarHeaders, body: JSON.stringify(payload),
    });
  } catch (err) {
    return Response.json({ error: `Sidecar unreachable: ${String(err)}` }, { status: 502 });
  }

  if (!sidecarResp.ok) {
    const detail = await sidecarResp.json().catch(() => ({ detail: "Sidecar error" }));
    return Response.json(
      { error: (detail as { detail?: string }).detail ?? "Sidecar error" },
      { status: 502 }
    );
  }

  const pdfBytes = await sidecarResp.arrayBuffer();
  const safeName = (bid.projectName ?? "project").replace(/[^a-z0-9]/gi, "-").toLowerCase();

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="briefing-${safeName}-${asOfDate.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
