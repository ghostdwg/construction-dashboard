// R2 Local Certification Harness — Disposition outcome scenarios 1-6.
//
// CAPABILITY LABELS:
//   - TrackedItem / formalResponse / dispositions up to READY_TO_TRANSMIT
//     equivalent: IMPLEMENTED (real fixture shapes from
//     unit-integration-builders.ts) — see docs/r2/R2-LIFECYCLE-CAPABILITY-MATRIX.md
//   - ResponsePackage/CompiledResponse/Transmittal/OriginatorDisposition:
//     FIXTURE_SIMULATED via responsePackageSimulator.ts (no such schema
//     exists on this branch). See that file's header before trusting any
//     assertion here as production proof.
import { describe, expect, test } from "vitest";
import {
  buildStandardAcceptedResponseScenario,
  buildAcceptedWithCommentsScenario,
  buildReviseAndResubmitLifecycleScenario,
  buildRejectedResponseScenario,
  buildFieldVerificationRequiredScenario,
  buildInformationalDispositionScenario,
} from "@/tests/fixtures/r2-lifecycle/scenarioBuilders";

describe("Scenario 1 — Standard accepted response [FIXTURE_SIMULATED]", () => {
  test("package reaches ACCEPTED via a single ACCEPTED disposition on the latest transmittal", () => {
    const { pkg, disposition, transmittal } = buildStandardAcceptedResponseScenario();
    expect(pkg.status).toBe("ACCEPTED");
    expect(disposition.disposition).toBe("ACCEPTED");
    expect(disposition.transmittalId).toBe(transmittal.id);
    expect(disposition.packageItemId).toBeNull();
  });
});

describe("Scenario 2 — Accepted with comments [FIXTURE_SIMULATED]", () => {
  test("ACCEPTED_WITH_COMMENTS requires dispositionText and is closure-eligible like ACCEPTED", () => {
    const { pkg, disposition } = buildAcceptedWithCommentsScenario();
    expect(pkg.status).toBe("ACCEPTED");
    expect(disposition.disposition).toBe("ACCEPTED_WITH_COMMENTS");
    expect(disposition.dispositionText).toBeTruthy();
  });

  test("ACCEPTED_WITH_COMMENTS without text is rejected (contract §9.1)", () => {
    const { sim, transmittal } = buildAcceptedWithCommentsScenario();
    expect(() =>
      sim.recordDisposition(
        transmittal.id,
        { disposition: "ACCEPTED_WITH_COMMENTS", disposedByName: "alice@example.test", recordedBy: "gc.pm@example.test" },
        9
      )
    ).toThrow(/requires dispositionText/);
  });
});

describe("Scenario 3 — Revise and resubmit [FIXTURE_SIMULATED + IMPLEMENTED underlying TrackedItem]", () => {
  test("REVISE_AND_RESUBMIT reopens the cycle, produces a new compiled/transmittal pair, and ends ACCEPTED", () => {
    const { pkg, legacy, firstTransmittal, secondTransmittal, finalDisposition } = buildReviseAndResubmitLifecycleScenario();
    expect(pkg.status).toBe("ACCEPTED");
    expect(pkg.reviewCycle).toBe(1);
    expect(secondTransmittal.id).not.toBe(firstTransmittal.id);
    expect(secondTransmittal.transmittalNumber).toBeGreaterThan(firstTransmittal.transmittalNumber);
    expect(finalDisposition.disposition).toBe("ACCEPTED");
    // Underlying TrackedItem shape is the reused, IMPLEMENTED Build 2 fixture.
    expect(legacy.revisionResponse.formalResponsePrior).toBe(legacy.initialResponse.formalResponse);
  });
});

describe("Scenario 4 — Rejected response [FIXTURE_SIMULATED]", () => {
  test("REJECTED requires dispositionText and moves the package to REVISE_AND_RESUBMIT", () => {
    const { pkg, disposition } = buildRejectedResponseScenario();
    expect(pkg.status).toBe("REVISE_AND_RESUBMIT");
    expect(disposition.disposition).toBe("REJECTED");
    expect(disposition.dispositionText).toBeTruthy();
  });
});

describe("Scenario 5 — Field verification required [FIXTURE_SIMULATED]", () => {
  test("FIELD_VERIFICATION_REQUIRED reopens to GC_REVIEW without requiring contractor input", () => {
    const { pkg, disposition } = buildFieldVerificationRequiredScenario();
    expect(disposition.disposition).toBe("FIELD_VERIFICATION_REQUIRED");
    expect(pkg.status).toBe("GC_REVIEW");
    expect(pkg.reviewCycle).toBe(1);
  });
});

describe("Scenario 6 — Informational disposition [FIXTURE_SIMULATED]", () => {
  test("INFORMATIONAL is recorded but never changes package status (contract §3.4)", () => {
    const { statusBefore, statusAfter, disposition } = buildInformationalDispositionScenario();
    expect(disposition.disposition).toBe("INFORMATIONAL");
    expect(statusAfter).toBe(statusBefore);
    expect(statusAfter).toBe("TRANSMITTED");
  });
});
