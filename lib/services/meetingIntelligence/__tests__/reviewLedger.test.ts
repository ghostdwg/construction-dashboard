import { describe, expect, it } from "vitest";
import {
  candidateDispositionCounts,
  filterMeetingIntelligenceCandidates,
  groupMeetingIntelligenceCandidates,
} from "../reviewLedger";

const candidates = [
  { id: 1, segmentId: 7, candidateType: "DECISION", rawText: "Decision", draftText: "Decision", evidenceExcerpt: "Shared evidence", speakerLabel: "SPEAKER_1", startSec: 10, endSec: 14, confidence: 0.8, dueDate: null, reviewState: "DRAFT" },
  { id: 2, segmentId: 7, candidateType: "ACTION_ITEM", rawText: "Install flashing", draftText: "Install flashing", evidenceExcerpt: "Shared evidence", speakerLabel: "SPEAKER_1", startSec: 10, endSec: 14, confidence: 0.9, dueDate: "2026-07-25T12:00:00.000Z", reviewState: "ACCEPTED" },
  { id: 3, segmentId: null, candidateType: "SPEC_REFERENCE", rawText: "Spec 07", draftText: "Spec 07", evidenceExcerpt: "Spec 07 62 00", speakerLabel: "SPEAKER_2", startSec: 30, endSec: 35, confidence: 0.7, dueDate: null, reviewState: "REJECTED" },
];

describe("Meeting Intelligence review ledger read model", () => {
  it("groups same-segment candidates under one evidence block and orders the task first", () => {
    const groups = groupMeetingIntelligenceCandidates(candidates, [{ id: 7, currentSpeakerLabel: "SPEAKER_9", currentText: "Current corrected transcript", startSec: 10, endSec: 14 }]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: "segment:7", speakerLabel: "SPEAKER_9" });
    expect(groups[0].candidates.map((candidate) => candidate.id)).toEqual([2, 1]);
    expect(groups[0].segment?.currentText).toBe("Current corrected transcript");
  });

  it("filters by disposition, candidate type, actionability, due state, and search", () => {
    expect(filterMeetingIntelligenceCandidates(candidates, { state: "ACCEPTED" }).map((candidate) => candidate.id)).toEqual([2]);
    expect(filterMeetingIntelligenceCandidates(candidates, { type: "SPEC_REFERENCE" }).map((candidate) => candidate.id)).toEqual([3]);
    expect(filterMeetingIntelligenceCandidates(candidates, { actionability: "context" }).map((candidate) => candidate.id)).toEqual([1, 3]);
    expect(filterMeetingIntelligenceCandidates(candidates, { due: "next7" }, new Date("2026-07-22T12:00:00.000Z")).map((candidate) => candidate.id)).toEqual([2]);
    expect(filterMeetingIntelligenceCandidates(candidates, { search: "flashing" }).map((candidate) => candidate.id)).toEqual([2]);
    expect(candidateDispositionCounts(candidates)).toEqual({ DRAFT: 1, ACCEPTED: 1, REJECTED: 1 });
  });
});
