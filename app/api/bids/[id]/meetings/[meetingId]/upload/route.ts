// POST /api/bids/[id]/meetings/[meetingId]/upload
//
// Accepts a multipart audio file, proxies it to the sidecar for
// AssemblyAI upload + job submission. On success, stores the
// transcriptionJobId on the meeting and advances status to TRANSCRIBING.
//
// If AssemblyAI is not configured (sidecar returns 400), the route stores
// the audio filename and sets status to PENDING so the user can paste the
// transcript manually.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  // Freeze check deliberately precedes multipart parsing and provider work.
  const preflight = await meetingTranscriptMutationGate(prisma, mId, bidId);
  if (!preflight.ok) {
    return Response.json(
      { error: preflight.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT },
      { status: preflight.reason === "not-found" ? 404 : 409 },
    );
  }

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  if (!audioFile)
    return Response.json({ error: "audio file is required" }, { status: 400 });

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

  // Mark as uploading, atomically with the mandatory audit. The transaction
  // repeats the freeze decision to close a materialization race after parsing.
  const started = await commitState(
    {
      status: "UPLOADING",
      audioFileName: audioFile.name,
      uploadedAt: new Date(),
    },
    "meeting.transcription_upload_started",
    { audioBytes: audioFile.size, contentType: audioFile.type || null },
  );
  if (!started.ok) {
    return Response.json(
      { error: started.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT },
      { status: started.reason === "not-found" ? 404 : 409 },
    );
  }

  // Proxy to sidecar
  const sidecarForm = new FormData();
  sidecarForm.append("audio", audioFile);
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

      if (res.status === 400 && String(err.detail).includes("not configured")) {
        // AssemblyAI not set up — remain PENDING for manual transcript entry
        const pending = await commitState(
          { status: "PENDING" },
          "meeting.transcription_unavailable",
          { providerStatus: res.status },
        );
        if (!pending.ok) {
          return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
        }
        return Response.json({
          ok: false,
          manual: true,
          message: "AssemblyAI not configured. Enter transcript manually.",
        });
      }

      const failed = await commitState(
        { status: "FAILED" },
        "meeting.transcription_failed",
        { providerStatus: res.status },
      );
      if (!failed.ok) {
        return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
      }
      return Response.json(
        { error: err.detail ?? "Sidecar error" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { transcriptionJobId: string; source: string };

    const armed = await commitState(
      {
        status: "TRANSCRIBING",
        transcriptionJobId: data.transcriptionJobId,
        transcriptionSource: data.source,
      },
      "meeting.transcription_started",
      { transcriptionSource: data.source },
    );
    if (!armed.ok) {
      return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
    }

    return Response.json({
      ok: true,
      transcriptionJobId: data.transcriptionJobId,
      source: data.source,
    });
  } catch (err) {
    const failed = await commitState(
      { status: "FAILED" },
      "meeting.transcription_failed",
      { failureClass: err instanceof Error ? err.name : "unknown" },
    );
    if (!failed.ok) {
      return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
    }
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
