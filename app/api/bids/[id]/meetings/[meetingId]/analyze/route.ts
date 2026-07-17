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
import { getSetting } from "@/lib/services/settings/appSettingsService";
import { getMaxTokens } from "@/lib/services/ai/aiTokenConfig";
import { logAiUsage, classifyAiFailure } from "@/lib/services/ai/aiUsageLog";
import {
  getOutstandingCommitments,
  getProjectContext,
  getPriorOpenItems,
  parseMeetingAnalysis,
  writeMeetingAnalysis,
} from "@/lib/meeting-analysis";
import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";
import { recordAnalysisRun } from "@/lib/services/meetingRegister/extractionRuns";
import { materializeSegments } from "@/lib/services/meetingRegister/segments";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  // R2-B1 hardening: requireBidAccess before any body parsing/service work.
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const { bidId, meetingId: mId, actor } = ctx;

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

  const apiKey = await getSetting("ANTHROPIC_API_KEY");
  if (!apiKey)
    return Response.json(
      { error: "ANTHROPIC_API_KEY not configured — set it in /settings → AI Configuration" },
      { status: 503 },
    );

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

  // Gather prior open items + live project context + token budget in parallel
  const [priorOpenItemsRaw, outstandingCommitments, projectContext, maxTokens] =
    await Promise.all([
      getPriorOpenItems(mId, bidId),
      getOutstandingCommitments(mId, bidId),
      getProjectContext(bidId),
      getMaxTokens("meeting-analysis"),
    ]);
  // OPS7 cross-meeting carry — outstanding commitments ride the existing
  // prior-items context block (context only; rows are never auto-modified).
  const priorOpenItems =
    outstandingCommitments === "none"
      ? priorOpenItemsRaw
      : `${priorOpenItemsRaw}\nOutstanding commitments from prior meetings:\n${outstandingCommitments}`;

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
        apiKey,
        maxTokens,
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

    // Evidence is recorded tightly around the real provider call only (the
    // sidecar fetch + response validation below) — a downstream
    // parse/write failure (parseMeetingAnalysis/writeMeetingAnalysis) is NOT
    // a provider-call failure and must never be recorded as such.
    let sidecarData: { ok: boolean; analysis: unknown; tokensUsed: { input: number; output: number } };
    try {
      if (!sidecarRes.ok) {
        const errText = await sidecarRes.text().catch(() => `HTTP ${sidecarRes.status}`);
        const httpErr = new Error(
          sidecarRes.status === 503 || sidecarRes.status === 0
            ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
            : `Sidecar error ${sidecarRes.status}: ${errText}`,
        ) as Error & { status?: number };
        httpErr.status = sidecarRes.status;
        throw httpErr;
      }

      sidecarData = await sidecarRes.json() as {
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
        status: "ok",
      });
    } catch (callErr) {
      await logAiUsage({
        callKey: "meeting-analysis",
        model: "claude-sonnet-4-6",
        inputTokens: 0,
        outputTokens: 0,
        bidId,
        status: "error",
        errorMessage: classifyAiFailure(callErr),
      });
      throw callErr;
    }

    const analysis = parseMeetingAnalysis(JSON.stringify(sidecarData.analysis));

    // R2-B1 — extraction-run discipline (rules 7–8): the FIRST analysis
    // applies immediately (lifecycle write + register projection); every
    // subsequent analysis lands as a PREVIEWED run for human apply/discard
    // so corrections' downstream effects are previewed, never auto-applied.
    const priorApplied = await prisma.meetingExtractionRun.count({
      where: { meetingId: mId, status: "APPLIED" },
    });

    let runId: number | null = null;
    let runStatus = "APPLIED";
    if (priorApplied === 0) {
      await materializeSegments(bidId, mId); // citation anchors for the projection
      const writeResult = await writeMeetingAnalysis(mId, bidId, analysis);
      const run = await recordAnalysisRun(bidId, mId, analysis, writeResult, actor);
      if (run.ok) runId = run.value.runId;
    } else {
      const run = await recordAnalysisRun(bidId, mId, analysis, null, actor);
      if (run.ok) {
        runId = run.value.runId;
        runStatus = run.value.status;
      }
    }

    await prisma.meeting.update({
      where: { id: mId },
      data: { status: "READY" },
    });

    return Response.json({
      ok: true,
      analysisVersion: meeting.analysisVersion + 1,
      extractionRunId: runId,
      extractionRunStatus: runStatus,
      participantsResolved: analysis.section2.length,
      actionItemsCreated: analysis.section5.length,
      decisionsFound: analysis.section4.length,
      openIssuesFound: analysis.section6.length,
      redFlagsFound: analysis.section7.length,
      designChangesFound: analysis.section9.length,
      commitmentsFound: analysis.section10.length,
    });
  } catch (err) {
    await prisma.meeting.update({ where: { id: mId }, data: { status: "READY" } });
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /analyze] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
