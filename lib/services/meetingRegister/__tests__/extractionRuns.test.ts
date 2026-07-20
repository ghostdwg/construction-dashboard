// R2-B1 — extraction runs: initial run applies; reruns land PREVIEWED;
// apply NEVER deletes (release-blocker remediation): identical
// re-extractions are UNCHANGED, removed extractions are SUPERSEDED and stay
// queryable with full provenance, dispositioned entries are frozen
// byte-for-byte; discard keeps the run on record.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
// Real audit module (fail-closed in-tx persistence) — stdout suppressed.
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import type { MeetingAnalysis } from "@/lib/meeting-analysis";
import {
  applyRun,
  computeReconcile,
  discardRun,
  recordAnalysisRun,
  summarizeOutcomes,
} from "../extractionRuns";

const ACTOR = { name: "Josh", email: "josh@example.com" };

const analysis: MeetingAnalysis = {
  section1: { date: "2026-07-01", projectName: "Job", durationMinutes: 30 },
  section2: [],
  section3: "Overview",
  section4: ["Decision A"],
  section5: [
    { person: "Mike", task: "Do the thing", dueDate: null, isGcTask: false, carriedFromDate: null, evidenceText: "quote" },
  ],
  section6: [],
  section7: [],
  section8: [],
  section9: [],
  section10: [],
};

/** Same shape, different extractions — Decision A gone, Decision B new. */
const changedAnalysis: MeetingAnalysis = {
  ...analysis,
  section4: ["Decision B"],
};

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({
    data: { id: 5, bidId: 1, analysisVersion: 1, keyDecisions: "[]", openIssues: "[]", redFlags: "[]" },
  });
});

describe("recordAnalysisRun", () => {
  it("first run applies immediately and projects register entries", async () => {
    const result = await recordAnalysisRun(1, 5, analysis, {
      actionItemIds: [101], commitmentIds: [], designChangeIds: [],
    }, ACTOR);
    expect(result.ok && result.value.status).toBe("APPLIED");

    const entries = state.prisma.meetingRegisterEntry.rows;
    expect(entries).toHaveLength(2); // DECISION + ACTION_ITEM bridge
    expect(entries.every((e) => e.reviewState === "PENDING")).toBe(true);
    expect(entries.find((e) => e.entryType === "ACTION_ITEM")?.linkedActionItemId).toBe(
      state.prisma.meetingActionItem.rows[0].id,
    );
    expect(state.prisma.meetingExtractionRun.rows[0]).toMatchObject({
      trigger: "INITIAL",
      status: "APPLIED",
    });
    // The mandatory AuditEvent row committed with the projection.
    expect(
      state.prisma.auditEvent.rows.filter((a) => a.action === "extraction_run_applied")
    ).toHaveLength(1);
  });

  it("subsequent runs land PREVIEWED with the full outcome diff and stored analysis", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    expect(rerun.ok && rerun.value.status).toBe("PREVIEWED");
    // Identical analysis → everything is UNCHANGED; nothing to add or supersede.
    expect(rerun.ok && rerun.value.preview).toMatchObject({
      toAdd: 0,
      unchanged: 2,
      toSupersede: 0,
      preservedDispositioned: 0,
    });
    const run = state.prisma.meetingExtractionRun.rows[1];
    expect(run.status).toBe("PREVIEWED");
    expect(JSON.parse(run.analysisJson as string).section4).toEqual(["Decision A"]);
    // nothing changed in the register yet — preview only (rule 8)
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(2);
  });

  it("previews create/supersede/unchanged/preserve outcomes for a changed analysis", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, null, ACTOR);
    expect(rerun.ok && rerun.value.preview).toMatchObject({
      toAdd: 1, // Decision B
      unchanged: 1, // the ACTION_ITEM bridge re-extracted identically
      toSupersede: 1, // Decision A no longer produced
      preservedDispositioned: 0,
    });
    const outcomes = rerun.ok ? rerun.value.preview.outcomes : [];
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(["create", "supersede", "unchanged"]);
  });

  it("preserves a revision-backed human edit through preview and apply while creating the new proposal", async () => {
    await recordAnalysisRun(1, 5, analysis, {
      actionItemIds: [101], commitmentIds: [], designChangeIds: [],
    }, ACTOR);
    const decision = state.prisma.meetingRegisterEntry.rows.find(
      (row) => row.entryType === "DECISION",
    )!;
    await state.prisma.meetingRegisterEntry.update({
      where: { id: decision.id as number },
      data: { normalizedText: "Human-corrected decision wording" },
    });
    await state.prisma.meetingRegisterEntryRevision.create({
      data: {
        entryId: decision.id,
        bidId: 1,
        changeType: "EDIT",
        actor: ACTOR.email,
      },
    });

    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, null, ACTOR);
    expect(rerun.ok && rerun.value.preview).toMatchObject({
      toAdd: 1,
      toSupersede: 0,
      preservedDispositioned: 1,
    });
    const applied = await applyRun(1, 5, rerun.ok ? rerun.value.runId : -1, ACTOR);

    expect(applied.ok).toBe(true);
    expect(state.prisma.meetingRegisterEntry.rows.find((row) => row.id === decision.id)).toMatchObject({
      reviewState: "PENDING",
      normalizedText: "Human-corrected decision wording",
      supersededByRunId: null,
    });
    expect(state.prisma.meetingRegisterEntry.rows).toContainEqual(
      expect.objectContaining({ rawSourceText: "Decision B", reviewState: "PENDING" }),
    );
  });

  it.each(["OPEN", "CLOSED", "DEFERRED"])(
    "preserves %s action-item identity, lifecycle, and promotion source links",
    async (status) => {
      await recordAnalysisRun(1, 5, analysis, ACTOR);
      const actionId = state.prisma.meetingActionItem.rows[0].id as number;
      await state.prisma.meetingActionItem.update({
        where: { id: actionId },
        data: { status, notes: "human lifecycle state", closedAt: status === "CLOSED" ? new Date() : null },
      });
      await state.prisma.trackedItem.create({
        data: { bidId: 1, title: "Promoted action", sourceMeetingActionItemId: actionId },
      });
      const before = { ...state.prisma.meetingActionItem.rows[0] };

      const rerun = await recordAnalysisRun(1, 5, analysis, ACTOR);
      const applied = await applyRun(1, 5, rerun.ok ? rerun.value.runId : -1, ACTOR);
      expect(applied.ok).toBe(true);
      expect(state.prisma.meetingActionItem.rows).toHaveLength(1);
      expect(state.prisma.meetingActionItem.rows[0]).toEqual(before);
      expect(state.prisma.trackedItem.rows[0].sourceMeetingActionItemId).toBe(actionId);
    },
  );

  it("preserves an unquoted action item across rerun and apply", async () => {
    const unquotedAnalysis: MeetingAnalysis = {
      ...analysis,
      section5: [{ ...analysis.section5[0], evidenceText: null }],
    };
    await recordAnalysisRun(1, 5, unquotedAnalysis, ACTOR);
    const actionId = state.prisma.meetingActionItem.rows[0].id as number;
    await state.prisma.meetingActionItem.update({
      where: { id: actionId },
      data: { status: "CLOSED", notes: "confirmed without a quote" },
    });
    const before = { ...state.prisma.meetingActionItem.rows[0] };

    const rerun = await recordAnalysisRun(1, 5, unquotedAnalysis, ACTOR);
    const applied = await applyRun(1, 5, rerun.ok ? rerun.value.runId : -1, ACTOR);

    expect(applied.ok).toBe(true);
    expect(state.prisma.meetingActionItem.rows).toHaveLength(1);
    expect(state.prisma.meetingActionItem.rows[0]).toEqual(before);
  });

  it.each(["lifecycle", "register", "audit"])(
    "rolls initial analysis across every table back on %s failure",
    async (failure) => {
      const table = failure === "lifecycle"
        ? state.prisma.meetingActionItem
        : failure === "register"
          ? state.prisma.meetingRegisterEntry
          : state.prisma.auditEvent;
      const realCreate = table.create;
      table.create = async () => {
        throw new Error(`synthetic ${failure} failure`);
      };
      const before = {
        meeting: state.prisma.meeting.rows.map((row) => ({ ...row })),
        participants: state.prisma.meetingParticipant.rows.map((row) => ({ ...row })),
        segments: state.prisma.meetingTranscriptSegment.rows.map((row) => ({ ...row })),
        actions: state.prisma.meetingActionItem.rows.map((row) => ({ ...row })),
        commitments: state.prisma.meetingCommitment.rows.map((row) => ({ ...row })),
        designs: state.prisma.designIntentChange.rows.map((row) => ({ ...row })),
        runs: state.prisma.meetingExtractionRun.rows.map((row) => ({ ...row })),
        entries: state.prisma.meetingRegisterEntry.rows.map((row) => ({ ...row })),
        revisions: state.prisma.meetingRegisterEntryRevision.rows.map((row) => ({ ...row })),
        audits: state.prisma.auditEvent.rows.map((row) => ({ ...row })),
      };
      await expect(recordAnalysisRun(1, 5, analysis, ACTOR)).rejects.toThrow(
        `synthetic ${failure} failure`,
      );
      table.create = realCreate;
      expect({
        meeting: state.prisma.meeting.rows,
        participants: state.prisma.meetingParticipant.rows,
        segments: state.prisma.meetingTranscriptSegment.rows,
        actions: state.prisma.meetingActionItem.rows,
        commitments: state.prisma.meetingCommitment.rows,
        designs: state.prisma.designIntentChange.rows,
        runs: state.prisma.meetingExtractionRun.rows,
        entries: state.prisma.meetingRegisterEntry.rows,
        revisions: state.prisma.meetingRegisterEntryRevision.rows,
        audits: state.prisma.auditEvent.rows,
      }).toEqual(before);
    },
  );
});

describe("applyRun — freeze + preservation discipline", () => {
  it("preserves dispositioned entries byte-for-byte and never deletes pending entries", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    // Human dispositions the DECISION entry; the ACTION_ITEM stays PENDING.
    await state.prisma.meetingRegisterEntry.update({
      where: { id: 1 },
      data: {
        reviewState: "CONFIRMED",
        dispositionBy: "josh@example.com",
        normalizedText: "Decision A (confirmed wording)",
      },
    });

    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    const applied = await applyRun(1, 5, runId, ACTOR);
    expect(applied.ok).toBe(true);
    // Dispositioned DECISION preserved; identical DECISION draft has no
    // PENDING counterpart so it lands as a new PENDING entry; the identical
    // ACTION_ITEM re-extraction is UNCHANGED (kept, not recreated).
    expect(applied.ok && applied.value.preview).toMatchObject({
      toAdd: 1,
      unchanged: 1,
      toSupersede: 0,
      preservedDispositioned: 1,
    });

    const rows = state.prisma.meetingRegisterEntry.rows;
    const confirmed = rows.find((r) => r.id === 1);
    expect(confirmed).toBeDefined(); // survived the rerun
    expect(confirmed).toMatchObject({
      reviewState: "CONFIRMED",
      normalizedText: "Decision A (confirmed wording)",
    });
    // NO deletion happened: original pending ACTION_ITEM entry (id 2) still
    // exists under its original id with its ORIGINATING run intact.
    const bridge = rows.find((r) => r.id === 2);
    expect(bridge).toMatchObject({ reviewState: "PENDING", entryType: "ACTION_ITEM", extractionRunId: 1 });
    expect(rows.filter((r) => r.reviewState === "PENDING")).toHaveLength(2);

    const run = state.prisma.meetingExtractionRun.rows[1];
    expect(run.status).toBe("APPLIED");
    expect(run.analysisJson).toBe("{}"); // bulky payload cleared
    expect(run.appliedBy).toBe("josh@example.com");
  });

  it("supersedes (never deletes) pending entries the new analysis no longer produces, with queryable provenance", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    const applied = await applyRun(1, 5, runId, ACTOR);
    expect(applied.ok && applied.value.preview).toMatchObject({
      toAdd: 1,
      unchanged: 1,
      toSupersede: 1,
    });

    const rows = state.prisma.meetingRegisterEntry.rows;
    // Decision A: retained, marked SUPERSEDED, previous wording/classification
    // intact, replacing run recorded.
    const supersededEntry = rows.find((r) => r.rawSourceText === "Decision A");
    expect(supersededEntry).toMatchObject({
      reviewState: "SUPERSEDED",
      entryType: "DECISION",
      normalizedText: "Decision A",
      extractionRunId: 1, // originating run preserved
      supersededByRunId: runId, // replacement run recorded
    });
    expect(supersededEntry?.supersededAt).toBeInstanceOf(Date);
    // Decision B exists as a new PENDING entry from the applying run.
    expect(rows.find((r) => r.rawSourceText === "Decision B")).toMatchObject({
      reviewState: "PENDING",
      extractionRunId: runId,
    });
    // The supersession appended an immutable revision row.
    expect(
      state.prisma.meetingRegisterEntryRevision.rows.filter(
        (r) => r.changeType === "RERUN_SUPERSEDE" && r.entryId === supersededEntry?.id
      )
    ).toHaveLength(1);
  });

  it("preserves promoted entries and their Operations Register links across reruns", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    // Promote the ACTION_ITEM entry (id 2) — simulate the promotion outcome.
    await state.prisma.trackedItem.create({
      data: { id: 900, bidId: 1, kind: "OAC_ACTION", title: "Do the thing", sourceMeetingRegisterEntryId: 2 },
    });
    await state.prisma.meetingRegisterEntry.update({
      where: { id: 2 },
      data: { reviewState: "PROMOTED_TO_OPERATIONS", linkedTrackedItemId: 900 },
    });

    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    const applied = await applyRun(1, 5, runId, ACTOR);
    expect(applied.ok).toBe(true);

    const promoted = state.prisma.meetingRegisterEntry.rows.find((r) => r.id === 2);
    expect(promoted).toMatchObject({
      reviewState: "PROMOTED_TO_OPERATIONS",
      linkedTrackedItemId: 900, // ops link untouched
    });
    expect(promoted?.supersededByRunId).toBeNull();
  });

  it("repeated application of identical analyses is idempotent (all UNCHANGED, no growth)", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const countAfterInitial = state.prisma.meetingRegisterEntry.rows.length;

    for (let i = 0; i < 2; i++) {
      const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
      const runId = rerun.ok ? rerun.value.runId : -1;
      const applied = await applyRun(1, 5, runId, ACTOR);
      expect(applied.ok && applied.value.preview).toMatchObject({
        toAdd: 0,
        unchanged: 2,
        toSupersede: 0,
      });
    }
    // Same entries, same ids, still PENDING, no duplicates, nothing deleted.
    const rows = state.prisma.meetingRegisterEntry.rows;
    expect(rows).toHaveLength(countAfterInitial);
    expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(rows.every((r) => r.reviewState === "PENDING")).toBe(true);
    // Re-applying an APPLIED run is rejected outright.
    const again = await applyRun(1, 5, 2, ACTOR);
    expect(again).toMatchObject({ ok: false, error: "Cannot apply a APPLIED run" });
  });

  it("keeps prior extraction-run history queryable after later applies", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    await applyRun(1, 5, runId, ACTOR);

    // Both runs remain on record with their previews.
    const runs = state.prisma.meetingExtractionRun.rows;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ trigger: "INITIAL", status: "APPLIED" });
    expect(runs[1]).toMatchObject({ trigger: "RERUN", status: "APPLIED" });
    // Entries from run 1 remain queryable BY run — the superseded Decision A
    // still cites run 1 as its origin, and its wording is intact.
    const fromRun1 = state.prisma.meetingRegisterEntry.rows.filter(
      (r) => r.extractionRunId === 1
    );
    expect(fromRun1.length).toBeGreaterThan(0);
    expect(fromRun1.find((r) => r.reviewState === "SUPERSEDED")?.rawSourceText).toBe("Decision A");
  });

  it("reuses lifecycle rows through the analysis writer on apply", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    await applyRun(1, 5, runId, ACTOR);
    // writeMeetingAnalysisTx reused the canonical AI action item row.
    expect(state.prisma.meetingActionItem.rows.length).toBe(1);
    expect(state.prisma.meetingActionItem.rows[0]).toMatchObject({ description: "Do the thing" });
    // The UNCHANGED bridge keeps pointing at the same durable identity.
    const bridge = state.prisma.meetingRegisterEntry.rows.find((r) => r.entryType === "ACTION_ITEM");
    expect(bridge?.linkedActionItemId).toBe(state.prisma.meetingActionItem.rows[0].id);
  });

  it("rolls the whole apply back when the mandatory audit write fails", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;

    const before = state.prisma.meetingRegisterEntry.rows.map((r) => ({ ...r }));
    const realCreate = state.prisma.auditEvent.create;
    state.prisma.auditEvent.create = async () => {
      throw new Error("audit store down");
    };
    await expect(applyRun(1, 5, runId, ACTOR)).rejects.toThrow("audit store down");
    state.prisma.auditEvent.create = realCreate;

    // Nothing mutated: no supersession, no new entries, run still PREVIEWED.
    expect(state.prisma.meetingRegisterEntry.rows).toEqual(before);
    expect(state.prisma.meetingExtractionRun.rows[1].status).toBe("PREVIEWED");
  });

  it("cannot apply a non-PREVIEWED run and 404s cross-bid", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const alreadyApplied = await applyRun(1, 5, 1, ACTOR);
    expect(alreadyApplied.ok).toBe(false);
    const crossBid = await applyRun(2, 5, 1, ACTOR);
    expect(crossBid).toMatchObject({ ok: false, error: "Not found" });
  });

  it("claims PREVIEWED atomically so concurrent double-apply has one winner", async () => {
    await recordAnalysisRun(1, 5, analysis, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    const results = await Promise.all([
      applyRun(1, 5, runId, ACTOR),
      applyRun(1, 5, runId, ACTOR),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: "Run is no longer PREVIEWED" },
    ]);
    expect(state.prisma.meetingExtractionRun.rows[1].status).toBe("APPLIED");
    expect(
      state.prisma.auditEvent.rows.filter(
        (row) => row.action === "extraction_run_applied" && row.subjectId === String(runId),
      ),
    ).toHaveLength(1);
  });
});

describe("same-anchor reconcile accounting", () => {
  const draft = (rawSourceText: string) => ({
    entryType: "DECISION" as const,
    agendaTopic: null,
    rawSourceText,
    normalizedText: rawSourceText,
    speakerLabel: null,
    speakerName: null,
    responsibleParty: null,
    dueDate: null,
    confidence: "MEDIUM" as const,
    origin: "ai_extraction" as const,
    linkedActionItemId: null,
    linkedCommitmentId: null,
    linkedDesignChangeId: null,
    segmentId: 77,
    startSec: 1,
    endSec: 2,
    sourceCitation: "[00:01] SPEAKER_0",
  });

  it("classifies changed wording once and counts one replacement", () => {
    const outcomes = computeReconcile(
      [{ id: 1, entryType: "DECISION", rawSourceText: "Old wording", segmentId: 77, reviewState: "PENDING", origin: "ai_extraction" }],
      [draft("Changed wording")],
    );
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["supersede"]);
    expect(summarizeOutcomes(outcomes)).toMatchObject({ toAdd: 1, toSupersede: 1, merged: 0 });
  });

  it("counts a many-to-one anchor merge as one replacement and two supersessions", () => {
    const outcomes = computeReconcile(
      [
        { id: 1, entryType: "DECISION", rawSourceText: "Old A", segmentId: 77, reviewState: "PENDING", origin: "ai_extraction" },
        { id: 2, entryType: "DECISION", rawSourceText: "Old B", segmentId: 77, reviewState: "PENDING", origin: "ai_extraction" },
      ],
      [draft("Canonical merged wording")],
    );
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["supersede", "merge"]);
    expect(summarizeOutcomes(outcomes)).toMatchObject({ toAdd: 1, toSupersede: 2, merged: 1 });
  });

  it.each([
    { label: "revision-backed human edit", revisionCount: 1 },
    { label: "Operations Register link", linkedTrackedItemId: 900 },
    { label: "manual provenance", origin: "manual" },
  ])("preserves a PENDING $label instead of superseding it", (change) => {
    const existing = {
      id: 1,
      entryType: "DECISION",
      rawSourceText: "Machine wording",
      normalizedText: "Machine wording",
      segmentId: 77,
      reviewState: "PENDING",
      origin: "ai_extraction",
      ...change,
    };
    const outcomes = computeReconcile([existing], [draft("Replacement wording")]);
    expect(outcomes).toEqual([
      { outcome: "preserve", entryId: 1, entryType: "DECISION" },
      { outcome: "create", draftIndex: 0, entryType: "DECISION" },
    ]);
  });
});

describe("discardRun", () => {
  it("discards a previewed run, keeping it on record", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    const result = await discardRun(1, 5, runId, ACTOR);
    expect(result.ok).toBe(true);
    const run = state.prisma.meetingExtractionRun.rows[1];
    expect(run.status).toBe("DISCARDED");
    // register untouched
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(2);
  });

  it("claims PREVIEWED atomically so concurrent double-discard has one winner", async () => {
    await recordAnalysisRun(1, 5, analysis, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;

    const results = await Promise.all([
      discardRun(1, 5, runId, ACTOR),
      discardRun(1, 5, runId, ACTOR),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(state.prisma.meetingExtractionRun.rows[1]).toMatchObject({
      status: "DISCARDED",
      analysisJson: "{}",
    });
    expect(
      state.prisma.auditEvent.rows.filter(
        (row) => row.action === "extraction_run_discarded" && row.subjectId === String(runId),
      ),
    ).toHaveLength(1);
  });

  it("gives apply versus discard one terminal winner and one matching audit", async () => {
    await recordAnalysisRun(1, 5, analysis, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, changedAnalysis, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;

    const results = await Promise.all([
      applyRun(1, 5, runId, ACTOR),
      discardRun(1, 5, runId, ACTOR),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const run = state.prisma.meetingExtractionRun.rows[1];
    expect(["APPLIED", "DISCARDED"]).toContain(run.status);
    expect(run.analysisJson).toBe("{}");
    const terminalAudits = state.prisma.auditEvent.rows.filter(
      (row) =>
        row.subjectId === String(runId) &&
        (row.action === "extraction_run_applied" || row.action === "extraction_run_discarded"),
    );
    expect(terminalAudits).toHaveLength(1);
    expect(terminalAudits[0].action).toBe(
      run.status === "APPLIED" ? "extraction_run_applied" : "extraction_run_discarded",
    );
  });
});
