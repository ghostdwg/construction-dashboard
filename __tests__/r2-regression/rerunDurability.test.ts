// R2 auth/durability regression pack — Area C: Meeting Register rerun
// durability.
//
// lib/services/meetingRegister/__tests__/extractionRuns.test.ts already
// covers computeReconcile's individual passes and the full apply/preview
// pipeline. This file is an INDEPENDENT gate exercising computeReconcile
// (the pure reconciliation core — exported specifically because it is
// pure/deterministic and testable in isolation) with FRESH combined
// scenarios: many preserved-state kinds in one rerun, and — the standout
// finding — a real gap in how PENDING-but-human-edited entries survive a
// rerun, contrasted against the sibling MeetingActionItem reconcile in
// lib/meeting-analysis.ts (fixed by commit ac26c56), which DOES guard this
// exact case and this code path does not.

import { describe, expect, it, vi } from "vitest";

// computeReconcile is pure and touches no prisma table, but the module it
// lives in imports "@/lib/prisma" and "@/lib/meeting-analysis" at the top
// level — mock prisma defensively so import never depends on a real DB,
// matching the repo's existing extractionRuns.test.ts convention.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { computeReconcile, type RunOutcome } from "@/lib/services/meetingRegister/extractionRuns";
import type { RegisterEntryType, EntryOrigin } from "@/lib/services/meetingRegister/types";

type ExistingEntry = {
  id: number;
  entryType: RegisterEntryType;
  rawSourceText: string;
  segmentId: number | null;
  reviewState: string;
  origin: EntryOrigin;
};
type AnchoredDraft = {
  entryType: RegisterEntryType;
  agendaTopic: string | null;
  rawSourceText: string;
  normalizedText: string;
  speakerLabel: string | null;
  speakerName: string | null;
  responsibleParty: string | null;
  dueDate: Date | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  origin: EntryOrigin;
  linkedActionItemId: number | null;
  linkedCommitmentId: number | null;
  linkedDesignChangeId: number | null;
  segmentId: number | null;
  startSec: number | null;
  endSec: number | null;
  sourceCitation: string | null;
};

function draft(overrides: Partial<AnchoredDraft> & { entryType: RegisterEntryType; rawSourceText: string }): AnchoredDraft {
  return {
    agendaTopic: null,
    normalizedText: overrides.rawSourceText,
    speakerLabel: null,
    speakerName: null,
    responsibleParty: null,
    dueDate: null,
    confidence: "MEDIUM",
    origin: "ai_extraction",
    linkedActionItemId: null,
    linkedCommitmentId: null,
    linkedDesignChangeId: null,
    segmentId: null,
    startSec: null,
    endSec: null,
    sourceCitation: null,
    ...overrides,
  };
}

function outcomeFor(outcomes: RunOutcome[], entryId: number): RunOutcome | undefined {
  return outcomes.find((o) => o.entryId === entryId);
}

describe("rerun durability — every non-pristine state survives a single combined reconcile pass", () => {
  it("promoted, dispositioned (all 7 non-promotion values), and manual-confirmed entries are ALL preserved — none appear as supersede/merge/create targets", () => {
    const existing: ExistingEntry[] = [
      { id: 1, entryType: "ACTION_ITEM", rawSourceText: "promoted item text", segmentId: 1, reviewState: "PROMOTED_TO_OPERATIONS", origin: "ai_extraction" },
      { id: 2, entryType: "RISK", rawSourceText: "confirmed risk", segmentId: 2, reviewState: "CONFIRMED", origin: "ai_extraction" },
      { id: 3, entryType: "QUESTION", rawSourceText: "corrected question", segmentId: 3, reviewState: "CORRECTED", origin: "ai_extraction" },
      { id: 4, entryType: "DECISION", rawSourceText: "merged decision", segmentId: 4, reviewState: "MERGED", origin: "ai_extraction" },
      { id: 5, entryType: "RISK", rawSourceText: "duplicate risk", segmentId: 5, reviewState: "DUPLICATE", origin: "ai_extraction" },
      { id: 6, entryType: "QUESTION", rawSourceText: "dismissed question", segmentId: 6, reviewState: "DISMISSED_WITH_REASON", origin: "ai_extraction" },
      { id: 7, entryType: "DISCUSSION", rawSourceText: "discussion only", segmentId: 7, reviewState: "DISCUSSION_ONLY", origin: "ai_extraction" },
      { id: 8, entryType: "INFORMATIONAL", rawSourceText: "informational note", segmentId: 8, reviewState: "INFORMATIONAL", origin: "ai_extraction" },
      { id: 9, entryType: "CONSTRAINT", rawSourceText: "manual note text", segmentId: null, reviewState: "CONFIRMED", origin: "manual" },
    ];
    // Reruns produce a differently-worded draft anchored to EVERY one of the
    // same segments — the exact scenario that would replace a still-PENDING
    // entry. None of these entries are PENDING, so none should be touched.
    const drafts: AnchoredDraft[] = existing
      .filter((e) => e.segmentId != null)
      .map((e) => draft({ entryType: e.entryType, rawSourceText: `re-extracted: ${e.rawSourceText}`, segmentId: e.segmentId }));

    const outcomes = computeReconcile(existing, drafts);

    for (const e of existing) {
      const o = outcomeFor(outcomes, e.id);
      expect(o, `entry ${e.id} (${e.reviewState})`).toBeDefined();
      expect(o?.outcome, `entry ${e.id} (${e.reviewState})`).toBe("preserve");
    }
    // Every draft anchored to a preserved entry's segment becomes a fresh
    // CREATE (never silently dropped, never merged into the preserved row).
    const creates = outcomes.filter((o) => o.outcome === "create");
    expect(creates.length).toBe(drafts.length);
  });

  it("a SUPERSEDED (already-historical) entry gets no outcome at all — never re-touched by a later rerun", () => {
    const existing: ExistingEntry[] = [
      { id: 1, entryType: "RISK", rawSourceText: "old superseded text", segmentId: 1, reviewState: "SUPERSEDED", origin: "ai_extraction" },
    ];
    const outcomes = computeReconcile(existing, []);
    expect(outcomeFor(outcomes, 1)).toBeUndefined();
  });
});

describe("rerun durability — no duplicate creates / phantom creates across a combined pass", () => {
  it("an identical re-extraction (same type+wording) stays UNCHANGED; a genuinely new draft is the only CREATE", () => {
    const existing: ExistingEntry[] = [
      { id: 1, entryType: "RISK", rawSourceText: "Crane pad must cure seven days", segmentId: 1, reviewState: "PENDING", origin: "ai_extraction" },
    ];
    const drafts: AnchoredDraft[] = [
      draft({ entryType: "RISK", rawSourceText: "Crane pad must cure seven days", segmentId: 1 }), // identical
      draft({ entryType: "RISK", rawSourceText: "Unrelated brand-new risk from this run", segmentId: 2 }), // genuinely new
    ];
    const outcomes = computeReconcile(existing, drafts);
    expect(outcomeFor(outcomes, 1)?.outcome).toBe("unchanged");
    const creates = outcomes.filter((o) => o.outcome === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0].draftIndex).toBe(1);
  });

  it("a changed-wording draft anchored to a PENDING entry's segment is classified ONCE (supersede), never ALSO as a second create (no phantom create / no double count)", () => {
    const existing: ExistingEntry[] = [
      { id: 1, entryType: "ACTION_ITEM", rawSourceText: "Submit shop drawings by Friday", segmentId: 1, reviewState: "PENDING", origin: "ai_extraction" },
    ];
    const drafts: AnchoredDraft[] = [
      draft({ entryType: "ACTION_ITEM", rawSourceText: "Submit shop drawings by next Friday (revised)", segmentId: 1 }),
    ];
    const outcomes = computeReconcile(existing, drafts);
    // Exactly one outcome references draftIndex 0 — supersede, not BOTH
    // supersede and create (the R2 remediation this file's header cites).
    const forDraft0 = outcomes.filter((o) => o.draftIndex === 0);
    expect(forDraft0).toHaveLength(1);
    expect(forDraft0[0].outcome).toBe("supersede");
    expect(forDraft0[0].entryId).toBe(1);
  });

  it("two PENDING entries collapsing onto the same draft are supersede+merge, never two independent creates", () => {
    const existing: ExistingEntry[] = [
      { id: 1, entryType: "RISK", rawSourceText: "Fragmented risk part A", segmentId: 1, reviewState: "PENDING", origin: "ai_extraction" },
      { id: 2, entryType: "RISK", rawSourceText: "Fragmented risk part B", segmentId: 1, reviewState: "PENDING", origin: "ai_extraction" },
    ];
    const drafts: AnchoredDraft[] = [draft({ entryType: "RISK", rawSourceText: "Consolidated risk description", segmentId: 1 })];
    const outcomes = computeReconcile(existing, drafts);
    const forDraft0 = outcomes.filter((o) => o.draftIndex === 0);
    expect(forDraft0).toHaveLength(2);
    expect(forDraft0.map((o) => o.outcome).sort()).toEqual(["merge", "supersede"]);
    expect(outcomes.filter((o) => o.outcome === "create")).toHaveLength(0);
  });
});

describe("rerun durability — TrackedItem provenance cannot be orphaned by construction", () => {
  it("a promoted entry (linkedTrackedItemId set) is ALWAYS 'preserve', never a supersede/merge target — the promoted entry's id (and thus TrackedItem.sourceMeetingRegisterEntryId) never changes", () => {
    const existing: ExistingEntry[] = [
      { id: 42, entryType: "ACTION_ITEM", rawSourceText: "Promoted action item text", segmentId: 5, reviewState: "PROMOTED_TO_OPERATIONS", origin: "ai_extraction" },
    ];
    // A rerun that would otherwise supersede entry 42 (same type+segment,
    // different wording) — proves the guard is state-based, not "did the
    // wording change" based.
    const drafts: AnchoredDraft[] = [draft({ entryType: "ACTION_ITEM", rawSourceText: "Completely different re-extracted wording", segmentId: 5 })];
    const outcomes = computeReconcile(existing, drafts);
    expect(outcomeFor(outcomes, 42)?.outcome).toBe("preserve");
    // A TrackedItem whose sourceMeetingRegisterEntryId === 42 keeps
    // resolving to entry 42 — reconcileRegisterTx never issues an update
    // that would touch entry 42's id or delete it (preserve outcomes are
    // excluded from every write branch in reconcileRegisterTx).
  });
});

describe("rerun durability — EXPECTED PRODUCT FAILURE: a human edit to a still-PENDING entry is not protected from supersession", () => {
  // Context: editEntry() (lib/services/meetingRegister/register.ts) lets a
  // human correct normalizedText WITHOUT changing reviewState — an edited
  // entry stays "PENDING" (R2 rule 11 treats only a disposition, which
  // necessarily changes reviewState, as "reviewed"). computeReconcile's ONLY
  // preserve gate is reviewState !== PENDING/SUPERSEDED (see the Pass-0 loop
  // at the top of computeReconcile) — it has no signal for "this PENDING row
  // was edited by a human, don't silently replace it".
  //
  // Contrast: the SIBLING reconcile for MeetingActionItem
  // (lib/meeting-analysis.ts, fixed by commit ac26c56 "non-destructive AI
  // rerun reconciliation") explicitly guards this exact scenario via
  // isReplaceable()'s `!editedSinceCreate(row)` check — a MeetingActionItem
  // edited by a human survives a rerun even while still nominally "open".
  // The MeetingRegisterEntry reconcile added in the same era never received
  // the equivalent guard.
  //
  // This test pins CURRENT behavior (the entry IS replaced) as a known,
  // reproducible gap — not a fix. If this test ever starts failing because
  // someone adds the missing guard, that is a welcome regression: update
  // this test to assert "preserve" and move it out of this describe block.
  it("an entry edited via editEntry() but left PENDING is SUPERSEDED (not preserved) when a re-extraction anchors a differently-worded draft to the same segment", () => {
    // Represents the state AFTER a human called editEntry(bidId, meetingId,
    // 7, { normalizedText: "Human-corrected wording" }, actor) — editEntry
    // never touches rawSourceText or reviewState, so computeReconcile's
    // inputs are indistinguishable from a never-touched PENDING entry.
    const existing: ExistingEntry[] = [
      { id: 7, entryType: "RISK", rawSourceText: "Original raw transcript wording", segmentId: 3, reviewState: "PENDING", origin: "ai_extraction" },
    ];
    const drafts: AnchoredDraft[] = [
      draft({ entryType: "RISK", rawSourceText: "Newly re-extracted wording for the same segment", segmentId: 3 }),
    ];

    const outcomes = computeReconcile(existing, drafts);
    const outcome = outcomeFor(outcomes, 7);

    // EXPECTED PRODUCT FAILURE — documenting current (undesired) behavior.
    // Desired behavior would be "preserve"; actual behavior is "supersede",
    // discarding the human's edit from the active register view.
    expect(outcome?.outcome).toBe("supersede");
  });
});
