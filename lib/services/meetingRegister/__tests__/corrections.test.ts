// R2-B1 — audited corrections over immutable originals: every op appends a
// correction row, only current* overlay columns change, splits deactivate
// (never delete) the original, and an authorless correction is impossible.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
const auditMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));

import { applyCorrection } from "../corrections";

const ACTOR = { name: "Josh", email: "josh@example.com" };

async function seed() {
  await state.prisma.meeting.create({ data: { id: 5, bidId: 1, rawTranscript: null, transcript: null } });
  await state.prisma.meetingParticipant.create({
    data: { id: 11, meetingId: 5, name: "Speaker One", speakerLabel: "SPEAKER_1" },
  });
  const mk = (i: number, label: string, text: string) =>
    state.prisma.meetingTranscriptSegment.create({
      data: {
        meetingId: 5,
        bidId: 1,
        segmentIndex: i,
        sortKey: i,
        startSec: i * 10,
        endSec: i * 10 + 5,
        originalSpeakerLabel: label,
        originalText: text,
        currentSpeakerLabel: label,
        currentText: text,
        isUnknownSpeaker: false,
        isActive: true,
      },
    });
  await mk(0, "SPEAKER_1", "We will pour the deck Friday morning.");
  await mk(1, "SPEAKER_2", "Fine by me. And the crane comes Monday.");
  await mk(2, "SPEAKER_2", "Inspections are booked.");
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  auditMock.mockClear();
  await seed();
});

describe("applyCorrection — discipline", () => {
  it("refuses every op without a session actor", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "EDIT_TEXT", segmentId: 1, newText: "x" },
      { name: null, email: null }
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/actor/i);
    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(0);
  });

  it("404s cross-bid", async () => {
    const result = await applyCorrection(
      99, 5,
      { correctionType: "EDIT_TEXT", segmentId: 1, newText: "x" },
      ACTOR
    );
    expect(result).toMatchObject({ ok: false, error: "Not found" });
  });
});

describe("EDIT_TEXT", () => {
  it("changes currentText only, freezes originalText, appends an audit row", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "EDIT_TEXT", segmentId: 1, newText: "We will pour the deck THURSDAY morning.", reason: "misheard day" },
      ACTOR
    );
    expect(result.ok).toBe(true);
    const seg = state.prisma.meetingTranscriptSegment.rows[0];
    expect(seg.currentText).toBe("We will pour the deck THURSDAY morning.");
    expect(seg.originalText).toBe("We will pour the deck Friday morning."); // frozen
    const log = state.prisma.meetingTranscriptCorrection.rows;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      correctionType: "EDIT_TEXT",
      correctedBy: "josh@example.com",
      reason: "misheard day",
      affectedSegmentCount: 1,
    });
  });
});

describe("REASSIGN_SEGMENT / REASSIGN_ALL_MATCHING / MERGE_SPEAKERS", () => {
  it("reassigns one segment and resolves the participant", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "REASSIGN_SEGMENT", segmentId: 2, toValue: "SPEAKER_1" },
      ACTOR
    );
    expect(result.ok).toBe(true);
    const seg = state.prisma.meetingTranscriptSegment.rows[1];
    expect(seg.currentSpeakerLabel).toBe("SPEAKER_1");
    expect(seg.participantId).toBe(11);
    expect(seg.originalSpeakerLabel).toBe("SPEAKER_2"); // frozen
  });

  it("reassigns all matching segments and reports the count", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "REASSIGN_ALL_MATCHING", fromSpeakerLabel: "SPEAKER_2", toValue: "SPEAKER_1" },
      ACTOR
    );
    expect(result.ok && result.value.affectedSegmentCount).toBe(2);
    const labels = state.prisma.meetingTranscriptSegment.rows.map((r) => r.currentSpeakerLabel);
    expect(labels).toEqual(["SPEAKER_1", "SPEAKER_1", "SPEAKER_1"]);
  });

  it("merge folds one identity into another and rejects self-merge", async () => {
    const self = await applyCorrection(
      1, 5,
      { correctionType: "MERGE_SPEAKERS", fromSpeakerLabel: "SPEAKER_2", toValue: "SPEAKER_2" },
      ACTOR
    );
    expect(self.ok).toBe(false);

    const result = await applyCorrection(
      1, 5,
      { correctionType: "MERGE_SPEAKERS", fromSpeakerLabel: "SPEAKER_2", toValue: "SPEAKER_1" },
      ACTOR
    );
    expect(result.ok && result.value.affectedSegmentCount).toBe(2);
  });
});

describe("RENAME_SPEAKER", () => {
  it("renames the participant and updates register-entry display attribution", async () => {
    await state.prisma.meetingRegisterEntry.create({
      data: {
        meetingId: 5, bidId: 1, entryType: "COMMITMENT", rawSourceText: "q", normalizedText: "q",
        speakerLabel: "SPEAKER_1", speakerName: "Speaker One", origin: "ai_extraction", reviewState: "PENDING",
      },
    });
    const result = await applyCorrection(
      1, 5,
      { correctionType: "RENAME_SPEAKER", fromSpeakerLabel: "SPEAKER_1", toValue: "Mike Johnson" },
      ACTOR
    );
    expect(result.ok).toBe(true);
    expect(state.prisma.meetingParticipant.rows[0].name).toBe("Mike Johnson");
    expect(state.prisma.meetingRegisterEntry.rows[0].speakerName).toBe("Mike Johnson");
    // the affected derived objects were reported by id
    expect(result.ok && result.value.affected.registerEntryIds).toEqual([1]);
  });
});

describe("SPLIT_SEGMENT", () => {
  it("deactivates (never deletes) the original and inserts two provenance-linked halves", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "SPLIT_SEGMENT", segmentId: 2, splitOffset: 11, secondSpeakerLabel: "SPEAKER_1" },
      ACTOR
    );
    expect(result.ok).toBe(true);

    const rows = state.prisma.meetingTranscriptSegment.rows;
    const original = rows.find((r) => r.id === 2)!;
    expect(original.isActive).toBe(false);
    expect(original.currentText).toBe("Fine by me. And the crane comes Monday."); // retained

    const halves = rows.filter((r) => r.splitFromSegmentId === 2);
    expect(halves).toHaveLength(2);
    expect(halves[0].currentText).toBe("Fine by me.");
    expect(halves[1].currentText).toBe("And the crane comes Monday.");
    expect(halves[1].currentSpeakerLabel).toBe("SPEAKER_1");
    // fractional sortKey keeps the second half between neighbors
    expect(halves[1].sortKey as number).toBeGreaterThan(1);
    expect(halves[1].sortKey as number).toBeLessThan(2);
  });

  it("rejects an out-of-range split offset", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "SPLIT_SEGMENT", segmentId: 2, splitOffset: 0 },
      ACTOR
    );
    expect(result.ok).toBe(false);
  });
});

describe("MARK_UNKNOWN", () => {
  it("flags a single segment unknown without touching originals", async () => {
    const result = await applyCorrection(
      1, 5,
      { correctionType: "MARK_UNKNOWN", segmentId: 3 },
      ACTOR
    );
    expect(result.ok).toBe(true);
    const seg = state.prisma.meetingTranscriptSegment.rows[2];
    expect(seg.isUnknownSpeaker).toBe(true);
    expect(seg.originalSpeakerLabel).toBe("SPEAKER_2");
  });
});
