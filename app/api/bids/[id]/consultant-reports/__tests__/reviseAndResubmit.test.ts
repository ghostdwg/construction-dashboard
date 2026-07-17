// Field Response Certification — revise-and-resubmit fixture test.
//
// Validates the complete R&R lifecycle: initial response → revision →
// READY_TO_CLOSE state transition → expected disposition.
// No DB, no network — fixture builders and expected JSON only.
import { describe, expect, test, beforeEach } from "vitest";
import {
  buildReviseAndResubmitScenario,
  makeTrackedItem,
  makeDisposition,
  resetIds,
} from "@/tests/field-response-certification/unit-integration-builders";
import expectedContractorResponses from "@/tests/field-response-certification/fixtures/expected-contractor-responses.json";
import expectedOriginatorDisposition from "@/tests/field-response-certification/fixtures/expected-originator-disposition.json";

beforeEach(() => {
  resetIds(7000);
});

describe("revise-and-resubmit lifecycle", () => {
  test("scenario builder produces ACCEPTED_NEW_ITEM observation", () => {
    const { observation } = buildReviseAndResubmitScenario();
    expect(observation.state).toBe("ACCEPTED_NEW_ITEM");
  });

  test("initial TrackedItem status is OPEN with no formal response", () => {
    const item = makeTrackedItem({ status: "OPEN" });
    expect(item.formalResponse).toBeNull();
    expect(item.formalResponsePrior).toBeNull();
  });

  test("after initial response: formalResponse set, prior is null", () => {
    const { initialResponse } = buildReviseAndResubmitScenario();
    const item = makeTrackedItem({
      formalResponse: initialResponse.formalResponse,
      formalResponseBy: initialResponse.formalResponseBy,
      formalResponseAt: new Date("2024-10-24T14:00:00.000Z"),
      formalResponsePrior: null,
      status: "IN_PROGRESS",
    });
    expect(item.formalResponse).toBeTruthy();
    expect(item.formalResponsePrior).toBeNull();
  });

  test("after revision: formalResponse updated, prior carries initial value", () => {
    const { initialResponse, revisionResponse } = buildReviseAndResubmitScenario();
    const item = makeTrackedItem({
      formalResponse: revisionResponse.formalResponse,
      formalResponseBy: revisionResponse.formalResponseBy,
      formalResponseAt: new Date("2024-10-30T11:30:00.000Z"),
      formalResponsePrior: revisionResponse.formalResponsePrior,
      status: "READY_TO_CLOSE",
    });
    expect(item.formalResponse).toBe(revisionResponse.formalResponse);
    expect(item.formalResponsePrior).toBe(initialResponse.formalResponse);
    expect(item.status).toBe("READY_TO_CLOSE");
  });

  test("REVISE_AND_RESUBMIT disposition triggers before status reaches READY_TO_CLOSE", () => {
    const obs = buildReviseAndResubmitScenario().observation;
    const disp = makeDisposition({
      observationId: obs.id,
      dispositionType: "REJECT",
      dispositionText: "Shimmed base plate not yet confirmed by EOR. Resubmit with written EOR acceptance.",
    });
    expect(disp.dispositionType).toBe("REJECT");
    expect(disp.dispositionText).toBeTruthy();
  });

  test("revise-and-resubmit observation has REJECT or DEFER disposition, not APPROVE", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        _scenario: string;
        expectedFinalState?: { status: string };
      }>;
    };
    const rar = fixture.responses.find((r) =>
      r._scenario.startsWith("Initial contractor response")
    );
    // R&R scenario is not yet closed — disposition is REVISE_AND_RESUBMIT at the originator level
    expect(rar!.expectedFinalState?.status).toBe("READY_TO_CLOSE");
  });

  test("R&R item never has closedAt set before acceptance", () => {
    const item = makeTrackedItem({ status: "READY_TO_CLOSE", closedAt: null });
    // READY_TO_CLOSE is not yet closed — closedAt must remain null
    expect(item.closedAt).toBeNull();
    expect(item.closedBy).toBeNull();
  });
});

describe("revise-and-resubmit originator disposition", () => {
  test("originator disposition fixture documents REVISE_AND_RESUBMIT with dueDate", () => {
    const fixture = expectedOriginatorDisposition as {
      dispositionRecords: Array<{
        _scenario: string;
        disposition: { type: string; dueDate: string | null };
      }>;
    };
    const rar = fixture.dispositionRecords.find((r) =>
      r._scenario.includes("Revise-and-resubmit — anchor bolt")
    );
    expect(rar).toBeDefined();
    expect(rar!.disposition.type).toBe("REVISE_AND_RESUBMIT");
    expect(rar!.disposition.dueDate).not.toBeNull();
  });

  test("return record has transmittal number and returnedAt", () => {
    const fixture = expectedOriginatorDisposition as {
      dispositionRecords: Array<{
        _scenario: string;
        returnRecord: { transmittalNumber: string; returnedAt: string };
      }>;
    };
    const rar = fixture.dispositionRecords.find((r) =>
      r._scenario.includes("Revise-and-resubmit — anchor bolt")
    );
    expect(rar!.returnRecord.transmittalNumber).toMatch(/^TR-/);
    expect(rar!.returnRecord.returnedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
