import { describe, expect, it } from "vitest";
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
  const now = new Date(2026, 6, 10, 14, 30); // 2026-07-10 local

  it("is overdue for a past due date on an actionable item", () => {
    expect(isOverdue("2026-07-09T00:00:00.000Z", "OPEN", now)).toBe(true);
    expect(isOverdue("2026-01-01T00:00:00.000Z", "IN_PROGRESS", now)).toBe(true);
    expect(isOverdue("2026-07-01T00:00:00.000Z", "READY_TO_CLOSE", now)).toBe(true);
  });

  it("is never overdue for terminal statuses", () => {
    expect(isOverdue("2026-01-01T00:00:00.000Z", "CLOSED", now)).toBe(false);
    expect(isOverdue("2026-01-01T00:00:00.000Z", "WAIVED", now)).toBe(false);
  });

  it("is not overdue when due today or in the future", () => {
    expect(isOverdue(new Date(2026, 6, 10, 9, 0).toISOString(), "OPEN", now)).toBe(false);
    expect(isOverdue(new Date(2026, 6, 11).toISOString(), "OPEN", now)).toBe(false);
  });

  it("handles null and unparseable due dates", () => {
    expect(isOverdue(null, "OPEN", now)).toBe(false);
    expect(isOverdue("not-a-date", "OPEN", now)).toBe(false);
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
