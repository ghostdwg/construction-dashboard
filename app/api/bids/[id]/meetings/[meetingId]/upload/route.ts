// POST /api/bids/[id]/meetings/[meetingId]/upload
//
// Accepts a multipart audio file, persists it to BlobStore for durability,
// then proxies it to the sidecar for WhisperX/AssemblyAI job submission.
// On success, stores transcriptionJobId + audioStorageKey and advances to
// TRANSCRIBING. Guards against duplicate submission of a live job.
//
// If no transcription service is available (sidecar 400), stores the audio
// and sets status to PENDING for manual transcript entry.

import { prisma } from "@/lib/prisma";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { meetingAudioStorageKey } from "@/lib/services/meetings/storagePath";
import {
  createJob,
  startJob,
  failJob,
} from "@/lib/services/jobs/backgroundJobService";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

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
    select: { id: true, status: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  // Guard: reject re-submission while a live job is already in flight.
  if (meeting.status === "TRANSCRIBING" || meeting.status === "UPLOADING") {
    return Response.json(
      { error: "Transcription already in progress" },
      { status: 409 }
    );
  }

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  if (!audioFile)
    return Response.json({ error: "audio file is required" }, { status: 400 });

  // Mark as uploading
  await prisma.meeting.update({
    where: { id: mId },
    data: {
      status: "UPLOADING",
      audioFileName: audioFile.name,
      uploadedAt: new Date(),
    },
  });

  // Persist audio to BlobStore before proxying — ensures retry is possible
  // after worker restart or sidecar failure without the user re-uploading.
  const safeFileName = safeBlobFileName(audioFile.name);
  const storageKey = meetingAudioStorageKey(mId, safeFileName);
  const audioBytes = Buffer.from(await audioFile.arrayBuffer());

  try {
    await getBlobStore().put(storageKey, audioBytes);
    await prisma.meeting.update({
      where: { id: mId },
      data: { audioStorageKey: storageKey, audioFileName: safeFileName },
    });
  } catch (err) {
    await prisma.meeting.update({
      where: { id: mId },
      data: { status: "FAILED" },
    });
    return Response.json({ error: `Storage failed: ${String(err)}` }, { status: 500 });
  }

  // Create a durable BackgroundJob record — survives worker and sidecar restarts.
  const bgJob = await createJob({
    jobType: "meeting_transcription",
    bidId,
    relatedId: String(mId),
    inputSummary: audioFile.name,
    triggerSource: "upload",
  });

  // Proxy to sidecar
  const sidecarForm = new FormData();
  // Re-create the File from the already-read bytes so the FormData includes it.
  sidecarForm.append("audio", new File([audioBytes], safeFileName, { type: audioFile.type }));
  const inRoomCount = await prisma.meetingParticipant.count({
    where: { meetingId: mId, speakerLabel: null, speakerType: "IN_ROOM" },
  });
  if (inRoomCount > 0) sidecarForm.append("num_speakers", String(inRoomCount));

  const headers: Record<string, string> = {};
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  try {
    const res = await fetch(`${SIDECAR_URL}/meetings/transcribe`, {
      method: "POST",
      headers,
      body: sidecarForm,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));

      // The sidecar returns 400 with "No transcription service available" (WhisperX +
      // AssemblyAI both unconfigured) or legacy "not configured" phrasing.
      const detailStr = String(err.detail ?? "");
      const isNoService =
        res.status === 400 &&
        (detailStr.includes("transcription service") || detailStr.includes("not configured"));
      if (isNoService) {
        // Remain PENDING for manual transcript entry. Audio is durably stored above.
        await prisma.meeting.update({
          where: { id: mId },
          data: { status: "PENDING" },
        });
        await failJob(bgJob.id, "No transcription service configured");
        return Response.json({
          ok: false,
          manual: true,
          message: "No transcription service available. Enter transcript manually.",
        });
      }

      await prisma.meeting.update({
        where: { id: mId },
        data: { status: "FAILED" },
      });
      await failJob(bgJob.id, String(err.detail ?? "Sidecar error"));
      return Response.json(
        { error: err.detail ?? "Sidecar error" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { transcriptionJobId: string; source: string };

    await prisma.meeting.update({
      where: { id: mId },
      data: {
        status: "TRANSCRIBING",
        transcriptionJobId: data.transcriptionJobId,
        transcriptionSource: data.source,
      },
    });

    await startJob(bgJob.id, data.transcriptionJobId);

    return Response.json({
      ok: true,
      transcriptionJobId: data.transcriptionJobId,
      source: data.source,
    });
  } catch (err) {
    await prisma.meeting.update({
      where: { id: mId },
      data: { status: "FAILED" },
    });
    await failJob(bgJob.id, String(err)).catch(() => {});
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
