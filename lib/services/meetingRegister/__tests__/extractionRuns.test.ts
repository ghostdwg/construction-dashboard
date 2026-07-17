// R2-B1 — extraction runs: initial run applies; reruns land PREVIEWED;
// apply replaces PENDING machine entries ONLY (dispositioned entries are
// frozen byte-for-byte); discard keeps the run on record.

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

beforeEach(async () => {
  state.prisma = buildPrisma();
  auditMock.mockClear();
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
  });

  it("subsequent runs land PREVIEWED with a diff summary and stored analysis", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    expect(rerun.ok && rerun.value.status).toBe("PREVIEWED");
    expect(rerun.ok && rerun.value.preview).toMatchObject({
      toAdd: 2,
      toReplacePending: 2,
      preservedDispositioned: 0,
    });
    const run = state.prisma.meetingExtractionRun.rows[1];
    expect(run.status).toBe("PREVIEWED");
    expect(JSON.parse(run.analysisJson as string).section4).toEqual(["Decision A"]);
    // nothing changed in the register yet — preview only (rule 8)
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(2);
  });
});

describe("applyRun — freeze discipline", () => {
  it("replaces PENDING machine entries but preserves dispositioned entries byte-for-byte", async () => {
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
    expect(applied.ok && applied.value).toMatchObject({ added: 2, replaced: 1 });

    const rows = state.prisma.meetingRegisterEntry.rows;
    const confirmed = rows.find((r) => r.id === 1);
    expect(confirmed).toBeDefined(); // survived the rerun
    expect(confirmed).toMatchObject({
      reviewState: "CONFIRMED",
      normalizedText: "Decision A (confirmed wording)",
    });
    // the PENDING bridge was replaced by fresh projections
    expect(rows.filter((r) => r.reviewState === "PENDING")).toHaveLength(2);

    const run = state.prisma.meetingExtractionRun.rows[1];
    expect(run.status).toBe("APPLIED");
    expect(run.analysisJson).toBe("{}"); // bulky payload cleared
    expect(run.appliedBy).toBe("josh@example.com");
  });

  it("re-applies lifecycle rows through the analysis writer on apply", async () => {
    await recordAnalysisRun(1, 5, analysis, { actionItemIds: [101], commitmentIds: [], designChangeIds: [] }, ACTOR);
    const rerun = await recordAnalysisRun(1, 5, analysis, null, ACTOR);
    const runId = rerun.ok ? rerun.value.runId : -1;
    await applyRun(1, 5, runId, ACTOR);
    // writeMeetingAnalysisTx created a fresh AI action item row
    expect(state.prisma.meetingActionItem.rows.length).toBe(1);
    expect(state.prisma.meetingActionItem.rows[0]).toMatchObject({ description: "Do the thing" });
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
