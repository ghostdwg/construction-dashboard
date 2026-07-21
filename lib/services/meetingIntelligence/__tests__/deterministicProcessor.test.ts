import { describe, expect, it } from "vitest";
import { processDeterministicMeetingFixture } from "../deterministicProcessor";
import { MEETING_INTELLIGENCE_CANDIDATE_TYPES } from "../types";

describe("deterministic Meeting Intelligence processor", () => {
  it("creates timestamped transcript segments and preserves speaker labels", () => {
    const result = processDeterministicMeetingFixture([
      "[00:02] SPEAKER_1: ACTION_ITEM: Submit revised logistics plan by 2026-07-24",
      "[00:08] SPEAKER_2: DECISION: Use the east laydown yard",
      "A line without attribution",
    ].join("\n"));

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toMatchObject({
      segmentIndex: 0,
      startSec: 2,
      endSec: 8,
      speakerLabel: "SPEAKER_1",
    });
    expect(result.segments[1].speakerLabel).toBe("SPEAKER_2");
    expect(result.segments[2].speakerLabel).toBe("UNKNOWN_SPEAKER");
    expect(result.candidates[0]).toMatchObject({
      candidateType: "ACTION_ITEM",
      speakerLabel: "SPEAKER_1",
      evidenceExcerpt: "ACTION_ITEM: Submit revised logistics plan by 2026-07-24",
    });
    expect(result.candidates[0].dueDate?.toISOString()).toBe("2026-07-24T00:00:00.000Z");
    expect(result.sourceMetadataJson).toContain("DETERMINISTIC_LOCAL_DEV");
    expect(result.sourceMetadataJson).toContain("LOCAL_ONLY");
  });

  it("preserves every v1 classification, including closeout, warranty, and spec references", () => {
    const fixture = MEETING_INTELLIGENCE_CANDIDATE_TYPES.map(
      (type, index) => `[00:${String(index).padStart(2, "0")}] SPEAKER_1: ${type}: fixture ${type}`,
    ).join("\n");
    const result = processDeterministicMeetingFixture(fixture);
    expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
      MEETING_INTELLIGENCE_CANDIDATE_TYPES,
    );
    expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
      expect.arrayContaining(["CLOSEOUT_ITEM", "WARRANTY_ITEM", "SPEC_REFERENCE"]),
    );
  });
});
