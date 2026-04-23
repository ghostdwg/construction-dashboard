// POST /api/bids/[id]/meetings/[meetingId]/analyze
//
// Runs the 8-section meeting intelligence analysis against the stored
// transcript using the Claude API directly.
//
// Body (all optional):
//   transcript  — override the stored transcript (manual paste)
//   mode        — "full" | "actions_only" | "flags_only"  (default: "full")
//
// Prior open items are fetched automatically from the most recent prior
// analyzed meeting on the same project — no manual paste required.
//
// Returns:
//   { ok, analysisVersion, participantsResolved, actionItemsCreated,
//     decisionsFound, openIssuesFound, redFlagsFound }

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import { getMaxTokens } from "@/lib/services/ai/aiTokenConfig";
import { logAiUsage } from "@/lib/services/ai/aiUsageLog";
import {
  buildAnalysisPrompt,
  getPriorOpenItems,
  parseMeetingAnalysis,
  writeMeetingAnalysis,
} from "@/lib/meeting-analysis";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const apiKey = await getSetting("ANTHROPIC_API_KEY");
  if (!apiKey)
    return Response.json(
      { error: "ANTHROPIC_API_KEY not configured — set it in /settings → AI Configuration" },
      { status: 503 },
    );

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

  // Build speaker roster string from resolved participants
  const speakerRoster = meeting.participants.length
    ? meeting.participants
        .map(p => `${p.speakerLabel ?? "?"} → ${p.name}${p.role ? ` (${p.role})` : ""}${p.company ? `, ${p.company}` : ""}`)
        .join("\n")
    : "";

  // GC team member names for §8 tagging
  const gcTeamMembers = meeting.participants
    .filter(p => p.isGcTeam)
    .map(p => p.name);

  // Auto-fetch prior open items — no manual paste needed
  const priorOpenItems = await getPriorOpenItems(mId, bidId);

  await prisma.meeting.update({ where: { id: mId }, data: { status: "ANALYZING" } });

  try {
    const prompt = buildAnalysisPrompt({
      transcript: transcriptText,
      projectName: meeting.bid.projectName,
      speakerRoster,
      gcTeamMembers,
      priorOpenItems,
      mode,
    });

    const client = new Anthropic({ apiKey });
    const maxTokens = await getMaxTokens("meeting-analysis");

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    await logAiUsage({
      callKey: "meeting-analysis",
      model: "claude-sonnet-4-6",
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      bidId,
    });

    const textBlock = message.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text")
      throw new Error("Claude returned no text content");

    const analysis = parseMeetingAnalysis(textBlock.text);

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
