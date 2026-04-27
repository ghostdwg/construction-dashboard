// PATCH /api/bids/[id]/meetings/[meetingId]/speaker-mapping
//
// Called from the SpeakerNamingPanel after the user assigns names to in-room
// speaker clusters. Applies the mapping to the stored transcript, updates
// MeetingParticipant names, saves the final mapping, and advances status
// to READY so the user can run Claude analysis.
//
// Body: { mapping: { "SPEAKER_0": "Mike Johnson", "SPEAKER_1": "Sarah Chen" } }

import { prisma } from "@/lib/prisma";

const SIDECAR_URL     = process.env.SIDECAR_URL     ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where:  { id: mId, bidId },
    select: { id: true, status: true, transcript: true, speakerMapping: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    { mapping?: Record<string, string> } | null;
  const mapping = body?.mapping ?? {};

  if (typeof mapping !== "object" || Array.isArray(mapping))
    return Response.json({ error: "mapping must be an object" }, { status: 400 });

  // Apply names via sidecar helper (handles edge cases like SPEAKER_10 vs SPEAKER_1)
  let updatedTranscript = meeting.transcript ?? "";

  if (Object.keys(mapping).length > 0 && updatedTranscript) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    // Inline apply — the sidecar replace logic is simple enough to replicate
    // here so we don't need a round-trip for pure text replacement.
    for (const [label, name] of Object.entries(mapping)) {
      if (!name.trim()) continue;
      // Pattern: ] SPEAKER_N:  →  ] Name:
      // Sort longer labels first to avoid SPEAKER_1 matching inside SPEAKER_10
      updatedTranscript = updatedTranscript.replace(
        new RegExp(`(\\]\\s*)${escapeRegex(label)}(\\s*:)`, "g"),
        `$1${name.trim()}$2`
      );
    }
  }

  // Update speakerMapping to record the final name assignments
  let updatedSpeakerMapping = meeting.speakerMapping ?? "{}";
  try {
    const sm = JSON.parse(updatedSpeakerMapping) as {
      clusters?: unknown[];
      mapping?: Record<string, string>;
    };
    sm.mapping = { ...(sm.mapping ?? {}), ...mapping };
    updatedSpeakerMapping = JSON.stringify(sm);
  } catch {
    updatedSpeakerMapping = JSON.stringify({ mapping });
  }

  await prisma.$transaction(async (tx) => {
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
  });

  return Response.json({ ok: true });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
