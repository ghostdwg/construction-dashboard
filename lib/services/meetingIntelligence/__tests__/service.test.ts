import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPrisma,
  type MockPrisma,
} from "@/lib/services/meetingRegister/__tests__/mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    stat: vi.fn(async () => ({
      size: 5,
      sha256: "a".repeat(64),
      modifiedAt: new Date(),
      contentType: "audio/wav",
    })),
  }),
}));
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import {
  batchReviewMeetingIntelligenceCandidates,
  correctMeetingIntelligenceSpeaker,
  processQueuedMeetingIntelligence,
  publishMeetingIntelligenceCandidate,
  queueMeetingIntelligence,
  reviewMeetingIntelligenceCandidate,
} from "../service";

const ACTOR = { id: "u1", name: "Reviewer", email: "reviewer@example.com" };
const FIXTURE = [
  "[00:04] SPEAKER_1: ACTION_ITEM: Submit the revised RFI by 2026-07-24",
  "[00:12] SPEAKER_2: RISK: Long-lead switchgear may affect turnover",
].join("\n");

async function seedMeeting(media = true) {
  await state.prisma.meeting.create({
    data: {
      id: 5,
      bidId: 1,
      audioStorageKey: media ? "plan-room/jobs/1/meetings/5/audio.wav" : null,
      audioFileName: media ? "audio.wav" : null,
    },
  });
}

async function readyArtifact() {
  const queued = await queueMeetingIntelligence(1, 5, ACTOR);
  if (!queued.ok) throw new Error(queued.error);
  const processed = await processQueuedMeetingIntelligence(
    1,
    5,
    queued.value.artifactId,
    FIXTURE,
    ACTOR,
  );
  if (!processed.ok) throw new Error(processed.error);
  return queued.value.artifactId;
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await seedMeeting();
});

describe("queue and deterministic artifact creation", () => {
  it("reports a meeting without media as not ready and creates no artifact", async () => {
    state.prisma = buildPrisma();
    await seedMeeting(false);
    const result = await queueMeetingIntelligence(1, 5, ACTOR);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toContain("media is unavailable");
    expect(state.prisma.meetingIntelligenceArtifact.rows).toHaveLength(0);
  });

  it("queues an artifact/job reference for a meeting with durable media", async () => {
    const result = await queueMeetingIntelligence(1, 5, ACTOR);
    expect(result).toMatchObject({ ok: true, value: { state: "QUEUED", created: true } });
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      meetingId: 5,
      bidId: 1,
      state: "QUEUED",
      mediaReference: "plan-room/jobs/1/meetings/5/audio.wav",
      sourceKind: "DETERMINISTIC_LOCAL_DEV",
      queuedBy: "reviewer@example.com",
    });
    expect(String(state.prisma.meetingIntelligenceArtifact.rows[0].sourceReference)).toMatch(/^local-mi-/);
    expect(state.prisma.meetingIntelligenceWorkerJob.rows).toHaveLength(1);
    expect(state.prisma.meetingIntelligenceWorkerJob.rows[0]).toMatchObject({
      artifactId: 1,
      meetingId: 5,
      bidId: 1,
      status: "QUEUED",
      sourceMediaChecksum: "a".repeat(64),
      maxAttempts: 3,
    });
  });

  it("materializes transcript segments, evidence candidates, and speaker labels", async () => {
    const artifactId = await readyArtifact();
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      id: artifactId,
      state: "READY_FOR_REVIEW",
      transcriptText: FIXTURE,
    });
    expect(state.prisma.meetingIntelligenceSegment.rows).toHaveLength(2);
    expect(state.prisma.meetingIntelligenceSegment.rows.map((row) => row.originalSpeakerLabel)).toEqual([
      "SPEAKER_1",
      "SPEAKER_2",
    ]);
    expect(state.prisma.meetingIntelligenceCandidate.rows).toHaveLength(2);
    expect(state.prisma.meetingIntelligenceCandidate.rows[0]).toMatchObject({
      candidateType: "ACTION_ITEM",
      speakerLabel: "SPEAKER_1",
      reviewState: "DRAFT",
      evidenceExcerpt: "ACTION_ITEM: Submit the revised RFI by 2026-07-24",
    });
  });

  it("terminalizes a zero-candidate artifact as reviewed", async () => {
    const queued = await queueMeetingIntelligence(1, 5, ACTOR);
    if (!queued.ok) throw new Error(queued.error);
    const processed = await processQueuedMeetingIntelligence(
      1,
      5,
      queued.value.artifactId,
      "[00:04] SPEAKER_1: General coordination discussion",
      ACTOR,
    );
    expect(processed).toMatchObject({ ok: true, value: { candidateCount: 0 } });
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      state: "REVIEWED",
      activeSlot: null,
    });
  });
});

describe("human review and speaker correction", () => {
  it("supports edit, accept, and reject transitions", async () => {
    await readyArtifact();
    expect(
      await reviewMeetingIntelligenceCandidate(
        1,
        5,
        1,
        { action: "EDIT", editedText: "Submit revised RFI package", dueDate: "2026-08-01" },
        ACTOR,
      ),
    ).toMatchObject({ ok: true, value: { reviewState: "EDITED" } });
    expect(state.prisma.meetingIntelligenceCandidate.rows[0].draftText).toBe(
      "Submit revised RFI package",
    );
    expect(state.prisma.meetingIntelligenceCandidate.rows[0].dueDate).toEqual(
      new Date("2026-08-01T12:00:00.000Z"),
    );
    expect(
      await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "ACCEPT" }, ACTOR),
    ).toMatchObject({ ok: true, value: { reviewState: "ACCEPTED" } });
    expect(
      await reviewMeetingIntelligenceCandidate(1, 5, 2, { action: "REJECT" }, ACTOR),
    ).toMatchObject({ ok: true, value: { reviewState: "REJECTED" } });
  });

  it("corrects the speaker through an overlay and preserves the original label", async () => {
    await readyArtifact();
    const result = await correctMeetingIntelligenceSpeaker(1, 5, 1, "SPEAKER_2", ACTOR);
    expect(result).toMatchObject({ ok: true, value: { speakerLabel: "SPEAKER_2" } });
    expect(state.prisma.meetingIntelligenceSegment.rows[0]).toMatchObject({
      originalSpeakerLabel: "SPEAKER_1",
      currentSpeakerLabel: "SPEAKER_2",
      correctedBy: "reviewer@example.com",
    });
  });
});

describe("publish into the existing action workflow", () => {
  it("publishes an accepted candidate once with complete provenance", async () => {
    await readyArtifact();
    await reviewMeetingIntelligenceCandidate(1, 5, 2, { action: "REJECT" }, ACTOR);
    await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "ACCEPT" }, ACTOR);

    const first = await publishMeetingIntelligenceCandidate(1, 5, 1, {
      confirmed: true,
      assignmentConfirmed: true,
      assignedToName: "Morgan Lee",
      priority: "CRITICAL",
    }, ACTOR);
    expect(first).toMatchObject({ ok: true, value: { alreadyPublished: false } });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(1);
    expect(state.prisma.meetingActionItem.rows[0]).toMatchObject({
      bidId: 1,
      meetingId: 5,
      source: "meeting",
      description: "Submit the revised RFI by 2026-07-24",
      assignedToName: "Morgan Lee",
      priority: "CRITICAL",
      sourceText: "ACTION_ITEM: Submit the revised RFI by 2026-07-24",
      sourceMeetingIntelligenceCandidateId: 1,
      status: "OPEN",
    });
    expect(String(state.prisma.meetingActionItem.rows[0].notes)).toContain(
      "artifact #1; segment #1",
    );
    expect(state.prisma.meetingIntelligenceCandidate.rows[0]).toMatchObject({
      reviewState: "PUBLISHED",
      rawText: "Submit the revised RFI by 2026-07-24",
      evidenceExcerpt: "ACTION_ITEM: Submit the revised RFI by 2026-07-24",
      publishedBy: "reviewer@example.com",
    });
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({
      state: "PUBLISHED",
      activeSlot: null,
    });

    const repeat = await publishMeetingIntelligenceCandidate(1, 5, 1, {}, ACTOR);
    expect(repeat).toMatchObject({ ok: true, value: { alreadyPublished: true } });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(1);
  });

  it("never publishes a rejected candidate", async () => {
    await readyArtifact();
    await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "REJECT" }, ACTOR);
    const result = await publishMeetingIntelligenceCandidate(1, 5, 1, {
      confirmed: true,
      assignmentConfirmed: true,
      assignedToName: null,
      priority: "MEDIUM",
    }, ACTOR);
    expect(result).toMatchObject({ ok: false });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(0);
  });

  it("rolls back a failed publish and leaves the candidate accepted", async () => {
    await readyArtifact();
    await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "ACCEPT" }, ACTOR);
    state.prisma.meetingActionItem.create = vi.fn(async () => {
      throw new Error("simulated action workflow failure");
    });

    const result = await publishMeetingIntelligenceCandidate(1, 5, 1, {
      confirmed: true,
      assignmentConfirmed: true,
      assignedToName: null,
      priority: "MEDIUM",
    }, ACTOR);
    expect(result).toEqual({
      ok: false,
      error: "Publishing failed; candidate remains accepted",
    });
    expect(state.prisma.meetingIntelligenceCandidate.rows[0].reviewState).toBe("ACCEPTED");
    expect(state.prisma.meetingActionItem.rows).toHaveLength(0);
  });

  it("requires a human-confirmed assignment disposition and priority", async () => {
    await readyArtifact();
    await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "ACCEPT" }, ACTOR);

    expect(await publishMeetingIntelligenceCandidate(1, 5, 1, {}, ACTOR)).toMatchObject({
      ok: false,
      error: "Human confirmation is required before publishing",
    });
    expect(await publishMeetingIntelligenceCandidate(1, 5, 1, {
      confirmed: true,
      priority: "HIGH",
    }, ACTOR)).toMatchObject({ ok: false });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(0);
  });

  it("does not publish context-only evidence as a standalone task", async () => {
    const artifactId = await readyArtifact();
    const context = await state.prisma.meetingIntelligenceCandidate.create({
      data: {
        artifactId,
        meetingId: 5,
        bidId: 1,
        segmentId: 1,
        candidateType: "DECISION",
        rawText: "Use alternate flashing",
        draftText: "Use alternate flashing",
        evidenceExcerpt: "DECISION: Use alternate flashing",
        speakerLabel: "SPEAKER_1",
        reviewState: "ACCEPTED",
      },
    });
    const result = await publishMeetingIntelligenceCandidate(1, 5, Number(context.id), {
      confirmed: true,
      assignmentConfirmed: true,
      assignedToName: null,
      priority: "MEDIUM",
    }, ACTOR);
    expect(result).toMatchObject({ ok: false, error: "Context-only candidates cannot be published as tasks" });
  });
});

describe("atomic batch review", () => {
  it("accepts or rejects at most 50 same-artifact candidates", async () => {
    const artifactId = await readyArtifact();
    expect(await batchReviewMeetingIntelligenceCandidates(1, 5, artifactId, {
      action: "ACCEPT",
      candidateIds: [1, 2],
    }, ACTOR)).toMatchObject({ ok: true, value: { reviewState: "ACCEPTED" } });
    expect(state.prisma.meetingIntelligenceCandidate.rows.map((row) => row.reviewState)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
    ]);

    expect(await batchReviewMeetingIntelligenceCandidates(1, 5, artifactId, {
      action: "REJECT",
      candidateIds: Array.from({ length: 51 }, (_, index) => index + 1),
    }, ACTOR)).toMatchObject({ ok: false, error: "Batch review is limited to 50 candidates" });
  });

  it("rejects a mixed bid, meeting, or artifact before any write", async () => {
    const artifactId = await readyArtifact();
    await state.prisma.meetingIntelligenceCandidate.create({
      data: {
        artifactId: 99,
        meetingId: 6,
        bidId: 2,
        candidateType: "ACTION_ITEM",
        rawText: "Other bid",
        draftText: "Other bid",
        evidenceExcerpt: "Other bid",
        speakerLabel: "UNKNOWN_SPEAKER",
      },
    });
    const result = await batchReviewMeetingIntelligenceCandidates(1, 5, artifactId, {
      action: "REJECT",
      candidateIds: [1, 3],
    }, ACTOR);
    expect(result).toMatchObject({ ok: false, error: "All candidates must belong to the same bid, meeting, and artifact" });
    expect(state.prisma.meetingIntelligenceCandidate.rows[0].reviewState).toBe("DRAFT");
  });

  it("rolls back every candidate and audit when one candidate changes concurrently", async () => {
    const artifactId = await readyArtifact();
    const updateMany = state.prisma.meetingIntelligenceCandidate.updateMany;
    let calls = 0;
    state.prisma.meetingIntelligenceCandidate.updateMany = vi.fn(async (args) => {
      calls += 1;
      if (calls === 2) return { count: 0 };
      return updateMany(args);
    });
    const result = await batchReviewMeetingIntelligenceCandidates(1, 5, artifactId, {
      action: "REJECT",
      candidateIds: [1, 2],
    }, ACTOR);
    expect(result).toMatchObject({ ok: false, error: "Candidate changed concurrently" });
    expect(state.prisma.meetingIntelligenceCandidate.rows.map((row) => row.reviewState)).toEqual(["DRAFT", "DRAFT"]);
    expect(state.prisma.auditEvent.rows).toHaveLength(2); // queue + process only; batch audit rolled back
  });

  it("terminalizes a reject-all review and releases the artifact slot", async () => {
    const artifactId = await readyArtifact();
    await batchReviewMeetingIntelligenceCandidates(1, 5, artifactId, {
      action: "REJECT",
      candidateIds: [1, 2],
    }, ACTOR);
    expect(state.prisma.meetingIntelligenceArtifact.rows[0]).toMatchObject({ state: "REVIEWED", activeSlot: null });
  });
});
