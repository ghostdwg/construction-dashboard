// R2 release-blocker remediation — non-destructive §5 action-item
// reconciliation in writeMeetingAnalysisTx. The pre-remediation writer deleted
// EVERY AI-origin action item on each analysis/rerun, destroying human
// lifecycle (CLOSED/DEFERRED dispositions, notes, raised priority, and — worst
// — promotions into the Operations Register, whose FK would be SetNull'd).
//
// These tests prove: only PRISTINE machine proposals are replaced; every
// human-touched or promoted row is preserved byte-for-byte; a re-extracted
// item is reused (never duplicated); manual items are never touched; behavior
// stays deterministic/idempotent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));

import type { AnalysisActionItem, MeetingAnalysis } from "@/lib/meeting-analysis";
import { writeMeetingAnalysis } from "@/lib/meeting-analysis";

const ai = (task: string, over: Partial<AnalysisActionItem> = {}): AnalysisActionItem => ({
  person: "Mike",
  task,
  dueDate: null,
  isGcTask: false,
  carriedFromDate: null,
  evidenceText: `evidence for ${task}`,
  ...over,
});

const analysisWith = (section5: AnalysisActionItem[]): MeetingAnalysis => ({
  section1: { date: "2026-07-01", projectName: "Job", durationMinutes: 30 },
  section2: [],
  section3: "Overview",
  section4: [],
  section5,
  section6: [],
  section7: [],
  section8: [],
  section9: [],
  section10: [],
});

/** Seed a MeetingActionItem row with explicit id and full lifecycle fields. */
function seedItem(over: Record<string, unknown>) {
  state.prisma.meetingActionItem.rows.push({
    meetingId: 5,
    bidId: 1,
    source: "meeting",
    priority: "MEDIUM",
    status: "OPEN",
    closedAt: null,
    notes: null,
    sourceText: "seed evidence",
    ...over,
  });
}

const item = (id: number) => state.prisma.meetingActionItem.rows.find((r) => r.id === id);
const byDesc = (d: string) =>
  state.prisma.meetingActionItem.rows.filter((r) => r.description === d);

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({
    data: { id: 5, bidId: 1, analysisVersion: 1, keyDecisions: "[]", openIssues: "[]", redFlags: "[]" },
  });
});

describe("writeMeetingAnalysis — non-destructive action-item reconcile", () => {
  it("replaces only pristine machine proposals; preserves disposed/annotated/manual rows", async () => {
    seedItem({ id: 101, description: "Pristine open task", status: "OPEN" }); // replaceable
    seedItem({ id: 102, description: "Closed task", status: "CLOSED", closedAt: new Date("2026-07-02") });
    seedItem({ id: 103, description: "Deferred task", status: "DEFERRED" });
    seedItem({ id: 104, description: "Annotated task", status: "OPEN", notes: "call the sub first" });
    seedItem({ id: 105, description: "Raised task", status: "OPEN", priority: "HIGH" });
    seedItem({ id: 106, description: "Manual task", source: "manual", sourceText: null });

    // The rerun re-extracts the disposed items plus a brand-new one; it no
    // longer produces "Pristine open task".
    const result = await writeMeetingAnalysis(
      5,
      1,
      analysisWith([ai("Closed task"), ai("Deferred task"), ai("Brand new task")])
    );

    // Pristine, un-re-extracted proposal is the ONLY row removed.
    expect(item(101)).toBeUndefined();
    // Every human-touched / manual row survived with its lifecycle intact.
    expect(item(102)).toMatchObject({ status: "CLOSED" });
    expect(item(103)).toMatchObject({ status: "DEFERRED" });
    expect(item(104)).toMatchObject({ status: "OPEN", notes: "call the sub first" });
    expect(item(105)).toMatchObject({ priority: "HIGH" });
    expect(item(106)).toMatchObject({ source: "manual" });

    // Re-extracted disposed items were REUSED, not duplicated.
    expect(byDesc("Closed task")).toHaveLength(1);
    expect(byDesc("Deferred task")).toHaveLength(1);
    // Exactly one fresh OPEN row for the genuinely new task.
    expect(byDesc("Brand new task")).toHaveLength(1);
    expect(byDesc("Brand new task")[0]).toMatchObject({ status: "OPEN", source: "meeting" });

    // The writer reports ids in §5 order, reusing preserved ids where matched.
    expect(result.actionItemIds).toEqual([102, 103, byDesc("Brand new task")[0].id]);
  });

  it("preserves an OPEN item a human edited (updatedAt bumped) even without a disposition", async () => {
    // Human edited the wording/due date via the action-item PATCH route: still
    // OPEN, MEDIUM, no notes — but updatedAt is now well after createdAt.
    seedItem({
      id: 400,
      description: "Human-edited wording",
      status: "OPEN",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T02:00:00Z"),
    });

    // The rerun re-extracts the AI's (different) wording for the same topic.
    const result = await writeMeetingAnalysis(5, 1, analysisWith([ai("AI re-extracted wording")]));

    expect(item(400)).toMatchObject({ description: "Human-edited wording" }); // survived
    expect(byDesc("AI re-extracted wording")).toHaveLength(1); // new row, edit not clobbered
    expect(result.actionItemIds).toEqual([byDesc("AI re-extracted wording")[0].id]);
  });

  it("never orphans a promoted action item (Operations Register FK preserved)", async () => {
    seedItem({ id: 200, description: "Promote me", status: "OPEN" });
    // Simulate the promotion: a TrackedItem points at the action item.
    await state.prisma.trackedItem.create({
      data: { id: 900, bidId: 1, kind: "OAC_ACTION", title: "Promote me", sourceMeetingActionItemId: 200 },
    });

    // Even though the row is otherwise "pristine" (OPEN/MEDIUM/no notes), the
    // promotion makes it human-touched — it must survive and not duplicate.
    const result = await writeMeetingAnalysis(5, 1, analysisWith([ai("Promote me")]));

    expect(item(200)).toBeDefined(); // NOT deleted
    expect(byDesc("Promote me")).toHaveLength(1); // reused, not duplicated
    expect(result.actionItemIds).toEqual([200]);
    // Promotion FK still resolves to the original action item.
    expect(state.prisma.trackedItem.rows[0].sourceMeetingActionItemId).toBe(200);
  });

  it("is deterministic/idempotent: repeated identical writes keep disposed rows and one live set", async () => {
    seedItem({ id: 300, description: "Closed task", status: "CLOSED", closedAt: new Date("2026-07-02") });

    for (let i = 0; i < 3; i++) {
      const result = await writeMeetingAnalysis(
        5,
        1,
        analysisWith([ai("Closed task"), ai("Live task")])
      );
      // Disposed row always reused; exactly one live row for the fresh task.
      expect(result.actionItemIds[0]).toBe(300);
      expect(byDesc("Closed task")).toHaveLength(1);
      expect(byDesc("Live task")).toHaveLength(1);
    }
    expect(item(300)).toMatchObject({ status: "CLOSED" });
  });
});
