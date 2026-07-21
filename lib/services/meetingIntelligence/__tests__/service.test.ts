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
});

describe("human review and speaker correction", () => {
  it("supports edit, accept, and reject transitions", async () => {
    await readyArtifact();
    expect(
      await reviewMeetingIntelligenceCandidate(
        1,
        5,
        1,
        { action: "EDIT", editedText: "Submit revised RFI package" },
        ACTOR,
      ),
    ).toMatchObject({ ok: true, value: { reviewState: "EDITED" } });
    expect(state.prisma.meetingIntelligenceCandidate.rows[0].draftText).toBe(
      "Submit revised RFI package",
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

    const first = await publishMeetingIntelligenceCandidate(1, 5, 1, ACTOR);
    expect(first).toMatchObject({ ok: true, value: { alreadyPublished: false } });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(1);
    expect(state.prisma.meetingActionItem.rows[0]).toMatchObject({
      bidId: 1,
      meetingId: 5,
      source: "meeting",
      description: "Submit the revised RFI by 2026-07-24",
      assignedToName: "SPEAKER_1",
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

    const repeat = await publishMeetingIntelligenceCandidate(1, 5, 1, ACTOR);
    expect(repeat).toMatchObject({ ok: true, value: { alreadyPublished: true } });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(1);
  });

  it("never publishes a rejected candidate", async () => {
    await readyArtifact();
    await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "REJECT" }, ACTOR);
    const result = await publishMeetingIntelligenceCandidate(1, 5, 1, ACTOR);
    expect(result).toMatchObject({ ok: false });
    expect(state.prisma.meetingActionItem.rows).toHaveLength(0);
  });

  it("rolls back a failed publish and leaves the candidate accepted", async () => {
    await readyArtifact();
    await reviewMeetingIntelligenceCandidate(1, 5, 1, { action: "ACCEPT" }, ACTOR);
    state.prisma.meetingActionItem.create = vi.fn(async () => {
      throw new Error("simulated action workflow failure");
    });

    const result = await publishMeetingIntelligenceCandidate(1, 5, 1, ACTOR);
    expect(result).toEqual({
      ok: false,
      error: "Publishing failed; candidate remains accepted",
    });
    expect(state.prisma.meetingIntelligenceCandidate.rows[0].reviewState).toBe("ACCEPTED");
    expect(state.prisma.meetingActionItem.rows).toHaveLength(0);
  });
});
