// POST /api/bids/[id]/meetings/[meetingId]/upload-hybrid
//
// Teams Hybrid upload: accepts a VTT file (Teams transcript) + an audio/video
// recording of the same meeting. The VTT names the online participants; the
// recording is diarized by the GPU worker to identify in-room speakers.
//
// Flow:
//   1. Store VTT text in meeting.vttContent
//   2. Send audio to sidecar → GPU worker (WhisperX async job)

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { meetingAudioStorageKey } from "@/lib/services/meetings/storagePath";
import {
  FROZEN_TRANSCRIPT_CONFLICT,
  meetingTranscriptMutationGate,
  withMutableMeetingTranscript,
} from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";

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
    select: { id: true, status: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const vttFile   = formData.get("vtt")   as File | null;
  const audioFile = formData.get("audio") as File | null;

  if (!vttFile)   return Response.json({ error: "vtt file is required"   }, { status: 400 });
  if (!audioFile) return Response.json({ error: "audio file is required" }, { status: 400 });

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
  const storedAudioKey = meetingAudioStorageKey(mId, safeAudioName);
  const blobStore = getBlobStore();
  try {
    await blobStore.put(storedAudioKey, Buffer.from(await audioFile.arrayBuffer()));
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
      await tx.meeting.update({
        where: { id: mId },
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
      return writeRegisterAuditTx(tx, {
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
    });
    if (!armed.ok) {
      await blobStore.delete(storedAudioKey).catch(() => undefined);
      return Response.json(
        { error: armed.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT },
        { status: armed.reason === "not-found" ? 404 : 409 },
      );
    }
    emitRegisterAuditPostCommit(armed.value);
  } catch (error) {
    await blobStore.delete(storedAudioKey).catch(() => undefined);
    throw error;
  }


  return Response.json({ ok: true, source: "HYBRID" });
}
