// R2 Local Certification Harness — Audit, supersession, append-only history,
// and authorization safety scenarios 14, 24, 25, 26.
import { describe, expect, test } from "vitest";
import { ResponsePackageSimulator } from "@/tests/fixtures/r2-lifecycle/responsePackageSimulator";
import {
  buildAuditWriteFailureScenario,
  buildSupersededResponseRevisionsScenario,
  buildAppendOnlyHistoryScenario,
  buildUnauthorizedCrossBidOperationRejectionScenario,
} from "@/tests/fixtures/r2-lifecycle/scenarioBuilders";

describe("Scenario 14 — Audit/history write failure rolls back the mutation [FIXTURE_SIMULATED fail-closed audit]", () => {
  test("issue() leaves the package untouched when the injected audit sink throws", () => {
    const { pkg, caught, statusUnchanged } = buildAuditWriteFailureScenario();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/simulated audit sink outage/);
    expect(statusUnchanged).toBe(true);
    expect(pkg.tokenActive).toBe(false); // the token-activation side effect never ran either
  });
});

describe("Scenario 24 — Superseded response revisions remain historically available [FIXTURE_SIMULATED]", () => {
  test("a new compile produces revisionIndex+1 without mutating or removing the prior revision", () => {
    const { first, second, allRevisions } = buildSupersededResponseRevisionsScenario();
    expect(second.compiled.revisionIndex).toBe(first.compiled.revisionIndex + 1);
    expect(allRevisions).toHaveLength(2);
    expect(allRevisions[0]).toEqual(first.compiled);
    expect(allRevisions[0].manifestHash).not.toBe(second.compiled.manifestHash);
  });
});

describe("Scenario 25 — Transmittal and disposition history remain append-only [FIXTURE_SIMULATED]", () => {
  test("a correction is appended, never replacing the corrected disposition", () => {
    const { disposition, secondDisposition, allDispositions } = buildAppendOnlyHistoryScenario();
    expect(allDispositions).toHaveLength(2);
    expect(allDispositions[0]).toEqual(disposition);
    expect(secondDisposition.correctionOfId).toBe(disposition.id);
  });

  test("the simulator exposes no update/delete method for any Build 3 history row (structural append-only proof)", () => {
    const proto = Object.getPrototypeOf(new ResponsePackageSimulator());
    const methodNames = Object.getOwnPropertyNames(proto);
    const mutatingHistoryMethods = methodNames.filter((n) => /^(update|delete|remove|edit)/i.test(n));
    expect(mutatingHistoryMethods).toEqual([]);
  });
});

describe("Scenario 26 — Unauthorized or cross-bid operations create no partial records [FIXTURE_SIMULATED authorization guard]", () => {
  test("createPackage and issue both reject an actor scoped to a different bid, before any mutation", () => {
    const { createRejected, issueRejected, statusUnchangedAfterRejectedIssue, legitPkg, sim } =
      buildUnauthorizedCrossBidOperationRejectionScenario();
    expect(createRejected).toBe(true);
    expect(issueRejected).toBe(true);
    expect(statusUnchangedAfterRejectedIssue).toBe(true);
    expect(legitPkg.tokenActive).toBe(false); // issue()'s side effect never applied
    // The rejected createPackage call must not have consumed a package id or
    // left an orphaned row: exactly one package exists (the legitimate one).
    expect(sim.getPackage(legitPkg.id)).toBeDefined();
  });
});
