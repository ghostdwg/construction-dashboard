// GWX-003 — Durable background job service
//
// Source of truth for all long-running async work. One BackgroundJob row per
// work unit. Status FSM: queued → running → complete | failed | cancelled.
//
// The sidecar's in-memory _jobs dict is still used for live progress polling
// while the sidecar process is alive. This service owns the durable record
// that survives restarts on both sides.

import { prisma } from "@/lib/prisma";

export type JobType =
  | "spec_analysis"
  | "drawing_analysis"
  | "meeting_transcription";

export type JobStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export interface CreateJobParams {
  jobType: JobType;
  bidId?: number;
  relatedId?: string;
  inputSummary?: string;
  triggerSource?: "user" | "automation" | "webhook";
}

// ── Write path ─────────────────────────────────────────────────────────────

export async function createJob(params: CreateJobParams) {
  return prisma.backgroundJob.create({
    data: {
      jobType: params.jobType,
      status: "queued",
      bidId: params.bidId ?? null,
      relatedId: params.relatedId ?? null,
      inputSummary: params.inputSummary ?? null,
      triggerSource: params.triggerSource ?? "user",
    },
  });
}

export async function startJob(id: string, externalJobId?: string) {
  return prisma.backgroundJob.update({
    where: { id },
    data: {
      status: "running",
      startedAt: new Date(),
      externalJobId: externalJobId ?? null,
    },
  });
}

export async function completeJob(
  id: string,
  opts?: { resultSummary?: string; artifactType?: string }
) {
  return prisma.backgroundJob.update({
    where: { id },
    data: {
      status: "complete",
      completedAt: new Date(),
      resultSummary: opts?.resultSummary ?? null,
      artifactType: opts?.artifactType ?? null,
      activeSlot: null, // release the unique slot so future jobs can run
    },
  });
}

export async function failJob(id: string, errorMessage: string) {
  return prisma.backgroundJob.update({
    where: { id },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage,
      activeSlot: null, // release the unique slot so future jobs can run
    },
  });
}

// ── Read path ──────────────────────────────────────────────────────────────

export async function getJob(id: string) {
  return prisma.backgroundJob.findUnique({ where: { id } });
}

// Find the most recent running/queued job for a bid+type by its sidecar job id.
// Used by the webhook callback to close out the right record.
export async function findJobByExternalId(
  externalJobId: string,
  bidId?: number
) {
  return prisma.backgroundJob.findFirst({
    where: {
      externalJobId,
      ...(bidId != null ? { bidId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

// Returns the most recent queued or running job for a bid+type.
// Used by automation triggers to avoid duplicate overlapping runs.
export async function findActiveJobForBid(bidId: number, jobType: JobType) {
  return prisma.backgroundJob.findFirst({
    where: { bidId, jobType, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, externalJobId: true },
  });
}

export async function listJobsForBid(bidId: number, limit = 20) {
  return prisma.backgroundJob.findMany({
    where: { bidId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      jobType: true,
      status: true,
      inputSummary: true,
      resultSummary: true,
      errorMessage: true,
      triggerSource: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      externalJobId: true,
    },
  });
}
