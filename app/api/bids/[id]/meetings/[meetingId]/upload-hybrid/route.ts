// POST /api/bids/[id]/meetings/[meetingId]/upload-hybrid
//
// Teams Hybrid upload: accepts a VTT file (Teams transcript) + an audio/video
// recording of the same meeting. The VTT names the online participants; the
// recording is diarized by the GPU worker to identify in-room speakers.
//
// Flow:
//   1. Store VTT text in meeting.vttContent
//   2. Send audio to sidecar → GPU worker (WhisperX async job)

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import {
  MEETING_VTT_MAX_BYTES,
  meetingAudioStorageKey,
  validateMeetingMediaUpload,
} from "@/lib/services/meetings/storagePath";
import { deleteMeetingStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";
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

export async function POST(
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

  if (!isLegacyTranscriptionEnabled()) {
    return legacyTranscriptionDisabledResponse();
  }

  // Reject frozen meetings before multipart parsing or BlobStore activity.
  const preflight = await meetingTranscriptMutationGate(prisma, mId, bidId);
  if (!preflight.ok) {
    return Response.json(
      { error: preflight.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT },
      { status: preflight.reason === "not-found" ? 404 : 409 },
    );
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: {
      id: true,
      status: true,
      audioFileName: true,
      audioStorageKey: true,
    },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });
  const previousAudioStorageKey = meeting.audioStorageKey;

  const formData = await request.formData();
  const vttFile = formData.get("vtt");
  const audioFile = formData.get("audio");

  if (!(vttFile instanceof File)) return Response.json({ error: "vtt file is required" }, { status: 400 });
  if (!(audioFile instanceof File)) return Response.json({ error: "audio file is required" }, { status: 400 });
  if (vttFile.size <= 0 || vttFile.size > MEETING_VTT_MAX_BYTES) {
    return Response.json({ error: "vtt file is empty or too large" }, { status: 400 });
  }
  const mediaValidation = validateMeetingMediaUpload({
    fileName: audioFile.name,
    mimeType: audioFile.type,
    byteSize: audioFile.size,
  });
  if (!mediaValidation.ok) {
    return Response.json({ error: mediaValidation.error }, { status: 400 });
  }

  const vttText = await vttFile.text();
  if (!vttText.includes("WEBVTT"))
    return Response.json({ error: "vtt file does not appear to be a valid WebVTT file" }, { status: 400 });

  // Persist durably through BlobStore under a relative key matching
  // production's namespace convention (uploads/meetings/{meetingId}/{safe
  // name}) — never an absolute path. The sanitized name is also what's
  // stored in audioFileName, so the new audioStorageKey column and the
  // pre-existing naming-convention reconstruction (used for historic rows
  // with no audioStorageKey) always agree on the on-disk filename.
  const safeAudioName = safeBlobFileName(audioFile.name);
  const storedAudioKey = meetingAudioStorageKey(
    bidId,
    mId,
    randomUUID(),
    safeAudioName,
  );
  const blobStore = getBlobStore();
  try {
    await blobStore.put(storedAudioKey, Buffer.from(await audioFile.arrayBuffer()), {
      contentType: audioFile.type || "application/octet-stream",
    });
  } catch {
    const failed = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      await tx.meeting.update({ where: { id: mId }, data: { status: "FAILED" } });
      return writeRegisterAuditTx(tx, {
        action: "meeting.transcription_failed",
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: { bidId, completionPath: "HYBRID_UPLOAD_STORAGE" },
      });
    });
    if (!failed.ok) {
      return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
    }
    emitRegisterAuditPostCommit(failed.value);
    return Response.json({ error: "Failed to save audio file" }, { status: 500 });
  }

  const speakerLabels = Array.from(vttText.matchAll(/<v ([^>]+)>/g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index);

  try {
    const armed = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      const claim = await tx.meeting.updateMany({
        where: {
          id: mId,
          bidId,
          audioStorageKey: previousAudioStorageKey,
        },
        data: {
          status: "AWAITING_SOURCE_MAP",
          processingMode: "HYBRID",
          audioFileName: safeAudioName,
          audioStorageKey: storedAudioKey,
          vttContent: vttText,
          speakerMapping: JSON.stringify({ vtt_speakers: speakerLabels }),
          uploadedAt: new Date(),
        },
      });
      if (claim.count !== 1) return { claimed: false as const, audit: null };
      const audit = await writeRegisterAuditTx(tx, {
        action: "meeting.hybrid_upload_started",
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: {
          bidId,
          audioBytes: audioFile.size,
          vttBytes: vttFile.size,
          sourceCount: speakerLabels.length,
        },
      });
      return { claimed: true as const, audit };
    });
    if (!armed.ok) {
      await deleteMeetingStorageIfUnreferenced(storedAudioKey, bidId, mId).catch(() => undefined);
      return Response.json(
        { error: armed.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT },
        { status: armed.reason === "not-found" ? 404 : 409 },
      );
    }
    if (!armed.value.claimed) {
      await deleteMeetingStorageIfUnreferenced(storedAudioKey, bidId, mId).catch(() => undefined);
      return Response.json({ error: "Meeting media changed concurrently" }, { status: 409 });
    }
    emitRegisterAuditPostCommit(armed.value.audit);
  } catch (error) {
    await deleteMeetingStorageIfUnreferenced(storedAudioKey, bidId, mId).catch(() => undefined);
    throw error;
  }

  if (previousAudioStorageKey && previousAudioStorageKey !== storedAudioKey) {
    await deleteMeetingStorageIfUnreferenced(
      previousAudioStorageKey,
      bidId,
      mId,
    ).catch((err) => {
      console.error("[meeting-upload-hybrid] superseded audio cleanup failed:", err);
    });
  }


  return Response.json({ ok: true, source: "HYBRID" });
}
