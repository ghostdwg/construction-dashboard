import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  actionItemOptionLabel,
  isOverdue,
  promotedActionItemIds,
  statusCounts,
} from "../registerViewHelpers";

describe("statusCounts", () => {
  it("counts per status in canonical chip order", () => {
    const items = [
      { status: "CLOSED" },
      { status: "OPEN" },
      { status: "OPEN" },
      { status: "READY_TO_CLOSE" },
      { status: "OPEN" },
    ];
    expect(statusCounts(items)).toEqual([
      { status: "OPEN", count: 3 },
      { status: "READY_TO_CLOSE", count: 1 },
      { status: "CLOSED", count: 1 },
    ]);
  });

  it("returns empty for no items", () => {
    expect(statusCounts([])).toEqual([]);
  });

  it("appends unknown statuses after known ones, sorted", () => {
    const result = statusCounts([
      { status: "ZEBRA" },
      { status: "OPEN" },
      { status: "AARDVARK" },
    ]);
    expect(result).toEqual([
      { status: "OPEN", count: 1 },
      { status: "AARDVARK", count: 1 },
      { status: "ZEBRA", count: 1 },
    ]);
  });
});

describe("isOverdue", () => {
  // Due dates use the app's storage convention: UTC-midnight ISO strings
  // (CreateItemForm serializes `new Date("YYYY-MM-DD").toISOString()`).
  const now = new Date(2026, 6, 10, 14, 30); // 2026-07-10 local wall clock

  it("due yesterday is overdue (all actionable statuses)", () => {
    expect(isOverdue("2026-07-09T00:00:00.000Z", "OPEN", now)).toBe(true);
    expect(isOverdue("2026-01-01T00:00:00.000Z", "IN_PROGRESS", now)).toBe(true);
    expect(isOverdue("2026-07-01T00:00:00.000Z", "READY_TO_CLOSE", now)).toBe(true);
  });

  it("due today is not overdue", () => {
    expect(isOverdue("2026-07-10T00:00:00.000Z", "OPEN", now)).toBe(false);
  });

  it("due tomorrow is not overdue", () => {
    expect(isOverdue("2026-07-11T00:00:00.000Z", "OPEN", now)).toBe(false);
  });

  it("CLOSED due yesterday is not overdue", () => {
    expect(isOverdue("2026-07-09T00:00:00.000Z", "CLOSED", now)).toBe(false);
  });

  it("WAIVED due yesterday is not overdue", () => {
    expect(isOverdue("2026-07-09T00:00:00.000Z", "WAIVED", now)).toBe(false);
  });

  it("handles null and unparseable due dates", () => {
    expect(isOverdue(null, "OPEN", now)).toBe(false);
    expect(isOverdue("not-a-date", "OPEN", now)).toBe(false);
  });

  describe("in a negative-UTC-offset runtime (America/New_York)", () => {
    // Node ≥13 re-reads process.env.TZ, so local-Date behavior inside this
    // block is genuinely UTC-4/-5. Restored afterAll so no other test in
    // this worker inherits it.
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = "America/New_York";
    });
    afterAll(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it("a UTC-midnight due date for today does not become overdue a day early", () => {
      // Local NY morning of the due day. Under the old instant-vs-local-
      // midnight comparison, 2026-07-10T00:00Z < NY midnight (04:00Z) made
      // this falsely overdue.
      const nyNow = new Date(2026, 6, 10, 0, 30);
      expect(isOverdue("2026-07-10T00:00:00.000Z", "OPEN", nyNow)).toBe(false);
    });

    it("due yesterday is still overdue and terminal statuses still exempt", () => {
      const nyNow = new Date(2026, 6, 10, 0, 30);
      expect(isOverdue("2026-07-09T00:00:00.000Z", "OPEN", nyNow)).toBe(true);
      expect(isOverdue("2026-07-09T00:00:00.000Z", "CLOSED", nyNow)).toBe(false);
      expect(isOverdue("2026-07-09T00:00:00.000Z", "WAIVED", nyNow)).toBe(false);
    });

    it("due tomorrow is not overdue", () => {
      const nyNow = new Date(2026, 6, 10, 23, 30);
      expect(isOverdue("2026-07-11T00:00:00.000Z", "OPEN", nyNow)).toBe(false);
    });
  });
});

describe("promotedActionItemIds", () => {
  it("collects only non-null source action item ids", () => {
    const ids = promotedActionItemIds([
      { sourceMeetingActionItemId: 7 },
      { sourceMeetingActionItemId: null },
      { sourceMeetingActionItemId: 12 },
      { sourceMeetingActionItemId: 7 },
    ]);
    expect(ids).toEqual(new Set([7, 12]));
  });

  it("is empty for no items", () => {
    expect(promotedActionItemIds([]).size).toBe(0);
  });
});

describe("actionItemOptionLabel", () => {
  it("formats id, meeting, and description", () => {
    expect(
      actionItemOptionLabel({
        id: 4,
        meetingTitle: "OAC #3",
        description: "Confirm door hardware submittal",
        alreadyTracked: false,
      })
    ).toBe("#4 · OAC #3 — Confirm door hardware submittal");
  });

  it("appends the already-tracked annotation", () => {
    expect(
      actionItemOptionLabel({
        id: 4,
        meetingTitle: "OAC #3",
        description: "Confirm door hardware submittal",
        alreadyTracked: true,
      })
    ).toMatch(/ · already tracked$/);
  });

  it("truncates long descriptions with an ellipsis", () => {
    const label = actionItemOptionLabel({
      id: 1,
      meetingTitle: "M",
      description: "x".repeat(80),
      alreadyTracked: false,
    });
    expect(label).toContain("…");
    expect(label).toContain("x".repeat(57));
    expect(label).not.toContain("x".repeat(58));
  });
});
