// PATCH /api/bids/[id]/meetings/[meetingId]/speaker-mapping
//
// Called from the SpeakerNamingPanel after the user assigns names to in-room
// speaker clusters. Applies the mapping to the stored transcript, updates
// MeetingParticipant names, saves the final mapping, and advances status
// to READY so the user can run Claude analysis.
//
// Body: { mapping: { "SPEAKER_0": "Mike Johnson", "SPEAKER_1": "Sarah Chen" } }

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { meetingHasDurableHistory } from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const body = (await request.json().catch(() => null)) as
    { mapping?: Record<string, string> } | null;
  const mapping = body?.mapping ?? {};

  if (
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.entries(mapping).some(
      ([label, name]) => !label.trim() || typeof name !== "string",
    )
  )
    return Response.json({ error: "mapping must be an object" }, { status: 400 });

  const outcome = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.findFirst({
      where: { id: mId, bidId },
      select: { id: true, transcript: true, speakerMapping: true },
    });
    if (!meeting) return { kind: "not-found" as const };
    if (await meetingHasDurableHistory(tx, mId, bidId)) {
      return { kind: "conflict" as const };
    }

    let updatedTranscript = meeting.transcript ?? "";
    for (const [label, name] of Object.entries(mapping).sort(
      ([left], [right]) => right.length - left.length,
    )) {
      if (!name.trim()) continue;
      updatedTranscript = updatedTranscript.replace(
        new RegExp(`(\\]\\s*)${escapeRegex(label)}(\\s*:)`, "g"),
        `$1${name.trim()}$2`,
      );
    }

    let updatedSpeakerMapping: string;
    try {
      const sm = JSON.parse(meeting.speakerMapping ?? "{}") as {
        clusters?: unknown[];
        mapping?: Record<string, string>;
        teams_sources?: unknown;
        audio_offset_seconds?: unknown;
      };
      sm.mapping = { ...(sm.mapping ?? {}), ...mapping };
      updatedSpeakerMapping = JSON.stringify(sm);
    } catch {
      updatedSpeakerMapping = JSON.stringify({ mapping });
    }

    await tx.meeting.update({
      where: { id: mId },
      data: {
        transcript:     updatedTranscript,
        speakerMapping: updatedSpeakerMapping,
        status:         "READY",
      },
    });

    // Update MeetingParticipant names for in-room speakers
    for (const [label, name] of Object.entries(mapping)) {
      if (!name.trim()) continue;
      await tx.meetingParticipant.updateMany({
        where: { meetingId: mId, speakerLabel: label },
        data:  { name: name.trim() },
      });
    }
    const audit = await writeRegisterAuditTx(tx, {
      action: "meeting.speaker_mapping_updated",
      decision: "committed",
      subjectKind: "Meeting",
      subjectId: mId,
      actor: access.user,
      payload: { bidId, mappingCount: Object.keys(mapping).length },
    });
    return { kind: "committed" as const, audit };
  });

  if (outcome.kind === "not-found") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "conflict") {
    return Response.json(
      {
        error:
          "Legacy speaker mapping is locked after materialization or analysis. Use audited segment corrections.",
      },
      { status: 409 },
    );
  }
  emitRegisterAuditPostCommit(outcome.audit);

  return Response.json({ ok: true });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
