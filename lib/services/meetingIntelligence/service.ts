import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";
import {
  actorLabel,
  type Actor,
} from "@/lib/services/meetingRegister/types";
import { processDeterministicMeetingFixture } from "./deterministicProcessor";
import {
  LOCAL_ONLY_CONFIDENTIALITY,
  LOCAL_PROCESSOR_KIND,
  LOCAL_PROCESSOR_VERSION,
  UNKNOWN_SPEAKER,
  isCorrectableSpeakerLabel,
  normalizeSpeakerLabel,
  type MeetingIntelligenceResult,
} from "./types";

const ACTIVE_STATES = ["QUEUED", "PROCESSING", "READY_FOR_REVIEW"];
const EDITABLE_REVIEW_STATES = ["DRAFT", "ACCEPTED", "REJECTED", "EDITED"];

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

function sourceMetadataJson(): string {
  return JSON.stringify({
    processor: LOCAL_PROCESSOR_KIND,
    processorVersion: LOCAL_PROCESSOR_VERSION,
    confidentiality: LOCAL_ONLY_CONFIDENTIALITY,
    realAi: false,
  });
}

export function meetingIntelligenceServiceStatus(error: string): number {
  if (error === "Not found") return 404;
  if (
    error.includes("unavailable") ||
    error.includes("already") ||
    error.includes("must be") ||
    error.includes("not queued")
  ) {
    return 409;
  }
  return 400;
}

export async function getMeetingIntelligence(bidId: number, meetingId: number) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true, audioStorageKey: true, audioFileName: true },
  });
  if (!meeting) return null;

  const artifact = await prisma.meetingIntelligenceArtifact.findFirst({
    where: { meetingId, bidId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      segments: { orderBy: { segmentIndex: "asc" } },
      candidates: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          publishedActionItem: { select: { id: true, description: true, status: true } },
        },
      },
    },
  });
  const sourceMediaAvailable = Boolean(
    meeting.audioStorageKey || meeting.audioFileName,
  );
  return {
    state: artifact?.state ?? "NOT_STARTED",
    sourceMediaAvailable,
    canQueue: sourceMediaAvailable && !artifact?.activeSlot,
    transcriptStatus: artifact?.transcriptText
      ? "READY"
      : artifact?.state === "FAILED"
        ? "FAILED"
        : "NOT_PROCESSED",
    confidentiality: LOCAL_ONLY_CONFIDENTIALITY,
    processorKind: LOCAL_PROCESSOR_KIND,
    artifact,
  };
}

export async function queueMeetingIntelligence(
  bidId: number,
  meetingId: number,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ artifactId: number; state: string; created: boolean }>> {
  const queuedBy = actorLabel(actor);
  if (!queuedBy) return { ok: false, error: "A session actor is required" };

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true, audioStorageKey: true, audioFileName: true },
  });
  if (!meeting) return { ok: false, error: "Not found" };
  const mediaReference = meeting.audioStorageKey ??
    (meeting.audioFileName ? `legacy-meeting-media:${meetingId}/${meeting.audioFileName}` : null);
  if (!mediaReference) {
    return { ok: false, error: "Meeting media is unavailable; upload media before queueing" };
  }

  const existing = await prisma.meetingIntelligenceArtifact.findFirst({
    where: { meetingId, bidId, state: { in: ACTIVE_STATES } },
    orderBy: { createdAt: "desc" },
    select: { id: true, state: true },
  });
  if (existing) {
    return {
      ok: true,
      value: { artifactId: existing.id, state: existing.state, created: false },
    };
  }

  try {
    let envelope: AuditEnvelope | null = null;
    const artifact = await prisma.$transaction(async (tx) => {
      const created = await tx.meetingIntelligenceArtifact.create({
        data: {
          meetingId,
          bidId,
          state: "QUEUED",
          mediaReference,
          sourceReference: `local-mi-${randomUUID()}`,
          sourceKind: LOCAL_PROCESSOR_KIND,
          sourceMetadataJson: sourceMetadataJson(),
          queuedBy,
        },
        select: { id: true, state: true },
      });
      envelope = await writeRegisterAuditTx(tx, {
        action: "meeting_intelligence_queued",
        decision: "queued_local_only",
        subjectKind: "MeetingIntelligenceArtifact",
        subjectId: created.id,
        actor,
        payload: { bidId, meetingId, processor: LOCAL_PROCESSOR_KIND },
      });
      return created;
    });
    emitRegisterAuditPostCommit(envelope);
    return {
      ok: true,
      value: { artifactId: artifact.id, state: artifact.state, created: true },
    };
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const winner = await prisma.meetingIntelligenceArtifact.findFirst({
        where: { meetingId, bidId, activeSlot: 1 },
        select: { id: true, state: true },
      });
      if (winner) {
        return {
          ok: true,
          value: { artifactId: winner.id, state: winner.state, created: false },
        };
      }
    }
    throw error;
  }
}

export async function processQueuedMeetingIntelligence(
  bidId: number,
  meetingId: number,
  artifactId: number,
  fixtureText: string,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ artifactId: number; segmentCount: number; candidateCount: number }>> {
  const processor = actorLabel(actor);
  if (!processor) return { ok: false, error: "A session actor is required" };
  const text = fixtureText?.trim();
  if (!text) return { ok: false, error: "Fixture transcript text is required" };
  if (text.length > 200_000) return { ok: false, error: "Fixture transcript exceeds 200000 characters" };

  const claimed = await prisma.meetingIntelligenceArtifact.updateMany({
    where: { id: artifactId, meetingId, bidId, state: "QUEUED", activeSlot: 1 },
    data: {
      state: "PROCESSING",
      startedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  if (claimed.count !== 1) {
    const artifact = await prisma.meetingIntelligenceArtifact.findFirst({
      where: { id: artifactId, meetingId, bidId },
      select: { id: true, state: true },
    });
    return {
      ok: false,
      error: artifact ? `Artifact is not queued (state ${artifact.state})` : "Not found",
    };
  }

  try {
    const output = processDeterministicMeetingFixture(text);
    let envelope: AuditEnvelope | null = null;
    await prisma.$transaction(async (tx) => {
      const segmentIds = new Map<number, number>();
      for (const segment of output.segments) {
        const created = await tx.meetingIntelligenceSegment.create({
          data: {
            artifactId,
            meetingId,
            bidId,
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
      for (const candidate of output.candidates) {
        await tx.meetingIntelligenceCandidate.create({
          data: {
            artifactId,
            meetingId,
            bidId,
            segmentId: segmentIds.get(candidate.segmentIndex) ?? null,
            candidateType: candidate.candidateType,
            rawText: candidate.rawText,
            draftText: candidate.draftText,
            evidenceExcerpt: candidate.evidenceExcerpt,
            speakerLabel: candidate.speakerLabel,
            startSec: candidate.startSec,
            endSec: candidate.endSec,
            confidence: candidate.confidence,
            sourceMetadataJson: output.sourceMetadataJson,
            dueDate: candidate.dueDate,
            reviewState: "DRAFT",
          },
        });
      }
      await tx.meetingIntelligenceArtifact.update({
        where: { id: artifactId },
        data: {
          state: "READY_FOR_REVIEW",
          transcriptText: output.transcriptText,
          transcriptConfidence: output.transcriptConfidence,
          sourceMetadataJson: output.sourceMetadataJson,
          completedAt: new Date(),
        },
      });
      envelope = await writeRegisterAuditTx(tx, {
        action: "meeting_intelligence_processed",
        decision: "ready_for_review",
        subjectKind: "MeetingIntelligenceArtifact",
        subjectId: artifactId,
        actor,
        payload: {
          bidId,
          meetingId,
          processor: LOCAL_PROCESSOR_KIND,
          segmentCount: output.segments.length,
          candidateCount: output.candidates.length,
        },
      });
    });
    emitRegisterAuditPostCommit(envelope);
    return {
      ok: true,
      value: {
        artifactId,
        segmentCount: output.segments.length,
        candidateCount: output.candidates.length,
      },
    };
  } catch (error) {
    await prisma.meetingIntelligenceArtifact.updateMany({
      where: { id: artifactId, meetingId, bidId, state: "PROCESSING" },
      data: {
        state: "FAILED",
        errorCode: "DETERMINISTIC_PROCESSOR_FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Local processor failed",
        completedAt: new Date(),
        activeSlot: null,
      },
    });
    return { ok: false, error: "Deterministic local processing failed" };
  }
}

export type CandidateReviewInput =
  | { action: "ACCEPT" | "REJECT" }
  | { action: "EDIT"; editedText?: string };

export async function reviewMeetingIntelligenceCandidate(
  bidId: number,
  meetingId: number,
  candidateId: number,
  input: CandidateReviewInput,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ candidateId: number; reviewState: string }>> {
  const reviewedBy = actorLabel(actor);
  if (!reviewedBy) return { ok: false, error: "A session actor is required" };
  if (!input || !["ACCEPT", "REJECT", "EDIT"].includes(input.action)) {
    return { ok: false, error: "Invalid review action" };
  }
  const candidate = await prisma.meetingIntelligenceCandidate.findFirst({
    where: { id: candidateId, meetingId, bidId },
  });
  if (!candidate) return { ok: false, error: "Not found" };
  if (!EDITABLE_REVIEW_STATES.includes(candidate.reviewState)) {
    return { ok: false, error: "Published candidates cannot be changed" };
  }

  const reviewState =
    input.action === "ACCEPT" ? "ACCEPTED" : input.action === "REJECT" ? "REJECTED" : "EDITED";
  const editedText = input.action === "EDIT" ? input.editedText?.trim().slice(0, 4_000) : null;
  if (input.action === "EDIT" && !editedText) {
    return { ok: false, error: "editedText is required" };
  }

  let envelope: AuditEnvelope | null = null;
  const updated = await prisma.$transaction(async (tx) => {
    const claim = await tx.meetingIntelligenceCandidate.updateMany({
      where: {
        id: candidateId,
        meetingId,
        bidId,
        reviewState: candidate.reviewState,
      },
      data: {
        reviewState,
        ...(editedText ? { draftText: editedText } : {}),
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
    if (claim.count !== 1) throw new Error("Candidate changed concurrently");
    envelope = await writeRegisterAuditTx(tx, {
      action: "meeting_intelligence_candidate_reviewed",
      decision: reviewState.toLowerCase(),
      subjectKind: "MeetingIntelligenceCandidate",
      subjectId: candidateId,
      actor,
      payload: {
        bidId,
        meetingId,
        artifactId: candidate.artifactId,
        candidateType: candidate.candidateType,
        from: candidate.reviewState,
        to: reviewState,
      },
    });
    return { candidateId, reviewState };
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: updated };
}

export async function publishMeetingIntelligenceCandidate(
  bidId: number,
  meetingId: number,
  candidateId: number,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ candidateId: number; actionItemId: number; alreadyPublished: boolean }>> {
  const publishedBy = actorLabel(actor);
  if (!publishedBy) return { ok: false, error: "A session actor is required" };
  const candidate = await prisma.meetingIntelligenceCandidate.findFirst({
    where: { id: candidateId, meetingId, bidId },
    include: { publishedActionItem: { select: { id: true } } },
  });
  if (!candidate) return { ok: false, error: "Not found" };
  if (candidate.reviewState === "PUBLISHED") {
    const actionItem = candidate.publishedActionItem ??
      await prisma.meetingActionItem.findFirst({
        where: { sourceMeetingIntelligenceCandidateId: candidate.id, bidId },
        select: { id: true },
      });
    if (actionItem) {
      return {
        ok: true,
        value: {
          candidateId,
          actionItemId: actionItem.id,
          alreadyPublished: true,
        },
      };
    }
  }
  if (candidate.reviewState !== "ACCEPTED") {
    return { ok: false, error: "Candidate must be accepted before publishing" };
  }

  try {
    let envelope: AuditEnvelope | null = null;
    const result = await prisma.$transaction(async (tx) => {
      const actionItem = await tx.meetingActionItem.create({
        data: {
          bidId,
          meetingId,
          source: "meeting",
          description: candidate.draftText,
          assignedToName:
            candidate.speakerLabel === UNKNOWN_SPEAKER ? null : candidate.speakerLabel,
          dueDate: candidate.dueDate,
          priority: candidate.candidateType === "RISK" ? "HIGH" : "MEDIUM",
          status: "OPEN",
          sourceText: candidate.evidenceExcerpt,
          notes: `Local-only Meeting Intelligence candidate #${candidate.id}; artifact #${candidate.artifactId}; segment #${candidate.segmentId ?? "unknown"}`,
          sourceMeetingIntelligenceCandidateId: candidate.id,
        },
        select: { id: true },
      });
      const claim = await tx.meetingIntelligenceCandidate.updateMany({
        where: { id: candidate.id, reviewState: "ACCEPTED" },
        data: {
          reviewState: "PUBLISHED",
          publishedBy,
          publishedAt: new Date(),
        },
      });
      if (claim.count !== 1) throw new Error("Candidate changed concurrently");

      const remaining = await tx.meetingIntelligenceCandidate.count({
        where: {
          artifactId: candidate.artifactId,
          reviewState: { in: ["DRAFT", "ACCEPTED", "EDITED"] },
        },
      });
      if (remaining === 0) {
        await tx.meetingIntelligenceArtifact.update({
          where: { id: candidate.artifactId },
          data: {
            state: "PUBLISHED",
            publishedAt: new Date(),
            activeSlot: null,
          },
        });
      }
      envelope = await writeRegisterAuditTx(tx, {
        action: "meeting_intelligence_candidate_published",
        decision: "published_to_action_items",
        subjectKind: "MeetingIntelligenceCandidate",
        subjectId: candidate.id,
        actor,
        payload: {
          bidId,
          meetingId,
          artifactId: candidate.artifactId,
          candidateType: candidate.candidateType,
          actionItemId: actionItem.id,
        },
      });
      return {
        candidateId: candidate.id,
        actionItemId: actionItem.id,
        alreadyPublished: false,
      };
    });
    emitRegisterAuditPostCommit(envelope);
    return { ok: true, value: result };
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const actionItem = await prisma.meetingActionItem.findFirst({
        where: { sourceMeetingIntelligenceCandidateId: candidate.id, bidId },
        select: { id: true },
      });
      if (actionItem) {
        return {
          ok: true,
          value: {
            candidateId: candidate.id,
            actionItemId: actionItem.id,
            alreadyPublished: true,
          },
        };
      }
    }
    return { ok: false, error: "Publishing failed; candidate remains accepted" };
  }
}

export async function cancelMeetingIntelligence(
  bidId: number,
  meetingId: number,
  artifactId: number,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ artifactId: number; state: "CANCELED" }>> {
  const canceledBy = actorLabel(actor);
  if (!canceledBy) return { ok: false, error: "A session actor is required" };
  let envelope: AuditEnvelope | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.meetingIntelligenceArtifact.updateMany({
      where: { id: artifactId, meetingId, bidId, state: "QUEUED", activeSlot: 1 },
      data: {
        state: "CANCELED",
        canceledAt: new Date(),
        activeSlot: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claim.count !== 1) return null;
    envelope = await writeRegisterAuditTx(tx, {
      action: "meeting_intelligence_canceled",
      decision: "canceled",
      subjectKind: "MeetingIntelligenceArtifact",
      subjectId: artifactId,
      actor,
      payload: { bidId, meetingId },
    });
    return { artifactId, state: "CANCELED" as const };
  });
  if (!result) return { ok: false, error: "Only a queued artifact can be canceled" };
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: result };
}

export async function correctMeetingIntelligenceSpeaker(
  bidId: number,
  meetingId: number,
  segmentId: number,
  speakerLabel: string,
  actor: Actor,
): Promise<MeetingIntelligenceResult<{ segmentId: number; speakerLabel: string }>> {
  const correctedBy = actorLabel(actor);
  if (!correctedBy) return { ok: false, error: "A session actor is required" };
  if (!isCorrectableSpeakerLabel(speakerLabel)) {
    return { ok: false, error: "speakerLabel must be SPEAKER_n or UNKNOWN_SPEAKER" };
  }
  const normalized = normalizeSpeakerLabel(speakerLabel);
  const segment = await prisma.meetingIntelligenceSegment.findFirst({
    where: { id: segmentId, meetingId, bidId },
  });
  if (!segment) return { ok: false, error: "Not found" };

  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.meetingIntelligenceSegment.update({
      where: { id: segment.id },
      data: {
        currentSpeakerLabel: normalized,
        correctedBy,
        correctedAt: new Date(),
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "meeting_intelligence_speaker_corrected",
      decision: "speaker_overlay_updated",
      subjectKind: "MeetingIntelligenceSegment",
      subjectId: segment.id,
      actor,
      payload: {
        bidId,
        meetingId,
        artifactId: segment.artifactId,
        from: segment.currentSpeakerLabel,
        to: normalized,
      },
    });
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { segmentId: segment.id, speakerLabel: normalized } };
}
