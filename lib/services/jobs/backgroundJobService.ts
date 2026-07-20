// GWX-003 — Durable background job service
//
// Source of truth for all long-running async work. One BackgroundJob row per
// work unit. Status FSM: queued → running → complete | failed | cancelled.
//
// The sidecar's in-memory _jobs dict is still used for live progress polling
// while the sidecar process is alive. This service owns the durable record
// that survives restarts on both sides.

import { prisma } from "@/lib/prisma";

const JOB_RECONCILIATION_ATTEMPTS = 4;
const JOB_RECONCILIATION_BACKOFF_MS = 100;

export class BackgroundJobReconciliationError extends Error {
  readonly code = "BACKGROUND_JOB_RECONCILIATION_REQUIRED";

  constructor(
    readonly jobId: string,
    readonly originalFailureMessage: string,
    readonly reconciliationCause: unknown,
  ) {
    super(`BackgroundJob ${jobId} requires durable reconciliation`);
    this.name = "BackgroundJobReconciliationError";
  }
}

function isRetryableJobContention(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "P1008" || candidate.code === "P2034") return true;
  return (
    typeof candidate.message === "string" &&
    /SQLITE_BUSY|database is locked|database table is locked/i.test(candidate.message)
  );
}

async function jobContentionBackoff(attempt: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, JOB_RECONCILIATION_BACKOFF_MS * attempt);
  });
}

export type JobType =
  | "spec_analysis"
  | "drawing_analysis"
  | "meeting_transcription"
  | "brief_refresh"
  | "submittal_generation"
  | "market_scrape";

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
  dedupeKey?: string;
  inputSummary?: string;
  triggerSource?: "user" | "automation" | "webhook" | "upload";
}

// ── Write path ─────────────────────────────────────────────────────────────

export async function createJob(params: CreateJobParams) {
  return prisma.backgroundJob.create({
    data: {
      jobType: params.jobType,
      status: "queued",
      bidId: params.bidId ?? null,
      relatedId: params.relatedId ?? null,
      dedupeKey: params.dedupeKey ?? null,
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

export async function failJob(id: string, errorMessage: string, externalJobId?: string) {
  let lastContention: unknown = null;
  for (let attempt = 1; attempt <= JOB_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      const released = await prisma.backgroundJob.updateMany({
        where: { id, status: { in: ["queued", "running", "failed"] } },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage,
          ...(externalJobId ? { externalJobId } : {}),
          activeSlot: null,
        },
      });
      if (released.count === 1) {
        // Return the durable row for callers/tests that need to prove provider
        // id + slot reconciliation. Repeating failJob is safe and converges
        // on the same terminal state.
        return prisma.backgroundJob.findUnique({ where: { id } });
      }

      const current = await prisma.backgroundJob.findUnique({ where: { id } });
      if (!current) {
        throw new BackgroundJobReconciliationError(
          id,
          errorMessage,
          new Error("BackgroundJob not found during failure reconciliation"),
        );
      }
      if (current.status === "failed" && current.activeSlot === null) return current;
      throw new BackgroundJobReconciliationError(
        id,
        errorMessage,
        new Error(`Refusing to rewrite terminal BackgroundJob status ${current.status}`),
      );
    } catch (error) {
      if (error instanceof BackgroundJobReconciliationError) throw error;
      if (!isRetryableJobContention(error)) throw error;
      lastContention = error;
      if (attempt < JOB_RECONCILIATION_ATTEMPTS) {
        await jobContentionBackoff(attempt);
      }
    }
  }

  throw new BackgroundJobReconciliationError(id, errorMessage, lastContention);
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
