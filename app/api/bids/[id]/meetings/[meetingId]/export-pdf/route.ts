// GET /api/bids/[id]/meetings/[meetingId]/export-pdf
//
// Fetches full meeting data from the DB, forwards it to the Python sidecar
// at POST /meetings/export-pdf (WeasyPrint), and streams the PDF bytes back
// to the browser as application/pdf with a Content-Disposition: attachment header.
//
// Requires a READY meeting with analysis (summary must be present).

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";

const safeArr = (raw: string | null): unknown[] => {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    include: {
      bid: { select: { projectName: true, location: true } },
      participants: { orderBy: { id: "asc" } },
      actionItems:  { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] },
    },
  });

  if (!meeting)
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  if (!meeting.summary)
    return Response.json({ error: "No analysis available — run Claude analysis first" }, { status: 422 });

  const payload = {
    projectName:     meeting.bid.projectName,
    projectLocation: meeting.bid.location,
    meetingTitle:    meeting.title,
    meetingDate:     meeting.meetingDate.toISOString(),
    meetingType:     meeting.meetingType,
    meetingLocation: meeting.location,
    summary:         meeting.summary,
    participants:    meeting.participants.map((p) => ({
      name:      p.name,
      role:      p.role,
      company:   p.company,
      isGcTeam:  p.isGcTeam,
    })),
    keyDecisions: safeArr(meeting.keyDecisions),
    actionItems:  meeting.actionItems.map((a) => ({
      description:    a.description,
      assignedToName: a.assignedToName,
      dueDate:        a.dueDate?.toISOString() ?? null,
      priority:       a.priority,
      status:         a.status,
      isGcTask:       a.isGcTask,
    })),
    openIssues: (safeArr(meeting.openIssues) as { text: string; reason: string; carriedFrom: string | null }[]),
    redFlags:   (safeArr(meeting.redFlags)   as { tag: string; description: string }[]),
  };

  const sidecarRes = await fetch(`${SIDECAR_URL}/meetings/export-pdf`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  }).catch((err) => {
    throw new Error(`Sidecar unavailable: ${err.message}`);
  });

  if (!sidecarRes.ok) {
    const errText = await sidecarRes.text().catch(() => `HTTP ${sidecarRes.status}`);
    const msg = sidecarRes.status === 501
      ? "WeasyPrint not installed — run `pip install weasyprint` in the sidecar venv"
      : `Sidecar error ${sidecarRes.status}: ${errText}`;
    return Response.json({ error: msg }, { status: 502 });
  }

  const pdfBuffer = await sidecarRes.arrayBuffer();

  const safeName = meeting.bid.projectName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  const safeTitle = meeting.title.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  const dateStr  = meeting.meetingDate.toISOString().slice(0, 10);
  const fileName = `${safeName}_${safeTitle}_${dateStr}.pdf`;

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
