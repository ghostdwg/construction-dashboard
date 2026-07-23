import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { join } from "path";
import { readMeetingStorageBuffer } from "@/lib/services/meetings/storagePath";
import type { Prisma } from "@prisma/client";
import {
  FROZEN_TRANSCRIPT_CONFLICT,
  meetingTranscriptMutationGate,
  withMutableMeetingTranscript,
} from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";
import {
  isLegacyTranscriptionEnabled,
  legacyTranscriptionDisabledResponse,
} from "@/lib/services/meetings/legacyTranscriptionPolicy";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

type TeamsSource = {
  mode: "PERSON" | "SHARED_MIC" | "IGNORE";
  participantId?: number;
  participantIds?: number[];
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  if (!isLegacyTranscriptionEnabled()) {
    return legacyTranscriptionDisabledResponse();
  }

  // Source mapping re-arms transcription. Freeze before JSON parsing, audio
  // reads, or provider work when accountable transcript history exists.
  const preflight = await meetingTranscriptMutationGate(prisma, mId, bidId);
  if (!preflight.ok) {
    return Response.json(
      { error: preflight.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT },
      { status: preflight.reason === "not-found" ? 404 : 409 },
    );
  }

  const body = (await request.json()) as {
    sources?: Record<string, TeamsSource>;
    audioOffsetSeconds?: number;
  };

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: {
      id: true,
      status: true,
      speakerMapping: true,
      audioFileName: true,
      audioStorageKey: true,
      vttContent: true,
    },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });
  if (meeting.status !== "AWAITING_SOURCE_MAP")
    return Response.json({ error: "Meeting is not awaiting source mapping" }, { status: 400 });

  const commitState = async (
    data: Prisma.MeetingUpdateInput,
    action: string,
    payload: Record<string, unknown>,
  ) => {
    const guarded = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      await tx.meeting.update({ where: { id: mId }, data });
      return writeRegisterAuditTx(tx, {
        action,
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: { bidId, ...payload },
      });
    });
    if (guarded.ok) emitRegisterAuditPostCommit(guarded.value);
    return guarded;
  };

  const existing = meeting.speakerMapping
    ? JSON.parse(meeting.speakerMapping) as Record<string, unknown>
    : {};
  const sources = body.sources ?? {};
  const audioOffsetSeconds = body.audioOffsetSeconds ?? 0;
  const updatedSpeakerMapping = {
    ...existing,
    teams_sources: sources,
    audio_offset_seconds: audioOffsetSeconds,
  };

  let numSpeakers = 0;
  for (const source of Object.values(sources)) {
    if (source.mode === "PERSON") numSpeakers += 1;
    if (source.mode === "SHARED_MIC") numSpeakers += source.participantIds?.length ?? 0;
  }

  // Resolve the stored audio via the new audioStorageKey column when present
  // (relative BlobStore key, legacy cwd-rooted path, or production
  // storage-root path — see lib/services/meetings/storagePath.ts). Historic
  // rows written before this column existed have audioStorageKey === null —
  // for those, and ONLY for those, fall back to the pre-existing
  // naming-convention reconstruction (process.cwd()/uploads/meetings/{id}/
  // {audioFileName}) exactly as before this change.
  let audioBytes: Buffer;
  try {
    if (meeting.audioStorageKey) {
      audioBytes = await readMeetingStorageBuffer(meeting.audioStorageKey, bidId, mId);
    } else {
      audioBytes = await readMeetingStorageBuffer(
        join(process.cwd(), "uploads", "meetings", String(mId), meeting.audioFileName ?? ""),
        bidId,
        mId,
      );
    }
  } catch {
    const failed = await commitState(
      { status: "FAILED" },
      "meeting.transcription_failed",
      { completionPath: "HYBRID_SOURCE_AUDIO_READ" },
    );
    if (!failed.ok) {
      return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
    }
    return Response.json({ error: "Failed to read audio file" }, { status: 500 });
  }

  const armed = await commitState(
    {
      speakerMapping: JSON.stringify(updatedSpeakerMapping),
      status: "TRANSCRIBING",
    },
    "meeting.hybrid_source_mapping_submitted",
    { sourceCount: Object.keys(sources).length, numSpeakers },
  );
  if (!armed.ok) {
    return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
  }

  const headers: Record<string, string> = {};
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  void (async () => {
    const bgForm = new FormData();
    const audioBuffer = audioBytes.buffer.slice(
      audioBytes.byteOffset,
      audioBytes.byteOffset + audioBytes.byteLength
    ) as ArrayBuffer;
    bgForm.append(
      "audio",
      new Blob([audioBuffer], { type: "application/octet-stream" }),
      meeting.audioFileName ?? "audio.wav"
    );
    if (numSpeakers > 0) bgForm.append("num_speakers", String(numSpeakers));
    try {
      const res = await fetch(`${SIDECAR_URL}/meetings/transcribe`, {
        method: "POST",
        headers,
        body: bgForm,
      });
      if (!res.ok) {
        await commitState(
          { status: "FAILED" },
          "meeting.transcription_failed",
          { completionPath: "HYBRID_SOURCE_SUBMIT", providerStatus: res.status },
        );
        return;
      }
      const data = (await res.json()) as { transcriptionJobId: string; source: string };
      await commitState(
        {
          transcriptionJobId: `HYBRID:${data.transcriptionJobId}`,
          transcriptionSource: "HYBRID",
        },
        "meeting.transcription_started",
        { transcriptionSource: "HYBRID" },
      );
    } catch {
      await commitState(
        { status: "FAILED" },
        "meeting.transcription_failed",
        { completionPath: "HYBRID_SOURCE_SUBMIT" },
      );
    }
  })();

  return Response.json({ ok: true });
}
