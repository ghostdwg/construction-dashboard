// POST /api/bids/[id]/meetings/[meetingId]/analyze
//
// Runs the 8-section meeting intelligence analysis by routing through
// the Python sidecar at :8001/meetings/analyze, which injects live project
// context (open RFIs, overdue submittals, open action items) before calling
// Claude — giving the model visibility into the current project state.
//
// Body (all optional):
//   transcript  — override the stored transcript (manual paste)
//   mode        — "full" | "actions_only" | "flags_only"  (default: "full")
//
// Returns:
//   { ok, analysisVersion, participantsResolved, actionItemsCreated,
//     decisionsFound, openIssuesFound, redFlagsFound }

import { prisma } from "@/lib/prisma";
import { logAiUsage } from "@/lib/services/ai/aiUsageLog";
import {
  getProjectContext,
  getPriorOpenItems,
  parseMeetingAnalysis,
  writeMeetingAnalysis,
} from "@/lib/meeting-analysis";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  // Load meeting + project context
  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: {
      id: true,
      title: true,
      meetingType: true,
      transcript: true,
      analysisVersion: true,
      bid: { select: { projectName: true } },
      participants: {
        select: { name: true, role: true, company: true, speakerLabel: true, isGcTeam: true },
      },
    },
  });
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as {
    transcript?: string;
    mode?: "full" | "actions_only" | "flags_only";
  };

  const transcriptText = body.transcript?.trim() || meeting.transcript?.trim();
  if (!transcriptText)
    return Response.json(
      { error: "No transcript — upload audio or paste transcript before analyzing" },
      { status: 400 },
    );

  const mode = body.mode ?? "full";

  const speakerRoster = meeting.participants.length
    ? meeting.participants
        .map(p => `${p.speakerLabel ?? "?"} → ${p.name}${p.role ? ` (${p.role})` : ""}${p.company ? `, ${p.company}` : ""}`)
        .join("\n")
    : "";

  const gcTeamMembers = meeting.participants
    .filter(p => p.isGcTeam)
    .map(p => p.name);

  // Gather prior open items + live project context in parallel
  const [priorOpenItems, projectContext] = await Promise.all([
    getPriorOpenItems(mId, bidId),
    getProjectContext(bidId),
  ]);

  await prisma.meeting.update({ where: { id: mId }, data: { status: "ANALYZING" } });

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const sidecarRes = await fetch(`${SIDECAR_URL}/meetings/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        transcript: transcriptText,
        meetingTitle: meeting.title,
        meetingType: meeting.meetingType,
        projectName: meeting.bid.projectName,
        mode,
        context: {
          speakerRoster,
          gcTeamMembers,
          priorOpenItems,
          openRfis: projectContext.openRfis,
          overdueSubmittals: projectContext.overdueSubmittals,
          openTasks: projectContext.openTasks,
        },
      }),
    });

    if (!sidecarRes.ok) {
      const errText = await sidecarRes.text().catch(() => `HTTP ${sidecarRes.status}`);
      throw new Error(
        sidecarRes.status === 503 || sidecarRes.status === 0
          ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
          : `Sidecar error ${sidecarRes.status}: ${errText}`,
      );
    }

    const sidecarData = await sidecarRes.json() as {
      ok: boolean;
      analysis: unknown;
      tokensUsed: { input: number; output: number };
    };

    if (!sidecarData.ok || !sidecarData.analysis)
      throw new Error("Sidecar returned unexpected response shape");

    await logAiUsage({
      callKey: "meeting-analysis",
      model: "claude-sonnet-4-6",
      inputTokens: sidecarData.tokensUsed.input,
      outputTokens: sidecarData.tokensUsed.output,
      bidId,
    });

    const analysis = parseMeetingAnalysis(JSON.stringify(sidecarData.analysis));

    await writeMeetingAnalysis(mId, bidId, analysis);

    await prisma.meeting.update({
      where: { id: mId },
      data: { status: "READY" },
    });

    return Response.json({
      ok: true,
      analysisVersion: meeting.analysisVersion + 1,
      participantsResolved: analysis.section2.length,
      actionItemsCreated: analysis.section5.length,
      decisionsFound: analysis.section4.length,
      openIssuesFound: analysis.section6.length,
      redFlagsFound: analysis.section7.length,
    });
  } catch (err) {
    await prisma.meeting.update({ where: { id: mId }, data: { status: "READY" } });
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /analyze] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
