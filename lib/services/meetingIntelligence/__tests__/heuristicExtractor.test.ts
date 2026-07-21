import { describe, expect, it } from "vitest";
import { extractMeetingStructure } from "../heuristicExtractor";

describe("deterministic worker-transcript structural extraction", () => {
  it("creates evidence-linked draft candidate shapes across the existing taxonomy", () => {
    const result = extractMeetingStructure([
      {
        segmentIndex: 0,
        startSec: 5,
        endSec: 10,
        speakerLabel: "SPEAKER_1",
        text: "The contractor will submit the revised RFI by 2026-07-30.",
        confidence: 0.91,
      },
      {
        segmentIndex: 1,
        startSec: 10,
        endSec: 15,
        speakerLabel: "SPEAKER_2",
        text: "The team decided to use the alternate flashing detail in spec section 07 62 00.",
        confidence: 0.88,
      },
      {
        segmentIndex: 2,
        startSec: 15,
        endSec: 20,
        speakerLabel: "SPEAKER_3",
        text: "Closeout O&M records and warranty certificates remain an issue.",
        confidence: 0.82,
      },
    ]);

    expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
      expect.arrayContaining([
        "CONTRACTOR_COMMITMENT",
        "RFI_OR_CLARIFICATION",
        "DUE_DATE",
        "DECISION",
        "SPEC_REFERENCE",
        "CLOSEOUT_ITEM",
        "WARRANTY_ITEM",
        "ISSUE",
      ]),
    );
    expect(result.candidates.every((candidate) => candidate.evidenceExcerpt === candidate.rawText)).toBe(true);
    expect(result.candidates.find((candidate) => candidate.candidateType === "DUE_DATE")?.dueDate?.toISOString()).toBe(
      "2026-07-30T00:00:00.000Z",
    );
    expect(result.sourceMetadataJson).toContain('"realAi":false');
    expect(result.sourceMetadataJson).toContain('"humanReviewRequired":true');
  });

  it("does not invent candidates for neutral transcript text", () => {
    expect(
      extractMeetingStructure([
        {
          segmentIndex: 0,
          startSec: null,
          endSec: null,
          speakerLabel: "UNKNOWN_SPEAKER",
          text: "The meeting began at nine o'clock.",
          confidence: null,
        },
      ]).candidates,
    ).toEqual([]);
  });
});
