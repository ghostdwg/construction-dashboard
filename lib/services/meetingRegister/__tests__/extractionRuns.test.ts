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
import { applyRun, discardRun, recordAnalysisRun } from "../extractionRuns";

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
    expect(entries.find((e) => e.entryType === "ACTION_ITEM")?.linkedActionItemId).toBe(101);
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

  it("re-applies lifecycle rows through the analysis writer on apply", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    await applyRun(1, 5, runId, ACTOR);
    // writeMeetingAnalysisTx created a fresh AI action item row
    expect(state.prisma.meetingActionItem.rows.length).toBe(1);
    expect(state.prisma.meetingActionItem.rows[0]).toMatchObject({ description: "Do the thing" });
    // ...and the UNCHANGED bridge entry was re-pointed at it (old FK would
    // have gone stale via SetNull when the writer replaced the row).
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
});
