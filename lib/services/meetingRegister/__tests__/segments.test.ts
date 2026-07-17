// R2-B1 — segment materialization: raw JSON is the immutable source;
// materialization is deterministic + idempotent; display transcript is a
// rebuilt projection.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));

import {
  materializeSegments,
  parseDisplayTranscriptSegments,
  parseRawTranscriptSegments,
  rebuildDisplayTranscript,
} from "../segments";

const RAW = JSON.stringify({
  segments: [
    { speaker: "SPEAKER_0", text: "Good morning everyone.", start: 0.5, end: 2.1 },
    { speaker: "SPEAKER_1", text: "Steel is two weeks late.", start: 3.0, end: 6.4 },
    { speaker: "SPEAKER_0", text: "   ", start: 7, end: 8 }, // empty → dropped
    { text: "Unattributed remark.", start: 9 }, // no speaker, no end
  ],
});

beforeEach(() => {
  state.prisma = buildPrisma();
});

describe("parseRawTranscriptSegments", () => {
  it("parses the transcription-service JSON shape", () => {
    const segs = parseRawTranscriptSegments(RAW);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ segmentIndex: 0, speakerLabel: "SPEAKER_0", startSec: 0.5, endSec: 2.1 });
    expect(segs[2]).toMatchObject({ speakerLabel: null, startSec: 9, endSec: 9 });
  });

  it("returns [] for malformed JSON instead of throwing", () => {
    expect(parseRawTranscriptSegments("{not json")).toEqual([]);
    expect(parseRawTranscriptSegments("{}")).toEqual([]);
  });
});

describe("parseDisplayTranscriptSegments", () => {
  it("parses [MM:SS] and [HH:MM:SS] display lines", () => {
    const segs = parseDisplayTranscriptSegments(
      "[00:12] Mike: We poured Friday.\n[01:02:03] Sarah Chen: Agreed.\nno timestamp line"
    );
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ startSec: 12, speakerLabel: "Mike", text: "We poured Friday." });
    expect(segs[1]).toMatchObject({ startSec: 3723, speakerLabel: "Sarah Chen" });
    expect(segs[2]).toMatchObject({ speakerLabel: null, text: "no timestamp line" });
  });
});

describe("materializeSegments", () => {
  it("materializes once from raw JSON with frozen original columns", async () => {
    await state.prisma.meeting.create({ data: { id: 5, bidId: 1, rawTranscript: RAW, transcript: null } });
    const result = await materializeSegments(1, 5);
    expect(result).toEqual({ ok: true, value: { created: 3, existing: 0 } });

    const rows = state.prisma.meetingTranscriptSegment.rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      originalSpeakerLabel: "SPEAKER_0",
      currentSpeakerLabel: "SPEAKER_0",
      originalText: "Good morning everyone.",
      currentText: "Good morning everyone.",
      isActive: true,
      sortKey: 0,
    });
  });

  it("is idempotent — a second call creates nothing", async () => {
    await state.prisma.meeting.create({ data: { id: 5, bidId: 1, rawTranscript: RAW } });
    await materializeSegments(1, 5);
    const again = await materializeSegments(1, 5);
    expect(again).toEqual({ ok: true, value: { created: 0, existing: 3 } });
    expect(state.prisma.meetingTranscriptSegment.rows).toHaveLength(3);
  });

  it("falls back to display-transcript parsing for manual meetings", async () => {
    await state.prisma.meeting.create({
      data: { id: 6, bidId: 1, rawTranscript: null, transcript: "[00:05] Mike: Manual note." },
    });
    const result = await materializeSegments(1, 6);
    expect(result.ok && result.value.created).toBe(1);
  });

  it("404s on a cross-bid meeting id", async () => {
    await state.prisma.meeting.create({ data: { id: 5, bidId: 2, rawTranscript: RAW } });
    const result = await materializeSegments(1, 5);
    expect(result).toEqual({ ok: false, error: "Not found" });
  });
});

describe("rebuildDisplayTranscript", () => {
  it("rebuilds Meeting.transcript from the CURRENT overlay, leaving rawTranscript untouched", async () => {
    await state.prisma.meeting.create({ data: { id: 5, bidId: 1, rawTranscript: RAW, transcript: "old" } });
    await materializeSegments(1, 5);
    await state.prisma.meetingTranscriptSegment.update({
      where: { id: 2 },
      data: { currentSpeakerLabel: "Dave Ortiz", currentText: "Steel is THREE weeks late." },
    });

    const result = await rebuildDisplayTranscript(1, 5);
    expect(result.ok && result.value.lineCount).toBe(3);

    const meeting = state.prisma.meeting.rows[0];
    expect(meeting.transcript).toContain("[00:03] Dave Ortiz: Steel is THREE weeks late.");
    expect(meeting.rawTranscript).toBe(RAW); // immutable source untouched
  });
});
