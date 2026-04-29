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
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

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

  try {
    const audioDir = join(process.cwd(), "uploads", "meetings", String(mId));
    await mkdir(audioDir, { recursive: true });
    await writeFile(join(audioDir, audioFile.name), Buffer.from(await audioFile.arrayBuffer()));
  } catch {
    await prisma.meeting.update({ where: { id: mId }, data: { status: "FAILED" } });
    return Response.json({ error: "Failed to save audio file" }, { status: 500 });
  }

  const speakerLabels = Array.from(vttText.matchAll(/<v ([^>]+)>/g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index);

  await prisma.meeting.update({
    where: { id: mId },
    data: {
      status:          "AWAITING_SOURCE_MAP",
      processingMode:  "HYBRID",
      audioFileName:   audioFile.name,
      vttContent:      vttText,
      speakerMapping:  JSON.stringify({ vtt_speakers: speakerLabels }),
      uploadedAt:      new Date(),
    },
  });


  return Response.json({ ok: true, source: "HYBRID" });
}
