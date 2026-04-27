// GET /api/bids/[id]/meetings/[meetingId]/status
//
// Polls the sidecar for transcription status. When the job completes:
//   - STANDARD jobs (ASSEMBLYAI / WHISPERX): saves transcript + participants,
//     advances status to READY.
//   - HYBRID jobs (HYBRID:{job_id}): after GPU job completes, calls sidecar
//     merge-hybrid with the stored VTT to combine named online speakers with
//     diarized in-room clusters. If in-room clusters exist → AWAITING_NAMES;
//     if all speakers are VTT-named → READY.

import { prisma } from "@/lib/prisma";

const SIDECAR_URL     = process.env.SIDECAR_URL     ?? "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY ?? "";

type SidecarParticipant = {
  speakerLabel: string;
  name:         string;
  wordCount:    number;
  totalSeconds?: number;
  segmentCount?: number;
  speakerType?:  string;
};

type SidecarCluster = {
  id:           string;
  type:         "REMOTE" | "IN_ROOM";
  resolvedName: string | null;
  totalSeconds: number;
  segmentCount: number;
};

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

async function upsertParticipants(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  meetingId: number,
  participants: SidecarParticipant[]
) {
  const existing = await tx.meetingParticipant.findMany({
    where:  { meetingId },
    select: { speakerLabel: true },
  });
  const existingLabels = new Set(existing.map((p) => p.speakerLabel));
  const fresh = participants.filter((p) => p.speakerLabel && !existingLabels.has(p.speakerLabel));
  if (fresh.length > 0) {
    await tx.meetingParticipant.createMany({
      data: fresh.map((p) => ({
        meetingId,
        name:        p.name,
        speakerLabel: p.speakerLabel,
        speakerType: p.speakerType ?? "UNKNOWN",
      })),
    });
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId   = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where:  { id: mId, bidId },
    select: { id: true, status: true, transcriptionJobId: true, processingMode: true, vttContent: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  if (meeting.status !== "TRANSCRIBING" || !meeting.transcriptionJobId)
    return Response.json({ status: meeting.status });

  const isHybrid = meeting.transcriptionJobId.startsWith("HYBRID:");
  // Unwrap the real job ID for the sidecar poll
  const realJobId = isHybrid
    ? meeting.transcriptionJobId.slice("HYBRID:".length)
    : meeting.transcriptionJobId;

  try {
    const res = await fetch(
      `${SIDECAR_URL}/meetings/transcribe/status/${realJobId}`,
      { headers: sidecarHeaders() }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));
      return Response.json({ error: (err as { detail?: string }).detail }, { status: 502 });
    }

    const data = (await res.json()) as {
      status:          "processing" | "completed" | "error";
      transcript?:     string;
      rawTranscript?:  string;
      durationSeconds?: number;
      participants?:   SidecarParticipant[];
      error?:          string;
    };

    if (data.status === "processing") return Response.json({ status: "TRANSCRIBING" });

    if (data.status === "error") {
      await prisma.meeting.update({ where: { id: mId }, data: { status: "FAILED" } });
      return Response.json({ status: "FAILED", error: data.error });
    }

    // ── Job completed ─────────────────────────────────────────────────────────

    if (!isHybrid) {
      // Standard flow — save transcript directly, advance to READY
      await prisma.$transaction(async (tx) => {
        await tx.meeting.update({
          where: { id: mId },
          data: {
            status:        "READY",
            transcript:    data.transcript  ?? null,
            rawTranscript: data.rawTranscript ?? null,
            durationSeconds: data.durationSeconds ?? null,
          },
        });
        await upsertParticipants(tx, mId, data.participants ?? []);
      });
      return Response.json({ status: "READY" });
    }

    // ── HYBRID: call sidecar merge-hybrid ─────────────────────────────────────
    if (!meeting.vttContent) {
      // VTT content missing — fall back to standard transcript
      await prisma.$transaction(async (tx) => {
        await tx.meeting.update({
          where: { id: mId },
          data: {
            status:        "READY",
            transcript:    data.transcript  ?? null,
            rawTranscript: data.rawTranscript ?? null,
            durationSeconds: data.durationSeconds ?? null,
          },
        });
        await upsertParticipants(tx, mId, data.participants ?? []);
      });
      return Response.json({ status: "READY" });
    }

    const mergeRes = await fetch(`${SIDECAR_URL}/meetings/merge-hybrid`, {
      method:  "POST",
      headers: { ...sidecarHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        rawTranscriptJson: data.rawTranscript ?? "{}",
        vttContent:        meeting.vttContent,
        timeOffsetSeconds: 0,
      }),
    });

    if (!mergeRes.ok) {
      // Merge failed — fall back to plain diarization transcript
      await prisma.$transaction(async (tx) => {
        await tx.meeting.update({
          where: { id: mId },
          data: {
            status:        "READY",
            transcript:    data.transcript  ?? null,
            rawTranscript: data.rawTranscript ?? null,
            durationSeconds: data.durationSeconds ?? null,
            vttContent:    null,
          },
        });
        await upsertParticipants(tx, mId, data.participants ?? []);
      });
      return Response.json({ status: "READY" });
    }

    const merged = (await mergeRes.json()) as {
      ok:              boolean;
      transcript:      string;
      participants:    SidecarParticipant[];
      clusters:        SidecarCluster[];
      durationSeconds: number;
    };

    const inRoomClusters = merged.clusters.filter((c) => c.type === "IN_ROOM");
    const hasInRoom      = inRoomClusters.length > 0;

    // Store cluster metadata in speakerMapping for the naming UI
    const speakerMappingJson = JSON.stringify({
      clusters: merged.clusters,
      mapping:  {},
    });

    const nextStatus = hasInRoom ? "AWAITING_NAMES" : "READY";

    await prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: mId },
        data: {
          status:          nextStatus,
          transcript:      merged.transcript,
          rawTranscript:   data.rawTranscript ?? null,
          durationSeconds: merged.durationSeconds,
          speakerMapping:  speakerMappingJson,
          vttContent:      null,  // clear — no longer needed
        },
      });
      await upsertParticipants(tx, mId, merged.participants);
    });

    return Response.json({ status: nextStatus });

  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
