// GET /api/bids/[id]/meetings/[meetingId]/status
//
// Polls the sidecar for transcription status. STANDARD completion writes the
// durable transcript directly. HYBRID completion merges the GPU result with
// the stored VTT before committing one terminal result.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  FROZEN_TRANSCRIPT_CONFLICT,
  MEETING_OWNERSHIP_CONTENTION_CONFLICT,
  meetingTranscriptMutationGate,
  withMutableMeetingTranscript,
} from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";
import {
  completeJob,
  failJob,
  findJobByExternalId,
} from "@/lib/services/jobs/backgroundJobService";
import {
  isLegacyTranscriptionEnabled,
  legacyTranscriptionDisabledResponse,
} from "@/lib/services/meetings/legacyTranscriptionPolicy";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";

type SidecarParticipant = {
  speakerLabel: string;
  name: string;
  wordCount: number;
  totalSeconds?: number;
  segmentCount?: number;
  speakerType?: string;
};

type SidecarCluster = {
  id: string;
  type: "REMOTE" | "IN_ROOM";
  resolvedName: string | null;
  totalSeconds: number;
  segmentCount: number;
  vttOverlap?: string | null;
};

type CompletionData = {
  status: string;
  transcript: string | null;
  rawTranscript: string | null;
  durationSeconds: number | null;
  participants: SidecarParticipant[];
  speakerMapping?: string;
  clearVtt?: boolean;
};

function sidecarHeaders(): Record<string, string> {
  const key = process.env.SIDECAR_API_KEY?.trim();
  if (key) return { "X-API-Key": key };
  if (
    ["local", "development", "test"].includes(
      process.env.APP_ENV?.toLowerCase() ?? ""
    )
  ) {
    return {};
  }
  throw new Error("SIDECAR_API_KEY is required outside local/test mode");
}

async function finishTrackedJob(
  externalJobId: string,
  bidId: number,
  outcome: { status: "complete"; summary: string } | { status: "failed"; error: string }
) {
  try {
    const job = await findJobByExternalId(externalJobId, bidId);
    if (!job) return;
    if (outcome.status === "complete") {
      await completeJob(job.id, { resultSummary: outcome.summary });
    } else {
      await failJob(job.id, outcome.error);
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "BACKGROUND_JOB_RECONCILIATION_REQUIRED"
    ) {
      throw error;
    }
    throw Object.assign(
      new Error(`BackgroundJob for provider job ${externalJobId} requires durable reconciliation`),
      {
        code: "BACKGROUND_JOB_RECONCILIATION_REQUIRED",
        reconciliationCause: error,
      }
    );
  }
}

async function upsertParticipants(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  meetingId: number,
  participants: SidecarParticipant[]
) {
  const existing = await tx.meetingParticipant.findMany({
    where: { meetingId },
    select: { speakerLabel: true },
  });
  const existingLabels = new Set(existing.map((participant) => participant.speakerLabel));
  const uniqueByLabel = new Map<string, SidecarParticipant>();
  for (const participant of participants) {
    if (participant.speakerLabel && !uniqueByLabel.has(participant.speakerLabel)) {
      uniqueByLabel.set(participant.speakerLabel, participant);
    }
  }
  const fresh = [...uniqueByLabel.values()].filter(
    (participant) => !existingLabels.has(participant.speakerLabel)
  );
  if (fresh.length > 0) {
    await tx.meetingParticipant.createMany({
      data: fresh.map((participant) => ({
        meetingId,
        name: participant.name,
        speakerLabel: participant.speakerLabel,
        speakerType: participant.speakerType ?? "UNKNOWN",
      })),
    });
  }
}

async function authoritativeStatus(bidId: number, meetingId: number) {
  const current = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { status: true },
  });
  return Response.json({ status: current?.status ?? "FAILED" });
}

function transcriptConflictResponse(reason: "not-found" | "frozen" | "contention") {
  return Response.json(
    {
      error:
        reason === "not-found"
          ? "Not found"
          : reason === "contention"
            ? MEETING_OWNERSHIP_CONTENTION_CONFLICT
            : FROZEN_TRANSCRIPT_CONFLICT,
    },
    { status: reason === "not-found" ? 404 : 409 }
  );
}
export async function GET(
  _request: Request,
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

  let headers: Record<string, string>;
  try {
    headers = sidecarHeaders();
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 503 });
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: {
      id: true,
      status: true,
      transcriptionJobId: true,
      processingMode: true,
      vttContent: true,
      speakerMapping: true,
    },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  if (meeting.status !== "TRANSCRIBING" || !meeting.transcriptionJobId) {
    return Response.json({ status: meeting.status });
  }

  // Frozen meetings never reach Sidecar polling. The same decision is repeated
  // in each owning terminal transaction after the provider response arrives.
  const preflight = await meetingTranscriptMutationGate(prisma, mId, bidId);
  if (!preflight.ok) return transcriptConflictResponse(preflight.reason);

  const expectedJobId = meeting.transcriptionJobId;
  const isHybrid = expectedJobId.startsWith("HYBRID:");
  const realJobId = isHybrid
    ? expectedJobId.slice("HYBRID:".length)
    : expectedJobId;

  const finalizeCompletion = async (
    data: CompletionData,
    completionPath: string,
    extraPayload: Record<string, unknown> = {}
  ) => {
    const guarded = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      const claim = await tx.meeting.updateMany({
        where: {
          id: mId,
          bidId,
          status: "TRANSCRIBING",
          transcriptionJobId: expectedJobId,
          reviewStatus: { not: "PUBLISHED" },
          rawTranscript: null,
        },
        data: {
          status: data.status,
          transcript: data.transcript,
          rawTranscript: data.rawTranscript,
          durationSeconds: data.durationSeconds,
          ...(data.speakerMapping !== undefined
            ? { speakerMapping: data.speakerMapping }
            : {}),
          ...(data.clearVtt ? { vttContent: null } : {}),
        },
      });
      if (claim.count !== 1) return { won: false as const, audit: null };
      await upsertParticipants(tx, mId, data.participants);
      const audit = await writeRegisterAuditTx(tx, {
        action: "meeting.transcription_completed",
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: {
          bidId,
          completionPath,
          participantCount: data.participants.length,
          transcriptLength: data.transcript?.length ?? 0,
          rawTranscriptLength: data.rawTranscript?.length ?? 0,
          ...extraPayload,
        },
      });
      return { won: true as const, audit };
    });
    if (guarded.ok && guarded.value.won) {
      emitRegisterAuditPostCommit(guarded.value.audit);
    }
    return guarded;
  };

  const finalizeFailure = async (error: string | undefined) => {
    const guarded = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      const claim = await tx.meeting.updateMany({
        where: {
          id: mId,
          bidId,
          status: "TRANSCRIBING",
          transcriptionJobId: expectedJobId,
        },
        data: { status: "FAILED" },
      });
      if (claim.count !== 1) return { won: false as const, audit: null };
      const audit = await writeRegisterAuditTx(tx, {
        action: "meeting.transcription_failed",
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: {
          bidId,
          transcriptionSource: isHybrid ? "HYBRID" : "STANDARD",
          hasProviderError: Boolean(error),
        },
      });
      return { won: true as const, audit };
    });
    if (guarded.ok && guarded.value.won) {
      emitRegisterAuditPostCommit(guarded.value.audit);
    }
    return guarded;
  };

  try {
    const res = await fetch(
      `${SIDECAR_URL}/meetings/transcribe/status/${realJobId}`,
      { headers }
    );

    if (!res.ok) {
      return Response.json(
        { error: "Transcription service unavailable" },
        { status: 502 }
      );
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
      const failed = await finalizeFailure(data.error);
      if (!failed.ok) return transcriptConflictResponse(failed.reason);
      if (!failed.value.won) return authoritativeStatus(bidId, mId);
      await finishTrackedJob(realJobId, bidId, {
        status: "failed",
        error: "Transcription service reported failure",
      });
      return Response.json({
        status: "FAILED",
        error: "Transcription service reported failure",
      });
    }

    if (!isHybrid) {
      const completed = await finalizeCompletion(
        {
          status: "READY",
          transcript: data.transcript ?? null,
          rawTranscript: data.rawTranscript ?? null,
          durationSeconds: data.durationSeconds ?? null,
          participants: data.participants ?? [],
        },
        "STANDARD"
      );
      if (!completed.ok) return transcriptConflictResponse(completed.reason);
      if (!completed.value.won) return authoritativeStatus(bidId, mId);
      await finishTrackedJob(realJobId, bidId, {
        status: "complete",
        summary: "transcript ready",
      });
      return Response.json({ status: "READY" });
    }

    if (!meeting.vttContent) {
      const completed = await finalizeCompletion(
        {
          status: "READY",
          transcript: data.transcript ?? null,
          rawTranscript: data.rawTranscript ?? null,
          durationSeconds: data.durationSeconds ?? null,
          participants: data.participants ?? [],
        },
        "HYBRID_NO_VTT_FALLBACK"
      );
      if (!completed.ok) return transcriptConflictResponse(completed.reason);
      if (!completed.value.won) return authoritativeStatus(bidId, mId);
      await finishTrackedJob(realJobId, bidId, {
        status: "complete",
        summary: "hybrid transcript ready without VTT merge",
      });
      return Response.json({ status: "READY" });
    }

    const existingSpeakerMapping = meeting.speakerMapping
      ? (JSON.parse(meeting.speakerMapping) as {
          teams_sources?: unknown;
          audio_offset_seconds?: number;
          mapping?: Record<string, string>;
        })
      : {};
    const mergeBody: Record<string, unknown> = {
      rawTranscriptJson: data.rawTranscript ?? "{}",
      vttContent: meeting.vttContent,
      timeOffsetSeconds: existingSpeakerMapping.audio_offset_seconds ?? 0,
    };
    if (existingSpeakerMapping.teams_sources) {
      mergeBody.teams_sources = existingSpeakerMapping.teams_sources;
    }

    const mergeRes = await fetch(`${SIDECAR_URL}/meetings/merge-hybrid`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(mergeBody),
    });

    if (!mergeRes.ok) {
      const completed = await finalizeCompletion(
        {
          status: "READY",
          transcript: data.transcript ?? null,
          rawTranscript: data.rawTranscript ?? null,
          durationSeconds: data.durationSeconds ?? null,
          participants: data.participants ?? [],
          clearVtt: true,
        },
        "HYBRID_MERGE_FALLBACK"
      );
      if (!completed.ok) return transcriptConflictResponse(completed.reason);
      if (!completed.value.won) return authoritativeStatus(bidId, mId);
      await finishTrackedJob(realJobId, bidId, {
        status: "complete",
        summary: "hybrid transcript ready after merge fallback",
      });
      return Response.json({ status: "READY" });
    }

    const merged = (await mergeRes.json()) as {
      ok: boolean;
      transcript: string;
      participants: SidecarParticipant[];
      clusters: SidecarCluster[];
      durationSeconds: number;
    };
    const inRoomClusters = merged.clusters.filter((cluster) => cluster.type === "IN_ROOM");
    const nextStatus = inRoomClusters.length > 0 ? "AWAITING_NAMES" : "READY";
    const speakerMappingJson = JSON.stringify({
      ...existingSpeakerMapping,
      clusters: merged.clusters,
      mapping: existingSpeakerMapping.mapping ?? {},
    });

    const completed = await finalizeCompletion(
      {
        status: nextStatus,
        transcript: merged.transcript,
        rawTranscript: data.rawTranscript ?? null,
        durationSeconds: merged.durationSeconds,
        participants: merged.participants,
        speakerMapping: speakerMappingJson,
        clearVtt: true,
      },
      "HYBRID_MERGED",
      { inRoomClusterCount: inRoomClusters.length }
    );
    if (!completed.ok) return transcriptConflictResponse(completed.reason);
    if (!completed.value.won) return authoritativeStatus(bidId, mId);
    await finishTrackedJob(realJobId, bidId, {
      status: "complete",
      summary: `hybrid transcript ${nextStatus}`,
    });
    return Response.json({ status: nextStatus });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "BACKGROUND_JOB_RECONCILIATION_REQUIRED"
    ) {
      console.error("[meeting-status] durable BackgroundJob reconciliation required");
      return Response.json(
        {
          error: "Transcription result committed, but durable job reconciliation is required",
          code: "BACKGROUND_JOB_RECONCILIATION_REQUIRED",
          reconciliationRequired: true,
        },
        { status: 503 }
      );
    }
    return Response.json(
      { error: "Transcription status processing failed" },
      { status: 502 },
    );
  }
}
