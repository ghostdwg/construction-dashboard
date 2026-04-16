// GET /api/bids/[id]/meetings/[meetingId]/status
//
// Polls the sidecar for the current transcription status. When the
// transcription completes, saves the transcript, participants, and duration
// to the database and advances status to READY (or ANALYZING if
// auto-analyze is requested).
//
// The browser polls this endpoint every 5s while status === "TRANSCRIBING".

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

type SidecarParticipant = {
  speakerLabel: string;
  name: string;
  wordCount: number;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true, status: true, transcriptionJobId: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  // If not actively transcribing, return current status immediately
  if (meeting.status !== "TRANSCRIBING" || !meeting.transcriptionJobId) {
    return Response.json({ status: meeting.status });
  }

  const headers: Record<string, string> = {};
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  try {
    const res = await fetch(
      `${SIDECAR_URL}/meetings/transcribe/status/${meeting.transcriptionJobId}`,
      { headers }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));
      return Response.json({ error: err.detail }, { status: 502 });
    }

    const data = (await res.json()) as {
      status: "processing" | "completed" | "error";
      transcript?: string;
      rawTranscript?: string;
      durationSeconds?: number;
      participants?: SidecarParticipant[];
      error?: string;
    };

    if (data.status === "processing") {
      return Response.json({ status: "TRANSCRIBING" });
    }

    if (data.status === "error") {
      await prisma.meeting.update({
        where: { id: mId },
        data: { status: "FAILED" },
      });
      return Response.json({ status: "FAILED", error: data.error });
    }

    // Transcription complete — save transcript + create participants
    await prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: mId },
        data: {
          status: "READY",
          transcript: data.transcript ?? null,
          rawTranscript: data.rawTranscript ?? null,
          durationSeconds: data.durationSeconds ?? null,
        },
      });

      // Seed participants from diarization output (no-op if already exist)
      const existing = await tx.meetingParticipant.findMany({
        where: { meetingId: mId },
        select: { speakerLabel: true },
      });
      const existingLabels = new Set(existing.map((p) => p.speakerLabel));

      const newParticipants = (data.participants ?? []).filter(
        (p) => p.speakerLabel && !existingLabels.has(p.speakerLabel)
      );
      if (newParticipants.length > 0) {
        await tx.meetingParticipant.createMany({
          data: newParticipants.map((p) => ({
            meetingId: mId,
            name: p.name,
            speakerLabel: p.speakerLabel,
          })),
        });
      }
    });

    return Response.json({ status: "READY" });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
