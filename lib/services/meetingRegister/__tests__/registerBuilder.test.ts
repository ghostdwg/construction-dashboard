// R2-B1 — deterministic analysis→register projection (pure, no mocks).

import { describe, expect, it } from "vitest";
import type { MeetingAnalysis } from "@/lib/meeting-analysis";
import { anchorDraftsToSegments, buildRegisterDrafts } from "../registerBuilder";

const baseAnalysis: MeetingAnalysis = {
  section1: { date: "2026-07-01", projectName: "Test Job", durationMinutes: 30 },
  section2: [],
  section3: "Overview.",
  section4: ["Use W12x26 beams at grid line 4"],
  section5: [
    {
      person: "Mike Johnson",
      task: "Submit revised steel shop drawings",
      dueDate: "2026-07-10",
      isGcTask: true,
      carriedFromDate: null,
      evidenceText: "Mike said he would resubmit by Friday",
    },
  ],
  section6: [{ text: "Awaiting RFI 12 answer", reason: "blocks slab pour", carriedFrom: null }],
  section7: [{ tag: "DELAY", description: "Steel delivery slipped two weeks" }],
  section8: [],
  section9: [
    {
      changeText: "Change lobby tile to terrazzo",
      priorIntent: "Porcelain tile per spec 09300",
      affectedSpec: "09300",
      severity: "MAJOR",
      sourceQuote: "let's go terrazzo in the lobby in lieu of tile",
      speakerLabel: "SPEAKER_1",
    },
  ],
  section10: [
    {
      committedBy: "Sarah Chen",
      speakerLabel: "SPEAKER_2",
      commitmentText: "Deliver mockup panel by end of month",
      duePhrase: "end of the month",
      dueDate: "2026-07-31",
      sourceQuote: "we will have the mockup panel on site by end of month",
    },
  ],
};

const writeResult = {
  actionItemIds: [101],
  commitmentIds: [201],
  designChangeIds: [301],
};

describe("buildRegisterDrafts", () => {
  it("projects §4/§5/§6/§7/§9/§10 into typed drafts with bridge links", () => {
    const drafts = buildRegisterDrafts(baseAnalysis, writeResult);
    const byType = Object.fromEntries(drafts.map((d) => [d.entryType, d]));

    expect(drafts).toHaveLength(6);
    expect(byType.DECISION.normalizedText).toBe("Use W12x26 beams at grid line 4");
    expect(byType.DECISION.origin).toBe("ai_extraction");

    expect(byType.ACTION_ITEM.origin).toBe("action_item_bridge");
    expect(byType.ACTION_ITEM.linkedActionItemId).toBe(101);
    expect(byType.ACTION_ITEM.responsibleParty).toBe("Mike Johnson");
    expect(byType.ACTION_ITEM.dueDate?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(byType.ACTION_ITEM.rawSourceText).toBe("Mike said he would resubmit by Friday");

    expect(byType.QUESTION.rawSourceText).toContain("blocks slab pour");
    expect(byType.RISK.agendaTopic).toBe("DELAY");

    expect(byType.DESIGN_CHANGE.origin).toBe("design_change_bridge");
    expect(byType.DESIGN_CHANGE.linkedDesignChangeId).toBe(301);
    expect(byType.DESIGN_CHANGE.rawSourceText).toBe(
      "let's go terrazzo in the lobby in lieu of tile"
    );

    expect(byType.COMMITMENT.origin).toBe("commitment_bridge");
    expect(byType.COMMITMENT.linkedCommitmentId).toBe(201);
    expect(byType.COMMITMENT.responsibleParty).toBe("Sarah Chen");
  });

  it("is deterministic — same input, same output", () => {
    const a = buildRegisterDrafts(baseAnalysis, writeResult);
    const b = buildRegisterDrafts(baseAnalysis, writeResult);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("marks HIGH confidence only when source wording accompanied the item", () => {
    const drafts = buildRegisterDrafts(baseAnalysis, writeResult);
    const byType = Object.fromEntries(drafts.map((d) => [d.entryType, d]));
    expect(byType.ACTION_ITEM.confidence).toBe("HIGH"); // has evidenceText
    expect(byType.DESIGN_CHANGE.confidence).toBe("HIGH"); // has sourceQuote
    expect(byType.DECISION.confidence).toBe("MEDIUM");
    expect(byType.RISK.confidence).toBe("MEDIUM");
  });

  it("drops empty rows and missing bridge ids degrade to null (never wrong ids)", () => {
    const sparse: MeetingAnalysis = {
      ...baseAnalysis,
      section4: ["", "Real decision"],
      section5: [{ ...baseAnalysis.section5[0], task: "  " }],
    };
    const drafts = buildRegisterDrafts(sparse, {
      actionItemIds: [],
      commitmentIds: [],
      designChangeIds: [],
    });
    expect(drafts.filter((d) => d.entryType === "DECISION")).toHaveLength(1);
    expect(drafts.filter((d) => d.entryType === "ACTION_ITEM")).toHaveLength(0);
    expect(drafts.find((d) => d.entryType === "COMMITMENT")?.linkedCommitmentId).toBeNull();
  });
});

describe("anchorDraftsToSegments", () => {
  const segments = [
    { id: 1, startSec: 10, endSec: 15, currentSpeakerLabel: "SPEAKER_1", currentText: "I think let's go terrazzo in the lobby in lieu of tile, okay?" },
    { id: 2, startSec: 90, endSec: 95, currentSpeakerLabel: "SPEAKER_2", currentText: "we will have the mockup panel on site by end of month" },
    { id: 3, startSec: 120, endSec: 125, currentSpeakerLabel: "SPEAKER_2", currentText: "we will have the mockup panel on site by end of month" },
  ];

  it("anchors a verbatim quote that appears in exactly one segment", () => {
    const drafts = buildRegisterDrafts(baseAnalysis, writeResult);
    const anchored = anchorDraftsToSegments(drafts, segments);
    const dc = anchored.find((d) => d.entryType === "DESIGN_CHANGE")!;
    expect(dc.segmentId).toBe(1);
    expect(dc.startSec).toBe(10);
    expect(dc.sourceCitation).toBe("[00:10] SPEAKER_1");
  });

  it("refuses to anchor ambiguous matches (never guesses a citation)", () => {
    const drafts = buildRegisterDrafts(baseAnalysis, writeResult);
    const anchored = anchorDraftsToSegments(drafts, segments);
    const commitment = anchored.find((d) => d.entryType === "COMMITMENT")!;
    expect(commitment.segmentId).toBeNull(); // two segments match
    expect(commitment.sourceCitation).toBe("SPEAKER_2"); // falls back to speaker label
  });
});
