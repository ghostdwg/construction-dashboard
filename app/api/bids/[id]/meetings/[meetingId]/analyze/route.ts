// POST /api/bids/[id]/meetings/[meetingId]/analyze
//
// Sends the meeting transcript to the sidecar for Claude analysis.
// Saves the resulting summary, action items, decisions, risks, and
// follow-up items to the database. Idempotent — re-running replaces
// prior AI-generated action items (manual items are preserved).

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

type ExtractedActionItem = {
  description?: string;
  assignedTo?: string;
  dueDate?: string | null;
  priority?: string;
  sourceText?: string;
};

type ExtractedRisk = {
  description?: string;
  severity?: string;
};

const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function normalizePriority(raw: string | undefined): string {
  const p = (raw ?? "MEDIUM").toUpperCase();
  return VALID_PRIORITIES.has(p) ? p : "MEDIUM";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true, title: true, meetingType: true, transcript: true, bid: { select: { projectName: true } } },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });
  if (!meeting.transcript?.trim())
    return Response.json({ error: "No transcript — upload audio or enter transcript manually" }, { status: 400 });

  // Optionally accept transcript override in body (for manual paste)
  const body = await request.json().catch(() => ({})) as { transcript?: string };
  const transcriptText = body.transcript?.trim() || meeting.transcript;

  await prisma.meeting.update({
    where: { id: mId },
    data: { status: "ANALYZING" },
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  try {
    const res = await fetch(`${SIDECAR_URL}/meetings/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        transcript: transcriptText,
        meetingTitle: meeting.title,
        meetingType: meeting.meetingType,
        projectName: meeting.bid.projectName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));
      await prisma.meeting.update({ where: { id: mId }, data: { status: "READY" } });
      return Response.json({ error: err.detail ?? "Analysis failed" }, { status: 502 });
    }

    const data = (await res.json()) as {
      summary?: string;
      actionItems?: ExtractedActionItem[];
      keyDecisions?: string[];
      risks?: ExtractedRisk[];
      followUpItems?: string[];
    };

    // Wipe prior AI-generated action items; keep manual ones
    await prisma.meetingActionItem.deleteMany({
      where: { meetingId: mId, sourceText: { not: null } },
    });

    const newItems = (data.actionItems ?? []).filter(
      (a) => a.description?.trim()
    );

    await prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: mId },
        data: {
          status: "READY",
          summary: data.summary ?? null,
          keyDecisions: JSON.stringify(data.keyDecisions ?? []),
          risks: JSON.stringify(
            (data.risks ?? []).map((r) => ({
              description: r.description ?? "",
              severity: (r.severity ?? "MEDIUM").toUpperCase(),
            }))
          ),
          followUpItems: JSON.stringify(data.followUpItems ?? []),
          analyzedAt: new Date(),
        },
      });

      if (newItems.length > 0) {
        await tx.meetingActionItem.createMany({
          data: newItems.map((item) => ({
            bidId,
            meetingId: mId,
            description: item.description!.trim(),
            assignedToName: item.assignedTo?.trim() || null,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            priority: normalizePriority(item.priority),
            status: "OPEN",
            sourceText: item.sourceText?.slice(0, 500) || null,
          })),
        });
      }
    });

    return Response.json({
      ok: true,
      summary: data.summary,
      actionItemsCreated: newItems.length,
      decisionsFound: (data.keyDecisions ?? []).length,
      risksFound: (data.risks ?? []).length,
    });
  } catch (err) {
    await prisma.meeting.update({ where: { id: mId }, data: { status: "READY" } });
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
