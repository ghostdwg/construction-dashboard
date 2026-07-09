// Module OPS1 (Slice 1) — FSM unit coverage: the single status authority.
import { describe, expect, test } from "vitest";
import {
  TRACKED_ITEM_STATUSES,
  isTrackedItemKind,
  isTrackedItemStatus,
  validateTransition,
} from "../fsm";

describe("trackedItems FSM", () => {
  test("valid forward flow OPEN → IN_PROGRESS → READY_TO_CLOSE → CLOSED", () => {
    expect(validateTransition({ from: "OPEN", to: "IN_PROGRESS" }).ok).toBe(true);
    expect(validateTransition({ from: "IN_PROGRESS", to: "READY_TO_CLOSE" }).ok).toBe(true);
    const closed = validateTransition({
      from: "READY_TO_CLOSE",
      to: "CLOSED",
      actor: "josh@example.test",
    });
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.updates.status).toBe("CLOSED");
      expect(closed.updates.closedBy).toBe("josh@example.test");
      expect(closed.updates.closedAt).toBeInstanceOf(Date);
    }
  });

  test("honest backwards corrections among non-terminal states are allowed", () => {
    expect(validateTransition({ from: "IN_PROGRESS", to: "OPEN" }).ok).toBe(true);
    expect(validateTransition({ from: "READY_TO_CLOSE", to: "IN_PROGRESS" }).ok).toBe(true);
    expect(validateTransition({ from: "READY_TO_CLOSE", to: "OPEN" }).ok).toBe(true);
  });

  test("CLOSED without an actor is rejected", () => {
    const r = validateTransition({ from: "OPEN", to: "CLOSED" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/actor/i);
    const blank = validateTransition({ from: "OPEN", to: "CLOSED", actor: "   " });
    expect(blank.ok).toBe(false);
  });

  test("WAIVED without a reason is rejected; with reason records it", () => {
    const r = validateTransition({ from: "OPEN", to: "WAIVED" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reason/i);

    const ok = validateTransition({
      from: "IN_PROGRESS",
      to: "WAIVED",
      actor: "josh@example.test",
      waivedReason: "owner deleted this scope in ASI 4",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.updates.status).toBe("WAIVED");
      expect(ok.updates.waivedReason).toMatch(/ASI 4/);
      expect(ok.updates.closedAt).toBeInstanceOf(Date);
    }
  });

  test("terminal states reject every outbound transition (no silent reopen)", () => {
    for (const to of TRACKED_ITEM_STATUSES) {
      if (to !== "CLOSED") {
        expect(validateTransition({ from: "CLOSED", to, actor: "x" }).ok).toBe(false);
      }
      if (to !== "WAIVED") {
        expect(
          validateTransition({ from: "WAIVED", to, actor: "x", waivedReason: "r" }).ok
        ).toBe(false);
      }
    }
  });

  test("same-state and unknown statuses are rejected, never coerced", () => {
    expect(validateTransition({ from: "OPEN", to: "OPEN" }).ok).toBe(false);
    expect(
      validateTransition({ from: "DONE" as never, to: "CLOSED", actor: "x" }).ok
    ).toBe(false);
    expect(validateTransition({ from: "OPEN", to: "ARCHIVED" as never }).ok).toBe(false);
  });

  test("guards: kind and status validators are closed vocabularies", () => {
    expect(isTrackedItemKind("OAC_ACTION")).toBe(true);
    expect(isTrackedItemKind("PUNCH")).toBe(false);
    expect(isTrackedItemStatus("READY_TO_CLOSE")).toBe(true);
    expect(isTrackedItemStatus("ready_to_close")).toBe(false);
  });
});
