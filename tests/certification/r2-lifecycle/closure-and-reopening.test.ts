// R2 Local Certification Harness — Closure and reopening scenarios 15-19.
// All FIXTURE_SIMULATED via responsePackageSimulator.ts — no ResponsePackage
// closure schema exists on this branch. See that file's header.
import { describe, expect, test } from "vitest";
import {
  buildClosureDeniedUnresolvedResponsesScenario,
  buildClosureDeniedBeforeOriginatorDispositionScenario,
  buildClosureDeniedWhileDisputedOrBlockedScenario,
  buildClosureAllowedAfterEveryGateScenario,
  buildReopenedRetainsPriorClosureHistoryScenario,
} from "@/tests/fixtures/r2-lifecycle/scenarioBuilders";

describe("Scenario 15 — Closure denied while required responses remain unresolved", () => {
  test("close() is rejected while the package is still ISSUED (no contractor response recorded)", () => {
    const { pkg, isTransitionError } = buildClosureDeniedUnresolvedResponsesScenario();
    expect(isTransitionError).toBe(true);
    expect(pkg.status).toBe("ISSUED");
  });
});

describe("Scenario 16 — Closure denied before required originator disposition", () => {
  test("close() is rejected when the package is TRANSMITTED but no disposition has ever been recorded", () => {
    const { pkg, isTransitionError } = buildClosureDeniedBeforeOriginatorDispositionScenario();
    expect(isTransitionError).toBe(true);
    expect(pkg.status).toBe("TRANSMITTED");
  });
});

describe("Scenario 17 — Closure denied while package is disputed or blocked", () => {
  test("close() is rejected while holdState is DISPUTED, even with an ACCEPTED disposition on file", () => {
    const { pkg, isTransitionError } = buildClosureDeniedWhileDisputedOrBlockedScenario();
    expect(isTransitionError).toBe(true);
    expect(pkg.status).toBe("ACCEPTED"); // loop position preserved through the hold (contract §3.3)
    expect(pkg.holdState).toBe("DISPUTED");
  });
});

describe("Scenario 18 — Closure allowed after every required gate is satisfied", () => {
  test("close() succeeds from ACCEPTED with an ACCEPTED-class disposition and no hold", () => {
    const { pkg, closureRecord } = buildClosureAllowedAfterEveryGateScenario();
    expect(pkg.status).toBe("CLOSED");
    expect(closureRecord.action).toBe("CLOSED");
    expect(closureRecord.itemStatusSnapshot).toHaveLength(1);
  });
});

describe("Scenario 19 — Reopened item retains its prior immutable closure history", () => {
  test("reopen() appends a REOPENED record; the original CLOSED record is untouched", () => {
    const { pkg, originalClosureRecord, reopenRecord, historyAfterReopen } = buildReopenedRetainsPriorClosureHistoryScenario();
    expect(pkg.status).toBe("REOPENED");
    expect(historyAfterReopen).toHaveLength(2);
    const preservedClosed = historyAfterReopen.find((r) => r.action === "CLOSED");
    expect(preservedClosed).toEqual(originalClosureRecord);
    expect(reopenRecord.action).toBe("REOPENED");
    expect(reopenRecord.reason).toBeTruthy();
  });
});
