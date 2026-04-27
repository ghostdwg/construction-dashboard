// POST /api/bids/[id]/meetings/[meetingId]/upload-hybrid
//
// Teams Hybrid upload: accepts a VTT file (Teams transcript) + an audio/video
// recording of the same meeting. The VTT names the online participants; the
// recording is diarized by the GPU worker to identify in-room speakers.
//
// Flow:
//   1. Store VTT text in meeting.vttContent
//   2. Send audio to sidecar → GPU worker (WhisperX async job)
//   3. Set meeting status = TRANSCRIBING, transcriptionJobId = "HYBRID:{job_id}",
//      processingMode = HYBRID
//   4. The /status polling route handles the merge when the GPU job completes.

import { prisma } from "@/lib/prisma";

const SIDECAR_URL    = process.env.SIDECAR_URL    ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

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

  // Mark as uploading and persist VTT content
  await prisma.meeting.update({
    where: { id: mId },
    data: {
      status:          "UPLOADING",
      processingMode:  "HYBRID",
      audioFileName:   audioFile.name,
      vttContent:      vttText,
      uploadedAt:      new Date(),
    },
  });

  // Proxy audio to sidecar → GPU worker
  const sidecarForm = new FormData();
  sidecarForm.append("audio", audioFile);

  const headers: Record<string, string> = {};
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  try {
    const res = await fetch(`${SIDECAR_URL}/meetings/transcribe`, {
      method:  "POST",
      headers,
      body:    sidecarForm,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));
      await prisma.meeting.update({
        where: { id: mId },
        data: { status: "FAILED" },
      });
      return Response.json(
        { error: (err as { detail?: string }).detail ?? "Sidecar error" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { transcriptionJobId: string; source: string };

    // Prefix job ID with HYBRID: so the /status route knows to run the merge
    await prisma.meeting.update({
      where: { id: mId },
      data: {
        status:              "TRANSCRIBING",
        transcriptionJobId:  `HYBRID:${data.transcriptionJobId}`,
        transcriptionSource: "HYBRID",
      },
    });

    return Response.json({ ok: true, source: "HYBRID" });

  } catch (err) {
    await prisma.meeting.update({
      where: { id: mId },
      data: { status: "FAILED" },
    });
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
