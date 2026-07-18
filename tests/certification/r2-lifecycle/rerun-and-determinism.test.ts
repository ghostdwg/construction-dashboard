// R2 Local Certification Harness — Rerun preservation and determinism
// scenarios 11-13, 20-22.
//
// These scenarios prove the harness's OWN determinism guarantee (required by
// the mission's VERIFICATION section: "two consecutive identical reruns,
// zero duplicate lifecycle records"), not a live database's. Each builder
// resets its id counters and uses a fixed clock, so two independent calls to
// the same builder must be structurally identical.
import { describe, expect, test } from "vitest";
import {
  buildRerunPreservationOfPromotedRecordsScenario,
  buildRerunPreservationOfHumanEditedRecordsScenario,
  buildRerunPreservationOfDispositionedRecordsScenario,
  buildDeterministicRerunNoDuplicateRowsScenario,
  buildTradeGroupingDeterminismScenario,
  buildResponseNumberingDeterminismScenario,
} from "@/tests/fixtures/r2-lifecycle/scenarioBuilders";

describe("Scenario 11 — Rerun preservation of promoted records [harness determinism]", () => {
  test("two independent builder runs assign identical ids to the promoted TrackedItem and package", () => {
    const { idsMatch, firstItemId, secondItemId } = buildRerunPreservationOfPromotedRecordsScenario();
    expect(idsMatch).toBe(true);
    expect(firstItemId).toBe(secondItemId);
  });
});

describe("Scenario 12 — Rerun preservation of human-edited records [harness determinism]", () => {
  test("a caller's mutation of a returned fixture object never leaks into the builder's own state or a subsequent rerun", () => {
    const { editedItemUnaffectedOriginal, rerunUnaffectedByEdit } = buildRerunPreservationOfHumanEditedRecordsScenario();
    expect(editedItemUnaffectedOriginal).toBe(true);
    expect(rerunUnaffectedByEdit).toBe(true);
  });
});

describe("Scenario 13 — Rerun preservation of dispositioned records [FIXTURE_SIMULATED compile idempotency]", () => {
  test("recompiling after a disposition with an unchanged manifest reuses the existing revision, adding nothing", () => {
    const { dispositionCountBefore, dispositionCountAfter, recompileReused } = buildRerunPreservationOfDispositionedRecordsScenario();
    expect(recompileReused).toBe(true);
    expect(dispositionCountAfter).toBe(dispositionCountBefore);
  });
});

describe("Scenario 20 — Deterministic rerun creates no duplicate lifecycle rows [harness determinism]", () => {
  test("two full lifecycle runs produce structurally identical snapshots (ids, transmittal numbers, audit log length)", () => {
    const { firstSnapshot, secondSnapshot } = buildDeterministicRerunNoDuplicateRowsScenario();
    expect(secondSnapshot.item.id).toBe(firstSnapshot.item.id);
    expect(secondSnapshot.transmittal.transmittalNumber).toBe(firstSnapshot.transmittal.transmittalNumber);
    expect(secondSnapshot.disposition.disposition).toBe(firstSnapshot.disposition.disposition);
    expect(secondSnapshot.auditLog).toHaveLength(firstSnapshot.auditLog.length);
    expect(firstSnapshot.auditLog.length).toBeGreaterThan(0);
  });
});

describe("Scenario 21 — Trade grouping remains deterministic [IMPLEMENTED: groupByTrade]", () => {
  test("group order and membership are identical regardless of input array order", () => {
    const { tradeNamesFirst, tradeNamesSecond, firstPass, secondPass } = buildTradeGroupingDeterminismScenario();
    expect(tradeNamesSecond).toEqual(tradeNamesFirst);
    expect(secondPass.map((g) => g.items.length)).toEqual(firstPass.map((g) => g.items.length));
    // Unassigned always sorts last (groupByTrade contract).
    expect(tradeNamesFirst[tradeNamesFirst.length - 1]).toBe("Unassigned");
  });
});

describe("Scenario 22 — Response numbering remains deterministic [IMPLEMENTED: assignDisplayNumbers]", () => {
  test("display numbers are assigned by createdAt regardless of input array order", () => {
    const { firstPass, secondPass } = buildResponseNumberingDeterminismScenario();
    expect(secondPass).toEqual(firstPass);
    expect(firstPass).toEqual([1, 2, 3]);
  });
});
