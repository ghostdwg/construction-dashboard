// POST /api/bids/[id]/meetings/[meetingId]/upload
//
// Accepts a multipart audio file, persists it under a server-generated,
// retry-safe BlobStore key, then proxies it to the sidecar for transcription.
// On success, stores the transcriptionJobId and advances to TRANSCRIBING.
//
// If no transcription provider is configured (sidecar returns 400), the route
// retains the durable audio and sets PENDING for manual transcript entry.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  FROZEN_TRANSCRIPT_CONFLICT,
  MEETING_OWNERSHIP_CONTENTION_CONFLICT,
  meetingTranscriptMutationGate,
  withActiveMeetingTranscriptMutation,
  withMutableMeetingTranscript,
} from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";
import {
  getBlobStore,
  safeBlobFileName,
  type BlobStore,
} from "@/lib/storage/blobStore";
import { meetingAudioStorageKey } from "@/lib/services/meetings/storagePath";
import {
  createJob,
  failJob,
  startJob,
} from "@/lib/services/jobs/backgroundJobService";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";

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

async function allocateAudioKey(
  store: BlobStore,
  meetingId: number,
  safeFileName: string
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = meetingAudioStorageKey(
      meetingId,
      `${randomUUID()}-${safeFileName}`
    );
    if (!(await store.exists(key))) return key;
  }
  throw new Error("Unable to allocate an unused meeting audio storage key");
}

async function reconcileFailedJob(
  jobId: string,
  message: string,
  externalJobId?: string,
): Promise<Response | null> {
  try {
    await (externalJobId
      ? failJob(jobId, message, externalJobId)
      : failJob(jobId, message));
    return null;
  } catch (error) {
    console.error(
      `[meeting-upload] BackgroundJob ${jobId} requires reconciliation:`,
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      {
        error: message,
        reconciliationRequired: true,
        backgroundJobId: jobId,
      },
      { status: 503 },
    );
  }
}

type BlobCompensation =
  | { ok: true; deleted: boolean }
  | { ok: false; error: unknown };

async function compensateUnreferencedAudioBlob(
  store: BlobStore,
  meetingId: number,
  storageKey: string,
): Promise<BlobCompensation> {
  try {
    // The schema has no BackgroundJob→blob pointer. The Meeting pointer is
    // therefore the durable reference boundary. Re-check it immediately
    // before delete so compensation can never remove a prior/successful blob.
    const referenced = await prisma.meeting.findFirst({
      where: { id: meetingId, audioStorageKey: storageKey },
      select: { audioStorageKey: true },
    });
    if (referenced?.audioStorageKey === storageKey) {
      return { ok: true, deleted: false };
    }
    await store.delete(storageKey);
    return { ok: true, deleted: true };
  } catch (error) {
    console.error(
      "[meeting-upload] Unreferenced audio cleanup requires operator reconciliation",
    );
    return { ok: false, error };
  }
}

const UPLOADABLE_STATUSES = ["PENDING", "FAILED"] as const;

function canUploadSource(meeting: {
  status: string;
  reviewStatus: string;
  rawTranscript: string | null;
  analyzedAt: Date | null;
}) {
  return (
    UPLOADABLE_STATUSES.includes(
      meeting.status as (typeof UPLOADABLE_STATUSES)[number]
    ) &&
    meeting.reviewStatus !== "PUBLISHED" &&
    meeting.rawTranscript === null &&
    meeting.analyzedAt === null
  );
}

function transcriptConflictResponse(
  reason: "not-found" | "frozen" | "state-conflict" | "contention",
) {
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

  let headers: Record<string, string>;
  try {
    headers = sidecarHeaders();
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 503 });
  }

  // The shared five-trigger gate deliberately precedes multipart parsing,
  // BlobStore access, BackgroundJob work, and provider submission.
  const preflight = await meetingTranscriptMutationGate(prisma, mId, bidId);
  if (!preflight.ok) return transcriptConflictResponse(preflight.reason);

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: {
      id: true,
      status: true,
      reviewStatus: true,
      rawTranscript: true,
      analyzedAt: true,
      audioFileName: true,
      audioStorageKey: true,
    },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  if (!canUploadSource(meeting)) {
    return Response.json(
      { error: "Meeting source is not eligible for upload" },
      { status: 409 }
    );
  }

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  if (!audioFile)
    return Response.json({ error: "audio file is required" }, { status: 400 });

  const safeFileName = safeBlobFileName(audioFile.name);

  const commitState = async (
    data: Prisma.MeetingUpdateInput,
    action: string,
    payload: Record<string, unknown>,
    expectedStatus: "UPLOADING" | "TRANSCRIBING" = "UPLOADING",
  ) => {
    const guarded = await withActiveMeetingTranscriptMutation(
      bidId,
      mId,
      expectedStatus,
      async (tx) => {
      await tx.meeting.update({ where: { id: mId }, data });
      return writeRegisterAuditTx(tx, {
        action,
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: { bidId, ...payload },
      });
      },
    );
    if (guarded.ok) emitRegisterAuditPostCommit(guarded.value);
    return guarded;
  };

  // Repeat both the five-trigger freeze decision and the complete media
  // eligibility predicate in one transaction after multipart parsing.
  const started = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
    const claim = await tx.meeting.updateMany({
      where: {
        id: mId,
        bidId,
        status: { in: [...UPLOADABLE_STATUSES] },
        reviewStatus: { not: "PUBLISHED" },
        rawTranscript: null,
        analyzedAt: null,
      },
      data: {
        status: "UPLOADING",
        audioFileName: safeFileName,
        uploadedAt: new Date(),
      },
    });
    if (claim.count !== 1) return { claimed: false as const, audit: null };
    const audit = await writeRegisterAuditTx(tx, {
      action: "meeting.transcription_upload_started",
      decision: "committed",
      subjectKind: "Meeting",
      subjectId: mId,
      actor: access.user,
      payload: {
        bidId,
        audioBytes: audioFile.size,
        contentType: audioFile.type || null,
      },
    });
    return { claimed: true as const, audit };
  });
  if (!started.ok) return transcriptConflictResponse(started.reason);
  if (!started.value.claimed) {
    return Response.json(
      { error: "Meeting source is not eligible for upload" },
      { status: 409 }
    );
  }
  emitRegisterAuditPostCommit(started.value.audit);

  let audioBytes: Buffer;
  try {
    audioBytes = Buffer.from(await audioFile.arrayBuffer());
  } catch {
    const failed = await commitState(
      { status: "FAILED" },
      "meeting.transcription_failed",
      { failureClass: "audio-read" }
    );
    if (!failed.ok) return transcriptConflictResponse(failed.reason);
    return Response.json({ error: "Unable to read audio upload" }, { status: 400 });
  }
  let store: BlobStore;
  let storageKey: string;
  try {
    store = getBlobStore();
    storageKey = await allocateAudioKey(store, mId, safeFileName);
    await store.put(storageKey, audioBytes, { contentType: audioFile.type });
  } catch {
    const failed = await commitState(
      { status: "FAILED" },
      "meeting.transcription_failed",
      { failureClass: "audio-storage" }
    );
    if (!failed.ok) return transcriptConflictResponse(failed.reason);
    return Response.json({ error: "Audio storage failed" }, { status: 500 });
  }

  let backgroundJobId: string;
  try {
    backgroundJobId = (
      await createJob({
        jobType: "meeting_transcription",
        bidId,
        relatedId: String(mId),
        inputSummary: `meeting ${mId} audio upload`,
        triggerSource: "upload",
      })
    ).id;
  } catch {
    const cleanup = await compensateUnreferencedAudioBlob(store, mId, storageKey);
    const failed = await commitState(
      {
        status: "FAILED",
        audioFileName: meeting.audioFileName,
      },
      "meeting.transcription_failed",
      { failureClass: "job-tracking", blobCleanupFailed: !cleanup.ok },
    );
    if (!failed.ok) return transcriptConflictResponse(failed.reason);
    return Response.json(
      {
        error: "Unable to reserve transcription tracking",
        ...(!cleanup.ok ? { cleanupRequired: true } : {}),
      },
      { status: 503 },
    );
  }

  let stored: Awaited<ReturnType<typeof commitState>> | null = null;
  let pointerError: unknown = null;
  try {
    stored = await commitState(
      { audioStorageKey: storageKey },
      "meeting.transcription_audio_stored",
      { audioBytes: audioBytes.length, contentType: audioFile.type || null },
    );
  } catch (error) {
    pointerError = error;
  }
  if (!stored?.ok) {
    const reconciliation = await reconcileFailedJob(
      backgroundJobId,
      "Unable to persist meeting audio reference",
    );
    const cleanup = await compensateUnreferencedAudioBlob(store, mId, storageKey);
    if (stored && !stored.ok) {
      if (reconciliation) return reconciliation;
      if (!cleanup.ok) {
        return Response.json(
          { error: "Unable to persist meeting audio reference", cleanupRequired: true },
          { status: 503 },
        );
      }
      return transcriptConflictResponse(stored.reason);
    }
    const failed = await commitState(
      {
        status: "FAILED",
        audioFileName: meeting.audioFileName,
      },
      "meeting.transcription_failed",
      {
        failureClass: "audio-pointer",
        blobCleanupFailed: !cleanup.ok,
        pointerErrorClass: pointerError instanceof Error ? pointerError.name : "unknown",
      },
    ).catch(() => null);
    if (failed && !failed.ok) return transcriptConflictResponse(failed.reason);
    if (reconciliation) return reconciliation;
    return Response.json(
      {
        error: "Unable to persist meeting audio reference",
        ...(!cleanup.ok ? { cleanupRequired: true } : {}),
      },
      { status: cleanup.ok ? 500 : 503 },
    );
  }

  const sidecarForm = new FormData();
  sidecarForm.append(
    "audio",
    new File([Uint8Array.from(audioBytes)], safeFileName, {
      type: audioFile.type,
    })
  );
  const inRoomCount = await prisma.meetingParticipant.count({
    where: { meetingId: mId, speakerLabel: null, speakerType: "IN_ROOM" },
  });
  if (inRoomCount > 0) sidecarForm.append("num_speakers", String(inRoomCount));

  try {
    const res = await fetch(`${SIDECAR_URL}/meetings/transcribe`, {
      method: "POST",
      headers,
      body: sidecarForm,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));
      const detail = String(err.detail ?? "");
      const noProvider =
        res.status === 400 &&
        (detail.includes("transcription service") || detail.includes("not configured"));

      if (noProvider) {
        const pending = await commitState(
          { status: "PENDING" },
          "meeting.transcription_unavailable",
          { providerStatus: res.status }
        );
        if (!pending.ok) return transcriptConflictResponse(pending.reason);
        const reconciliation = await reconcileFailedJob(
          backgroundJobId,
          "No transcription service configured",
        );
        if (reconciliation) return reconciliation;
        return Response.json({
          ok: false,
          manual: true,
          message: "No transcription service available. Enter transcript manually.",
        });
      }

      const failed = await commitState(
        { status: "FAILED" },
        "meeting.transcription_failed",
        { providerStatus: res.status }
      );
      if (!failed.ok) return transcriptConflictResponse(failed.reason);
      const reconciliation = await reconcileFailedJob(
        backgroundJobId,
        detail || "Sidecar error",
      );
      if (reconciliation) return reconciliation;
      return Response.json({ error: err.detail ?? "Sidecar error" }, { status: 502 });
    }

    const data = (await res.json()) as {
      transcriptionJobId: string;
      source: string;
    };
    const armed = await commitState(
      {
        status: "TRANSCRIBING",
        transcriptionJobId: data.transcriptionJobId,
        transcriptionSource: data.source,
      },
      "meeting.transcription_started",
      { transcriptionSource: data.source }
    );
    if (!armed.ok) {
      // The provider has accepted work. Its API has no cancellation endpoint,
      // so preserve the provider id on a terminal local job and release the
      // active slot; never leave an untracked external id or queued job.
      const reconciliation = await reconcileFailedJob(
        backgroundJobId,
        "Meeting source state changed before provider arming",
        data.transcriptionJobId,
      );
      if (reconciliation) return reconciliation;
      return transcriptConflictResponse(armed.reason);
    }

    {
      try {
        await startJob(backgroundJobId, data.transcriptionJobId);
      } catch {
        const trackingFailed = await commitState(
          { status: "FAILED" },
          "meeting.transcription_failed",
          { failureClass: "job-start-tracking", providerJobIdRecorded: true },
          "TRANSCRIBING",
        );
        const reconciliation = await reconcileFailedJob(
          backgroundJobId,
          "Unable to link transcription tracking job",
          data.transcriptionJobId,
        );
        if (reconciliation) return reconciliation;
        if (!trackingFailed.ok) return transcriptConflictResponse(trackingFailed.reason);
        return Response.json(
          {
            error: "Unable to link transcription tracking job",
            providerJobId: data.transcriptionJobId,
          },
          { status: 503 },
        );
      }
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
      { failureClass: err instanceof Error ? err.name : "unknown" }
    );
    if (!failed.ok) return transcriptConflictResponse(failed.reason);
    const reconciliation = await reconcileFailedJob(
      backgroundJobId,
      "Sidecar request failed",
    );
    if (reconciliation) return reconciliation;
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
