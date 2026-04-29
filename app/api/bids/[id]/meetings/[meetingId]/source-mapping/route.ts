import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import { join } from "path";

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
      vttContent: true,
    },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });
  if (meeting.status !== "AWAITING_SOURCE_MAP")
    return Response.json({ error: "Meeting is not awaiting source mapping" }, { status: 400 });

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

  let audioBytes: Buffer;
  try {
    audioBytes = await readFile(
      join(process.cwd(), "uploads", "meetings", String(mId), meeting.audioFileName ?? "")
    );
  } catch {
    await prisma.meeting.update({ where: { id: mId }, data: { status: "FAILED" } });
    return Response.json({ error: "Failed to read audio file" }, { status: 500 });
  }

  await prisma.meeting.update({
    where: { id: mId },
    data: {
      speakerMapping: JSON.stringify(updatedSpeakerMapping),
      status: "TRANSCRIBING",
    },
  });

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
        await prisma.meeting.update({ where: { id: mId }, data: { status: "FAILED" } });
        return;
      }
      const data = (await res.json()) as { transcriptionJobId: string; source: string };
      await prisma.meeting.update({
        where: { id: mId },
        data: {
          transcriptionJobId: `HYBRID:${data.transcriptionJobId}`,
          transcriptionSource: "HYBRID",
        },
      });
    } catch {
      await prisma.meeting.update({ where: { id: mId }, data: { status: "FAILED" } });
    }
  })();

  return Response.json({ ok: true });
}
