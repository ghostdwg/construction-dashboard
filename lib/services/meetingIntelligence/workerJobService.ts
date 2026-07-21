import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import { getBlobStore } from "@/lib/storage/blobStore";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";
import { actorLabel, type Actor } from "@/lib/services/meetingRegister/types";
import { extractMeetingStructure, type WorkerTranscriptSegment } from "./heuristicExtractor";
import {
  computeMeetingIntelligenceResultChecksum,
  type WorkerToolVersions,
} from "./workerContract";
import {
  LOCAL_ONLY_CONFIDENTIALITY,
  LOCAL_WORKER_PROCESSOR_KIND,
  MEETING_INTELLIGENCE_PROGRESS_STAGES,
  normalizeSpeakerLabel,
  type MeetingIntelligenceProgressStage,
  type MeetingIntelligenceResult,
} from "./types";

export const MEETING_WORKER_LEASE_SECONDS = 900;
export const MEETING_WORKER_MAX_ATTEMPTS = 3;
const MAX_TRANSCRIPT_CHARS = 1_000_000;
const MAX_SEGMENTS = 20_000;
const MAX_ERROR_MESSAGE = 500;
const MAX_RAW_ARTIFACT_CHARS = 2_000_000;

export type CompleteWorkerJobInput = {
  leaseToken: string;
  transcriptText: string;
  segments: WorkerTranscriptSegment[];
  sourceMediaChecksum: string;
  resultChecksum: string;
  toolVersions: WorkerToolVersions;
  rawArtifactJson?: string | null;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function meetingWorkerLeaseTokenHash(token: string): string {
  return sha256(token);
}

function boundedLabel(value: string | null | undefined, max = 120): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function activeLeaseExpiry(now: Date): Date {
  return new Date(now.getTime() + MEETING_WORKER_LEASE_SECONDS * 1_000);
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

export async function getSourceMediaSnapshot(sourceMediaReference: string) {
  const stat = await getBlobStore().stat(sourceMediaReference);
  return stat
    ? { reference: sourceMediaReference, checksum: stat.sha256, size: stat.size }
    : null;
}

export function queuedWorkerJobData(input: {
  artifactId: number;
  meetingId: number;
  bidId: number;
  sourceMediaReference: string;
  sourceMediaChecksum: string;
  attempt?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
}) {
  return {
    artifactId: input.artifactId,
    meetingId: input.meetingId,
    bidId: input.bidId,
    idempotencyKey:
      input.idempotencyKey ??
      `meeting-intelligence-worker:${input.artifactId}:${randomUUID()}`,
    attempt: input.attempt ?? 1,
    maxAttempts: input.maxAttempts ?? MEETING_WORKER_MAX_ATTEMPTS,
    status: "QUEUED",
    activeSlot: 1,
    sourceMediaReference: input.sourceMediaReference,
    sourceMediaChecksum: input.sourceMediaChecksum,
    toolVersionsJson: "{}",
  };
}

function normalizeSegments(segments: WorkerTranscriptSegment[]): WorkerTranscriptSegment[] {
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) {
    throw new Error(`segments must contain between 1 and ${MAX_SEGMENTS} entries`);
  }
  return segments.map((segment, index) => {
    const text = typeof segment?.text === "string" ? segment.text.trim() : "";
    if (!text || text.length > 20_000) throw new Error(`Invalid segment text at index ${index}`);
    const startSec = segment.startSec == null ? null : Number(segment.startSec);
    const endSec = segment.endSec == null ? null : Number(segment.endSec);
    const confidence = segment.confidence == null ? null : Number(segment.confidence);
    if (startSec != null && (!Number.isFinite(startSec) || startSec < 0)) {
      throw new Error(`Invalid segment startSec at index ${index}`);
    }
    if (endSec != null && (!Number.isFinite(endSec) || endSec < 0 || (startSec != null && endSec < startSec))) {
      throw new Error(`Invalid segment endSec at index ${index}`);
    }
    if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new Error(`Invalid segment confidence at index ${index}`);
    }
    return {
      segmentIndex: index,
      startSec,
      endSec,
      text,
      speakerLabel: normalizeSpeakerLabel(segment.speakerLabel),
      confidence,
    };
  });
}

function normalizeToolVersions(input: WorkerToolVersions): WorkerToolVersions {
  const transcriptionTool = boundedLabel(input?.transcriptionTool);
  const transcriptionModel = boundedLabel(input?.transcriptionModel);
  const transcriptionVersion = boundedLabel(input?.transcriptionVersion);
  if (!transcriptionTool || !transcriptionModel || !transcriptionVersion) {
    throw new Error("transcription tool, model, and version are required");
  }
  return {
    transcriptionTool,
    transcriptionModel,
    transcriptionVersion,
    diarizationTool: boundedLabel(input.diarizationTool),
    diarizationModel: boundedLabel(input.diarizationModel),
    diarizationVersion: boundedLabel(input.diarizationVersion),
  };
}

async function leaseFailure(jobId: number, leaseTokenHash: string) {
  const job = await prisma.meetingIntelligenceWorkerJob.findUnique({
    where: { id: jobId },
    select: { status: true, cancellationRequestedAt: true, leaseTokenHash: true },
  });
  if (
    job?.leaseTokenHash === leaseTokenHash &&
    (job.status === "CANCELED" || job.cancellationRequestedAt)
  ) {
    return "canceled" as const;
  }
  return "lease_lost" as const;
}

export async function claimNextMeetingIntelligenceJob(workerIdInput: string) {
  const workerId = boundedLabel(workerIdInput, 160);
  if (!workerId) return { ok: false as const, error: "workerId is required" };
  await recoverStaleMeetingIntelligenceJobs();

  for (let scan = 0; scan < 25; scan += 1) {
    const candidate = await prisma.meetingIntelligenceWorkerJob.findFirst({
      where: { status: "QUEUED", activeSlot: 1, cancellationRequestedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, artifactId: true, meetingId: true, bidId: true },
    });
    if (!candidate) return { ok: true as const, value: { jobId: null } };

    const leaseToken = randomBytes(32).toString("base64url");
    const leaseTokenHash = meetingWorkerLeaseTokenHash(leaseToken);
    const now = new Date();
    const leaseExpiresAt = activeLeaseExpiry(now);
    const won = await prisma.$transaction(async (tx) => {
      const artifact = await tx.meetingIntelligenceArtifact.updateMany({
        where: {
          id: candidate.artifactId,
          meetingId: candidate.meetingId,
          bidId: candidate.bidId,
          state: { in: ["QUEUED", "PROCESSING"] },
          activeSlot: 1,
        },
        data: {
          state: "PROCESSING",
          startedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (artifact.count !== 1) return false;
      const claimed = await tx.meetingIntelligenceWorkerJob.updateMany({
        where: {
          id: candidate.id,
          artifactId: candidate.artifactId,
          status: "QUEUED",
          activeSlot: 1,
          cancellationRequestedAt: null,
        },
        data: {
          status: "CLAIMED",
          workerId,
          leaseTokenHash,
          leasedAt: now,
          leaseExpiresAt,
          lastHeartbeatAt: now,
          startedAt: now,
          progressStage: "media_fetch",
          progressPercent: 0,
        },
      });
      if (claimed.count !== 1) throw new Error("Worker job claim lost");
      return true;
    }).catch((error) => {
      if (error instanceof Error && error.message === "Worker job claim lost") return false;
      throw error;
    });
    if (!won) continue;
    return {
      ok: true as const,
      value: {
        jobId: candidate.id,
        artifactId: candidate.artifactId,
        meetingId: candidate.meetingId,
        bidId: candidate.bidId,
        mediaDownloadUrl: `/api/worker/meeting-intelligence/${candidate.id}/media`,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      },
    };
  }
  return { ok: true as const, value: { jobId: null } };
}

export async function heartbeatMeetingIntelligenceJob(jobId: number, leaseToken: string) {
  const now = new Date();
  const leaseExpiresAt = activeLeaseExpiry(now);
  const leaseTokenHash = meetingWorkerLeaseTokenHash(leaseToken);
  const updated = await prisma.meetingIntelligenceWorkerJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["CLAIMED", "RUNNING"] },
      leaseTokenHash,
      leaseExpiresAt: { gt: now },
      cancellationRequestedAt: null,
    },
    data: { lastHeartbeatAt: now, leaseExpiresAt },
  });
  if (updated.count !== 1) {
    return { ok: false as const, reason: await leaseFailure(jobId, leaseTokenHash) };
  }
  return { ok: true as const, leaseExpiresAt: leaseExpiresAt.toISOString() };
}

export async function reportMeetingIntelligenceProgress(
  jobId: number,
  leaseToken: string,
  stage: MeetingIntelligenceProgressStage,
  percent: number,
) {
  if (!(MEETING_INTELLIGENCE_PROGRESS_STAGES as readonly string[]).includes(stage)) {
    return { ok: false as const, reason: "invalid_stage" as const };
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return { ok: false as const, reason: "invalid_percent" as const };
  }
  const now = new Date();
  const leaseTokenHash = meetingWorkerLeaseTokenHash(leaseToken);
  const updated = await prisma.meetingIntelligenceWorkerJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["CLAIMED", "RUNNING"] },
      leaseTokenHash,
      leaseExpiresAt: { gt: now },
      cancellationRequestedAt: null,
    },
    data: { status: "RUNNING", progressStage: stage, progressPercent: percent },
  });
  if (updated.count !== 1) {
    return { ok: false as const, reason: await leaseFailure(jobId, leaseTokenHash) };
  }
  return { ok: true as const };
}

export async function getMeetingIntelligenceJobMedia(jobId: number, leaseToken: string) {
  const now = new Date();
  const leaseTokenHash = meetingWorkerLeaseTokenHash(leaseToken);
  const job = await prisma.meetingIntelligenceWorkerJob.findFirst({
    where: {
      id: jobId,
      status: { in: ["CLAIMED", "RUNNING"] },
      leaseTokenHash,
      leaseExpiresAt: { gt: now },
      cancellationRequestedAt: null,
    },
    select: {
      sourceMediaReference: true,
      sourceMediaChecksum: true,
      meetingId: true,
      bidId: true,
    },
  });
  if (!job) return { ok: false as const, reason: await leaseFailure(jobId, leaseTokenHash) };
  const meeting = await prisma.meeting.findFirst({
    where: { id: job.meetingId, bidId: job.bidId },
    select: { audioStorageKey: true },
  });
  if (!meeting || meeting.audioStorageKey !== job.sourceMediaReference) {
    return { ok: false as const, reason: "stale_source_media" as const };
  }
  const store = getBlobStore();
  const stat = await store.stat(job.sourceMediaReference);
  if (!stat || stat.sha256 !== job.sourceMediaChecksum) {
    return { ok: false as const, reason: "stale_source_media" as const };
  }
  return {
    ok: true as const,
    value: {
      data: await store.get(job.sourceMediaReference),
      checksum: stat.sha256,
      contentType: stat.contentType ?? "application/octet-stream",
    },
  };
}

export async function completeMeetingIntelligenceJob(
  jobId: number,
  input: CompleteWorkerJobInput,
): Promise<MeetingIntelligenceResult<{
  artifactId: number;
  segmentCount: number;
  candidateCount: number;
  alreadySubmitted: boolean;
}>> {
  const transcriptText = input.transcriptText?.trim();
  if (!transcriptText || transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, error: `transcriptText must contain at most ${MAX_TRANSCRIPT_CHARS} characters` };
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sourceMediaChecksum ?? "")) {
    return { ok: false, error: "Invalid sourceMediaChecksum" };
  }
  if (!/^[a-f0-9]{64}$/i.test(input.resultChecksum ?? "")) {
    return { ok: false, error: "Invalid resultChecksum" };
  }

  let segments: WorkerTranscriptSegment[];
  let toolVersions: WorkerToolVersions;
  try {
    segments = normalizeSegments(input.segments);
    toolVersions = normalizeToolVersions(input.toolVersions);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid completion payload" };
  }
  const rawArtifactJson = input.rawArtifactJson ?? null;
  if (rawArtifactJson && rawArtifactJson.length > MAX_RAW_ARTIFACT_CHARS) {
    return { ok: false, error: `rawArtifactJson exceeds ${MAX_RAW_ARTIFACT_CHARS} characters` };
  }
  const computedChecksum = computeMeetingIntelligenceResultChecksum({
    transcriptText,
    segments,
    toolVersions,
    rawArtifactJson,
  });
  if (computedChecksum !== input.resultChecksum.toLowerCase()) {
    return { ok: false, error: "Result checksum mismatch" };
  }

  const tokenHash = meetingWorkerLeaseTokenHash(input.leaseToken);
  const existing = await prisma.meetingIntelligenceWorkerJob.findUnique({ where: { id: jobId } });
  if (!existing || existing.leaseTokenHash !== tokenHash) {
    return { ok: false, error: "Lease lost" };
  }
  if (existing.status === "SUCCEEDED") {
    if (
      existing.resultChecksum === computedChecksum &&
      existing.sourceMediaChecksum === input.sourceMediaChecksum.toLowerCase()
    ) {
      return {
        ok: true,
        value: {
          artifactId: existing.artifactId,
          segmentCount: await prisma.meetingIntelligenceSegment.count({ where: { artifactId: existing.artifactId } }),
          candidateCount: await prisma.meetingIntelligenceCandidate.count({ where: { artifactId: existing.artifactId } }),
          alreadySubmitted: true,
        },
      };
    }
    return { ok: false, error: "Conflicting duplicate completion" };
  }
  const now = new Date();
  if (
    !["CLAIMED", "RUNNING"].includes(existing.status) ||
    existing.leaseTokenHash !== tokenHash ||
    !existing.leaseExpiresAt ||
    existing.leaseExpiresAt <= now ||
    existing.cancellationRequestedAt
  ) {
    return { ok: false, error: "Lease lost" };
  }
  if (existing.sourceMediaChecksum !== input.sourceMediaChecksum.toLowerCase()) {
    return { ok: false, error: "Source media checksum mismatch" };
  }
  const meeting = await prisma.meeting.findFirst({
    where: { id: existing.meetingId, bidId: existing.bidId },
    select: { audioStorageKey: true },
  });
  const source = meeting?.audioStorageKey
    ? await getSourceMediaSnapshot(meeting.audioStorageKey)
    : null;
  if (
    !meeting ||
    meeting.audioStorageKey !== existing.sourceMediaReference ||
    !source ||
    source.checksum !== existing.sourceMediaChecksum
  ) {
    return { ok: false, error: "Source media changed after this job was queued" };
  }

  const extraction = extractMeetingStructure(segments);
  const toolVersionsJson = JSON.stringify({ ...toolVersions, confidentiality: LOCAL_ONLY_CONFIDENTIALITY });
  const rawArtifactStorageKey = rawArtifactJson
    ? `plan-room/jobs/${existing.bidId}/meetings/${existing.meetingId}/intelligence/${existing.artifactId}/worker-jobs/${jobId}/raw-result.json`
    : null;
  if (rawArtifactStorageKey && rawArtifactJson) {
    await getBlobStore().put(rawArtifactStorageKey, Buffer.from(rawArtifactJson, "utf8"), {
      contentType: "application/json",
    });
  }

  let envelope: AuditEnvelope | null = null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.meetingIntelligenceWorkerJob.updateMany({
        where: {
          id: jobId,
          status: { in: ["CLAIMED", "RUNNING"] },
          leaseTokenHash: tokenHash,
          leaseExpiresAt: { gt: now },
          cancellationRequestedAt: null,
        },
        data: {
          status: "SUCCEEDED",
          activeSlot: null,
          progressStage: "persist",
          progressPercent: 100,
          resultChecksum: computedChecksum,
          transcriptionTool: toolVersions.transcriptionTool,
          transcriptionModel: toolVersions.transcriptionModel,
          transcriptionVersion: toolVersions.transcriptionVersion,
          diarizationTool: toolVersions.diarizationTool,
          diarizationModel: toolVersions.diarizationModel,
          diarizationVersion: toolVersions.diarizationVersion,
          toolVersionsJson,
          rawArtifactStorageKey,
          completedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (claim.count !== 1) throw new Error("Lease lost");

      const segmentIds = new Map<number, number>();
      for (const segment of segments) {
        const created = await tx.meetingIntelligenceSegment.create({
          data: {
            artifactId: existing.artifactId,
            meetingId: existing.meetingId,
            bidId: existing.bidId,
            segmentIndex: segment.segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            originalSpeakerLabel: segment.speakerLabel,
            currentSpeakerLabel: segment.speakerLabel,
            originalText: segment.text,
            currentText: segment.text,
            confidence: segment.confidence,
          },
          select: { id: true },
        });
        segmentIds.set(segment.segmentIndex, created.id);
      }
      for (const candidate of extraction.candidates) {
        await tx.meetingIntelligenceCandidate.create({
          data: {
            artifactId: existing.artifactId,
            meetingId: existing.meetingId,
            bidId: existing.bidId,
            segmentId: segmentIds.get(candidate.segmentIndex) ?? null,
            candidateType: candidate.candidateType,
            rawText: candidate.rawText,
            draftText: candidate.draftText,
            evidenceExcerpt: candidate.evidenceExcerpt,
            speakerLabel: candidate.speakerLabel,
            startSec: candidate.startSec,
            endSec: candidate.endSec,
            confidence: candidate.confidence,
            dueDate: candidate.dueDate,
            sourceMetadataJson: extraction.sourceMetadataJson,
            reviewState: "DRAFT",
          },
        });
      }
      const artifact = await tx.meetingIntelligenceArtifact.updateMany({
        where: {
          id: existing.artifactId,
          meetingId: existing.meetingId,
          bidId: existing.bidId,
          state: "PROCESSING",
          activeSlot: 1,
        },
        data: {
          state: "READY_FOR_REVIEW",
          sourceKind: LOCAL_WORKER_PROCESSOR_KIND,
          sourceMetadataJson: JSON.stringify({
            processor: LOCAL_WORKER_PROCESSOR_KIND,
            extractor: JSON.parse(extraction.sourceMetadataJson),
            toolVersions,
            jobId,
            resultChecksum: computedChecksum,
            confidentiality: LOCAL_ONLY_CONFIDENTIALITY,
            realAi: false,
          }),
          transcriptText,
          transcriptConfidence:
            segments.reduce((sum, segment) => sum + (segment.confidence ?? 0), 0) /
            segments.length,
          completedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (artifact.count !== 1) throw new Error("Artifact state changed during completion");
      envelope = await writeRegisterAuditTx(tx, {
        action: "meeting_intelligence_worker_completed",
        decision: "ready_for_review",
        subjectKind: "MeetingIntelligenceWorkerJob",
        subjectId: jobId,
        actor: { id: existing.workerId, name: existing.workerId },
        actorKind: "runner",
        payload: {
          bidId: existing.bidId,
          meetingId: existing.meetingId,
          artifactId: existing.artifactId,
          segmentCount: segments.length,
          candidateCount: extraction.candidates.length,
        },
      });
      return {
        artifactId: existing.artifactId,
        segmentCount: segments.length,
        candidateCount: extraction.candidates.length,
        alreadySubmitted: false,
      };
    });
    emitRegisterAuditPostCommit(envelope);
    return { ok: true, value: result };
  } catch (error) {
    if (rawArtifactStorageKey) await getBlobStore().delete(rawArtifactStorageKey);
    if (isUniqueConstraint(error)) {
      const duplicate = await prisma.meetingIntelligenceWorkerJob.findFirst({
        where: { resultChecksum: computedChecksum },
        select: { id: true },
      });
      if (duplicate?.id !== jobId) return { ok: false, error: "Conflicting result checksum" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Completion failed" };
  }
}

async function terminalFailure(
  jobId: number,
  leaseToken: string,
  errorCodeInput: string,
  errorMessageInput: string,
  terminalStatus: "FAILED" | "STALE",
) {
  const tokenHash = meetingWorkerLeaseTokenHash(leaseToken);
  const now = new Date();
  const job = await prisma.meetingIntelligenceWorkerJob.findUnique({ where: { id: jobId } });
  if (
    !job ||
    !["CLAIMED", "RUNNING"].includes(job.status) ||
    job.leaseTokenHash !== tokenHash ||
    !job.leaseExpiresAt ||
    job.leaseExpiresAt <= now ||
    job.cancellationRequestedAt
  ) {
    return { ok: false as const, reason: await leaseFailure(jobId, tokenHash) };
  }
  const errorCode = (boundedLabel(errorCodeInput, 80) ?? "WORKER_FAILURE").toUpperCase();
  const errorMessage = boundedLabel(errorMessageInput, MAX_ERROR_MESSAGE) ?? "Private worker reported failure";
  let envelope: AuditEnvelope | null = null;
  const value = await prisma.$transaction(async (tx) => {
    const failed = await tx.meetingIntelligenceWorkerJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["CLAIMED", "RUNNING"] },
        leaseTokenHash: tokenHash,
        leaseExpiresAt: { gt: now },
        cancellationRequestedAt: null,
      },
      data: {
        status: terminalStatus,
        activeSlot: null,
        errorCode,
        errorMessage,
        failedAt: now,
      },
    });
    if (failed.count !== 1) throw new Error("Lease lost");
    const willRetry = job.attempt < job.maxAttempts;
    if (willRetry) {
      await tx.meetingIntelligenceWorkerJob.create({
        data: queuedWorkerJobData({
          artifactId: job.artifactId,
          meetingId: job.meetingId,
          bidId: job.bidId,
          sourceMediaReference: job.sourceMediaReference,
          sourceMediaChecksum: job.sourceMediaChecksum,
          attempt: job.attempt + 1,
          maxAttempts: job.maxAttempts,
        }),
      });
    } else {
      await tx.meetingIntelligenceArtifact.updateMany({
        where: { id: job.artifactId, meetingId: job.meetingId, bidId: job.bidId, state: "PROCESSING" },
        data: {
          state: "FAILED",
          activeSlot: null,
          errorCode,
          errorMessage,
          completedAt: now,
        },
      });
    }
    envelope = await writeRegisterAuditTx(tx, {
      action: terminalStatus === "STALE" ? "meeting_intelligence_worker_stale" : "meeting_intelligence_worker_failed",
      decision: willRetry ? "bounded_retry_queued" : "attempts_exhausted",
      subjectKind: "MeetingIntelligenceWorkerJob",
      subjectId: jobId,
      actor: { id: job.workerId, name: job.workerId },
      actorKind: "runner",
      payload: { bidId: job.bidId, meetingId: job.meetingId, artifactId: job.artifactId, attempt: job.attempt, willRetry },
    });
    return { willRetry, nextAttempt: willRetry ? job.attempt + 1 : null };
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true as const, ...value };
}

export async function failMeetingIntelligenceJob(
  jobId: number,
  leaseToken: string,
  errorCode: string,
  errorMessage: string,
) {
  return terminalFailure(jobId, leaseToken, errorCode, errorMessage, "FAILED");
}

export async function recoverStaleMeetingIntelligenceJobs(): Promise<{ recovered: number; failed: number }> {
  const now = new Date();
  const stale = await prisma.meetingIntelligenceWorkerJob.findMany({
    where: {
      status: { in: ["CLAIMED", "RUNNING"] },
      leaseExpiresAt: { lte: now },
      cancellationRequestedAt: null,
    },
    orderBy: { leaseExpiresAt: "asc" },
    take: 100,
  });
  let recovered = 0;
  let failedCount = 0;
  for (const job of stale) {
    const value = await prisma.$transaction(async (tx) => {
      const marked = await tx.meetingIntelligenceWorkerJob.updateMany({
        where: {
          id: job.id,
          status: { in: ["CLAIMED", "RUNNING"] },
          leaseExpiresAt: { lte: now },
          cancellationRequestedAt: null,
        },
        data: {
          status: "STALE",
          activeSlot: null,
          errorCode: "LEASE_EXPIRED",
          errorMessage: "Worker lease expired before completion",
          failedAt: now,
        },
      });
      if (marked.count !== 1) return null;
      if (job.attempt < job.maxAttempts) {
        await tx.meetingIntelligenceWorkerJob.create({
          data: queuedWorkerJobData({
            artifactId: job.artifactId,
            meetingId: job.meetingId,
            bidId: job.bidId,
            sourceMediaReference: job.sourceMediaReference,
            sourceMediaChecksum: job.sourceMediaChecksum,
            attempt: job.attempt + 1,
            maxAttempts: job.maxAttempts,
          }),
        });
        return "recovered" as const;
      }
      await tx.meetingIntelligenceArtifact.updateMany({
        where: { id: job.artifactId, meetingId: job.meetingId, bidId: job.bidId, state: "PROCESSING" },
        data: {
          state: "FAILED",
          activeSlot: null,
          errorCode: "LEASE_EXPIRED",
          errorMessage: "Private worker did not complete after the bounded retry limit",
          completedAt: now,
        },
      });
      return "failed" as const;
    });
    if (value === "recovered") recovered += 1;
    if (value === "failed") failedCount += 1;
  }
  return { recovered, failed: failedCount };
}

export async function retryMeetingIntelligence(
  bidId: number,
  meetingId: number,
  artifactId: number,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ artifactId: number; jobId: number; attempt: number }>> {
  if (!actorLabel(actor)) return { ok: false, error: "A session actor is required" };
  const artifact = await prisma.meetingIntelligenceArtifact.findFirst({
    where: { id: artifactId, meetingId, bidId, state: "FAILED", activeSlot: null },
  });
  if (!artifact) return { ok: false, error: "Only a failed artifact can be retried" };
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { audioStorageKey: true },
  });
  if (!meeting?.audioStorageKey) return { ok: false, error: "Durable meeting media is unavailable" };
  const source = await getSourceMediaSnapshot(meeting.audioStorageKey);
  if (!source) return { ok: false, error: "Durable meeting media is unavailable" };
  let envelope: AuditEnvelope | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const reset = await tx.meetingIntelligenceArtifact.updateMany({
      where: { id: artifactId, meetingId, bidId, state: "FAILED", activeSlot: null },
      data: {
        state: "QUEUED",
        activeSlot: 1,
        mediaReference: source.reference,
        queuedAt: new Date(),
        startedAt: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (reset.count !== 1) throw new Error("Artifact changed concurrently");
    const job = await tx.meetingIntelligenceWorkerJob.create({
      data: queuedWorkerJobData({
        artifactId,
        meetingId,
        bidId,
        sourceMediaReference: source.reference,
        sourceMediaChecksum: source.checksum,
        attempt: 1,
        maxAttempts: MEETING_WORKER_MAX_ATTEMPTS,
        idempotencyKey: `meeting-intelligence-worker:${artifactId}:manual-retry:${randomUUID()}`,
      }),
      select: { id: true, attempt: true },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "meeting_intelligence_worker_retried",
      decision: "manual_retry_queued",
      subjectKind: "MeetingIntelligenceWorkerJob",
      subjectId: job.id,
      actor,
      payload: { bidId, meetingId, artifactId },
    });
    return { artifactId, jobId: job.id, attempt: job.attempt };
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: result };
}
