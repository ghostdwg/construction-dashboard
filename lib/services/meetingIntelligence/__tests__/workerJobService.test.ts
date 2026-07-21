import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPrisma,
  type MockPrisma,
} from "@/lib/services/meetingRegister/__tests__/mockDb";

const state = vi.hoisted(() => ({
  prisma: null as unknown as MockPrisma,
  media: Buffer.from("durable-local-meeting-audio"),
  mediaReference: "plan-room/jobs/1/meetings/5/audio.wav",
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));

vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    stat: vi.fn(async (key: string) =>
      key === state.mediaReference
        ? {
            size: state.media.length,
            sha256: createHash("sha256").update(state.media).digest("hex"),
            modifiedAt: new Date(),
            contentType: "audio/wav",
          }
        : null,
    ),
    get: vi.fn(async (key: string) => {
      if (key !== state.mediaReference) throw new Error("missing blob");
      return state.media;
    }),
    put: vi.fn(async () => ({ size: 1, sha256: "b".repeat(64), storedAt: new Date().toISOString() })),
    delete: vi.fn(async () => undefined),
  }),
}));

process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { cancelMeetingIntelligence, queueMeetingIntelligence } from "../service";
import {
  claimNextMeetingIntelligenceJob,
  completeMeetingIntelligenceJob,
  failMeetingIntelligenceJob,
  getMeetingIntelligenceJobMedia,
  heartbeatMeetingIntelligenceJob,
  recoverStaleMeetingIntelligenceJobs,
  reportMeetingIntelligenceProgress,
  retryMeetingIntelligence,
} from "../workerJobService";
import { computeMeetingIntelligenceResultChecksum } from "../workerContract";
import type { WorkerTranscriptSegment } from "../heuristicExtractor";

const ACTOR = { id: "u1", email: "reviewer@example.com" };
const sourceChecksum = () => createHash("sha256").update(state.media).digest("hex");
const toolVersions = {
  transcriptionTool: "deterministic-test-worker",
  transcriptionModel: "fixture",
  transcriptionVersion: "1",
  diarizationTool: "deterministic-test-worker",
  diarizationModel: "fixed",
  diarizationVersion: "1",
};
const transcriptText = [
  "The contractor will submit the revised RFI by 2026-07-30.",
  "The team decided to use the alternate flashing detail.",
].join("\n");
const segments: WorkerTranscriptSegment[] = [
  {
    segmentIndex: 0,
    startSec: 0,
    endSec: 5,
    speakerLabel: "SPEAKER_1",
    text: "The contractor will submit the revised RFI by 2026-07-30.",
    confidence: 0.9,
  },
  {
    segmentIndex: 1,
    startSec: 5,
    endSec: 10,
    speakerLabel: "SPEAKER_2",
    text: "The team decided to use the alternate flashing detail.",
    confidence: 0.85,
  },
];

async function seedMeeting(meetingId = 5, bidId = 1) {
  const reference = `plan-room/jobs/${bidId}/meetings/${meetingId}/audio.wav`;
  if (meetingId === 5 && bidId === 1) state.mediaReference = reference;
  await state.prisma.meeting.create({
    data: { id: meetingId, bidId, audioStorageKey: reference, audioFileName: "audio.wav" },
  });
}

async function queueAndClaim(workerId = "worker-a") {
  const queued = await queueMeetingIntelligence(1, 5, ACTOR);
  if (!queued.ok) throw new Error(queued.error);
  const claimed = await claimNextMeetingIntelligenceJob(workerId);
  if (!claimed.ok || claimed.value.jobId == null) throw new Error("claim failed");
  return claimed.value;
}

function completion(leaseToken: string, overrides: Partial<Parameters<typeof completeMeetingIntelligenceJob>[1]> = {}) {
  const normalizedSegments = segments.map((segment, index) => ({ ...segment, segmentIndex: index }));
  const resultChecksum = computeMeetingIntelligenceResultChecksum({
    transcriptText,
    segments: normalizedSegments,
    toolVersions,
  });
  return {
    leaseToken,
    transcriptText,
    segments: normalizedSegments,
    sourceMediaChecksum: sourceChecksum(),
    resultChecksum,
    toolVersions,
    ...overrides,
  };
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  state.media = Buffer.from("durable-local-meeting-audio");
  state.mediaReference = "plan-room/jobs/1/meetings/5/audio.wav";
  await seedMeeting();
});

describe("durable queue and atomic claim", () => {
  it("reuses the active artifact and worker job on duplicate queue requests", async () => {
    const first = await queueMeetingIntelligence(1, 5, ACTOR);
    const second = await queueMeetingIntelligence(1, 5, ACTOR);
    expect(first).toMatchObject({ ok: true, value: { created: true, workerJobId: 1 } });
    expect(second).toMatchObject({ ok: true, value: { created: false, workerJobId: 1 } });
    expect(state.prisma.meetingIntelligenceArtifact.rows).toHaveLength(1);
    expect(state.prisma.meetingIntelligenceWorkerJob.rows).toHaveLength(1);
  });

  it("allows exactly one winner under concurrent claims", async () => {
    await queueMeetingIntelligence(1, 5, ACTOR);
    const claims = await Promise.all([
      claimNextMeetingIntelligenceJob("worker-a"),
      claimNextMeetingIntelligenceJob("worker-b"),
    ]);
    expect(claims.filter((result) => result.ok && result.value.jobId != null)).toHaveLength(1);
    expect(state.prisma.meetingIntelligenceWorkerJob.rows.filter((job) => job.status === "CLAIMED")).toHaveLength(1);
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[0].leaseToken).toBeUndefined();
    expect(String(state.prisma.meetingIntelligenceWorkerJob.rows[0].leaseTokenHash)).toHaveLength(64);
  });
});

describe("lease ownership, progress, media, and cancellation", () => {
  it("extends a current lease, records progress, and rejects a wrong token", async () => {
    const claimed = await queueAndClaim();
    expect(await heartbeatMeetingIntelligenceJob(claimed.jobId!, claimed.leaseToken!)).toMatchObject({ ok: true });
    expect(
      await reportMeetingIntelligenceProgress(claimed.jobId!, claimed.leaseToken!, "transcribe", 60),
    ).toEqual({ ok: true });
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[0]).toMatchObject({
      status: "RUNNING",
      progressStage: "transcribe",
      progressPercent: 60,
    });
    expect(await heartbeatMeetingIntelligenceJob(claimed.jobId!, "wrong-job-token")).toEqual({
      ok: false,
      reason: "lease_lost",
    });
  });

  it("isolates one job lease from another job", async () => {
    const first = await queueAndClaim("worker-a");
    await state.prisma.meeting.create({
      data: {
        id: 6,
        bidId: 2,
        audioStorageKey: "plan-room/jobs/2/meetings/6/audio.wav",
        audioFileName: "audio.wav",
      },
    });
    await state.prisma.meetingIntelligenceArtifact.create({
      data: {
        id: 2,
        meetingId: 6,
        bidId: 2,
        state: "QUEUED",
        activeSlot: 1,
        mediaReference: "plan-room/jobs/2/meetings/6/audio.wav",
        sourceReference: "second-artifact",
      },
    });
    await state.prisma.meetingIntelligenceWorkerJob.create({
      data: {
        artifactId: 2,
        meetingId: 6,
        bidId: 2,
        idempotencyKey: "second-job",
        status: "QUEUED",
        activeSlot: 1,
        attempt: 1,
        maxAttempts: 3,
        sourceMediaReference: "plan-room/jobs/2/meetings/6/audio.wav",
        sourceMediaChecksum: "c".repeat(64),
      },
    });
    const second = await claimNextMeetingIntelligenceJob("worker-b");
    if (!second.ok || second.value.jobId == null) throw new Error("second claim failed");
    expect(await heartbeatMeetingIntelligenceJob(second.value.jobId, first.leaseToken!)).toEqual({
      ok: false,
      reason: "lease_lost",
    });
  });

  it("serves media only to the current lease and observes cancellation", async () => {
    const claimed = await queueAndClaim();
    const media = await getMeetingIntelligenceJobMedia(claimed.jobId!, claimed.leaseToken!);
    expect(media.ok && media.value.data.equals(state.media)).toBe(true);
    expect(await getMeetingIntelligenceJobMedia(claimed.jobId!, "wrong-token")).toEqual({
      ok: false,
      reason: "lease_lost",
    });
    expect(await cancelMeetingIntelligence(1, 5, claimed.artifactId!, ACTOR)).toMatchObject({ ok: true });
    expect(await heartbeatMeetingIntelligenceJob(claimed.jobId!, claimed.leaseToken!)).toEqual({
      ok: false,
      reason: "canceled",
    });
    expect(await heartbeatMeetingIntelligenceJob(claimed.jobId!, "different-worker-token")).toEqual({
      ok: false,
      reason: "lease_lost",
    });
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[0]).toMatchObject({ status: "CANCELED", activeSlot: null });
  });
});

describe("stale recovery and bounded retry", () => {
  it("marks an expired lease stale and appends the next durable attempt", async () => {
    const claimed = await queueAndClaim();
    await state.prisma.meetingIntelligenceWorkerJob.update({
      where: { id: claimed.jobId! },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await recoverStaleMeetingIntelligenceJobs()).toEqual({ recovered: 1, failed: 0 });
    expect(state.prisma.meetingIntelligenceWorkerJob.rows).toHaveLength(2);
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[0]).toMatchObject({ status: "STALE", activeSlot: null });
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[1]).toMatchObject({ status: "QUEUED", attempt: 2, activeSlot: 1 });
    expect(await heartbeatMeetingIntelligenceJob(claimed.jobId!, claimed.leaseToken!)).toEqual({
      ok: false,
      reason: "lease_lost",
    });
  });

  it("stops after three worker-reported failures", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = attempt === 1
        ? { ok: true as const, value: await queueAndClaim() }
        : await claimNextMeetingIntelligenceJob(`worker-${attempt}`);
      if (!claimed.ok || claimed.value.jobId == null) throw new Error(`claim ${attempt} failed`);
      const failed = await failMeetingIntelligenceJob(
        claimed.value.jobId,
        claimed.value.leaseToken!,
        "STUB_FAILURE",
        "bounded deterministic failure",
      );
      expect(failed).toMatchObject({ ok: true, willRetry: attempt < 3 });
    }
    expect(state.prisma.meetingIntelligenceWorkerJob.rows.map((job) => job.status)).toEqual([
      "FAILED",
      "FAILED",
      "FAILED",
    ]);
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      state: "FAILED",
      activeSlot: null,
      errorCode: "STUB_FAILURE",
    });
  });

  it("allows an authorized manual retry to begin a fresh bounded attempt set", async () => {
    await queueMeetingIntelligence(1, 5, ACTOR);
    await state.prisma.meetingIntelligenceArtifact.update({
      where: { id: 1 },
      data: { state: "FAILED", activeSlot: null, errorCode: "EXHAUSTED" },
    });
    await state.prisma.meetingIntelligenceWorkerJob.update({
      where: { id: 1 },
      data: { status: "FAILED", activeSlot: null, attempt: 3, failedAt: new Date() },
    });
    expect(await retryMeetingIntelligence(1, 5, 1, ACTOR)).toMatchObject({
      ok: true,
      value: { artifactId: 1, jobId: 2, attempt: 1 },
    });
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      state: "QUEUED",
      activeSlot: 1,
      errorCode: null,
    });
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[1]).toMatchObject({
      status: "QUEUED",
      attempt: 1,
      maxAttempts: 3,
      activeSlot: 1,
    });
  });
});

describe("checksummed transcript completion", () => {
  it("persists transcript segments and draft candidates behind human review", async () => {
    const claimed = await queueAndClaim();
    const result = await completeMeetingIntelligenceJob(
      claimed.jobId!,
      completion(claimed.leaseToken!),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { artifactId: 1, segmentCount: 2, alreadySubmitted: false },
    });
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      state: "READY_FOR_REVIEW",
      sourceKind: "PRIVATE_LOCAL_WORKER",
      transcriptText,
    });
    expect(state.prisma.meetingIntelligenceSegment.rows).toHaveLength(2);
    expect(state.prisma.meetingIntelligenceCandidate.rows.length).toBeGreaterThan(0);
    expect(state.prisma.meetingIntelligenceCandidate.rows.every((candidate) => candidate.reviewState === "DRAFT")).toBe(true);
    expect(state.prisma.meetingActionItem.rows).toHaveLength(0);
  });

  it("treats an identical completion as idempotent and rejects a conflict", async () => {
    const claimed = await queueAndClaim();
    const payload = completion(claimed.leaseToken!);
    expect(await completeMeetingIntelligenceJob(claimed.jobId!, payload)).toMatchObject({
      ok: true,
      value: { alreadySubmitted: false },
    });
    expect(await completeMeetingIntelligenceJob(claimed.jobId!, payload)).toMatchObject({
      ok: true,
      value: { alreadySubmitted: true },
    });
    expect(
      await completeMeetingIntelligenceJob(claimed.jobId!, {
        ...payload,
        sourceMediaChecksum: "f".repeat(64),
      }),
    ).toEqual({ ok: false, error: "Conflicting duplicate completion" });
    expect(
      await completeMeetingIntelligenceJob(claimed.jobId!, {
        ...payload,
        leaseToken: "different-worker-token",
      }),
    ).toEqual({ ok: false, error: "Lease lost" });
    const conflictingText = `${transcriptText}\nConflicting late payload.`;
    const conflict = completion(claimed.leaseToken!, {
      transcriptText: conflictingText,
      resultChecksum: computeMeetingIntelligenceResultChecksum({
        transcriptText: conflictingText,
        segments,
        toolVersions,
      }),
    });
    expect(await completeMeetingIntelligenceJob(claimed.jobId!, conflict)).toEqual({
      ok: false,
      error: "Conflicting duplicate completion",
    });
    expect(state.prisma.meetingIntelligenceSegment.rows).toHaveLength(2);
  });

  it("rejects checksum mismatch and stale source-media identity", async () => {
    const claimed = await queueAndClaim();
    expect(
      await completeMeetingIntelligenceJob(
        claimed.jobId!,
        completion(claimed.leaseToken!, { sourceMediaChecksum: "f".repeat(64) }),
      ),
    ).toEqual({ ok: false, error: "Source media checksum mismatch" });
    await state.prisma.meeting.update({
      where: { id: 5 },
      data: { audioStorageKey: "plan-room/jobs/1/meetings/5/replacement.wav" },
    });
    expect(await completeMeetingIntelligenceJob(claimed.jobId!, completion(claimed.leaseToken!))).toEqual({
      ok: false,
      error: "Source media changed after this job was queued",
    });
    expect(state.prisma.meetingIntelligenceSegment.rows).toHaveLength(0);
  });
});
