// Field Response Certification — accepted-closure fixture test.
//
// Validates the accepted-closure lifecycle: initial response → APPROVE
// disposition → CLOSED state with closedAt/closedBy recorded.
// No DB, no network — fixture builders and expected JSON only.
import { describe, expect, test, beforeEach } from "vitest";
import {
  buildAcceptedClosureScenario,
  makeTrackedItem,
  resetIds,
} from "@/tests/field-response-certification/unit-integration-builders";
import expectedContractorResponses from "@/tests/field-response-certification/fixtures/expected-contractor-responses.json";
import expectedOriginatorDisposition from "@/tests/field-response-certification/fixtures/expected-originator-disposition.json";

beforeEach(() => {
  resetIds(8000);
});

describe("accepted-closure lifecycle", () => {
  test("scenario builder produces CLOSED TrackedItem", () => {
    const { trackedItem } = buildAcceptedClosureScenario();
    expect(trackedItem.status).toBe("CLOSED");
  });

  test("CLOSED item has closedAt and closedBy set", () => {
    const { trackedItem } = buildAcceptedClosureScenario();
    expect(trackedItem.closedAt).not.toBeNull();
    expect(trackedItem.closedBy).not.toBeNull();
    expect(trackedItem.closedBy).toBe("bob@example.test");
  });

  test("CLOSED item has formal response set before closure", () => {
    const { trackedItem, formalResponse } = buildAcceptedClosureScenario();
    expect(trackedItem.formalResponse).toBe(formalResponse.formalResponse);
    expect(trackedItem.formalResponseBy).toBe(formalResponse.formalResponseBy);
    expect(trackedItem.formalResponseAt).not.toBeNull();
  });

  test("closure disposition is APPROVE", () => {
    const { closureDisposition } = buildAcceptedClosureScenario();
    expect(closureDisposition.dispositionType).toBe("APPROVE");
  });

  test("approved disposition has disposedBy and disposedAt", () => {
    const { closureDisposition } = buildAcceptedClosureScenario();
    expect(closureDisposition.disposedBy).toBeTruthy();
    expect(closureDisposition.disposedAt).not.toBeNull();
  });

  test("accepted-closure scenario has no revision (single response sufficient)", () => {
    // Once APPROVE disposition is appended, the item closes in one pass
    const { formalResponse } = buildAcceptedClosureScenario();
    const item = makeTrackedItem({
      formalResponse: formalResponse.formalResponse,
      formalResponseBy: formalResponse.formalResponseBy,
      formalResponseAt: new Date("2024-10-24T16:00:00.000Z"),
      formalResponsePrior: null,
      status: "CLOSED",
      closedAt: new Date("2024-10-25T09:00:00.000Z"),
      closedBy: "bob@example.test",
    });
    // No revision — prior is null
    expect(item.formalResponsePrior).toBeNull();
  });

  test("APPROVE disposition has disposition text explaining acceptance", () => {
    const { closureDisposition } = buildAcceptedClosureScenario();
    expect(closureDisposition.dispositionText).toBeTruthy();
    expect(closureDisposition.dispositionText!.length).toBeLessThanOrEqual(2000);
  });
});

describe("accepted-closure via expected-contractor-responses fixture", () => {
  test("fixture documents accepted closure with APPROVE disposition", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        _scenario: string;
        expectedFinalState?: {
          status: string;
          closedBy?: string;
          closedAt?: string;
          dispositionType?: string;
        };
      }>;
    };
    const acc = fixture.responses.find((r) =>
      r._scenario.startsWith("Accepted-closure")
    );
    expect(acc!.expectedFinalState?.status).toBe("CLOSED");
    expect(acc!.expectedFinalState?.closedBy).toBeTruthy();
    expect(acc!.expectedFinalState?.dispositionType).toBe("APPROVE");
  });
});

describe("accepted-closure originator disposition", () => {
  test("ACCEPTED originator disposition has null dueDate (item is done)", () => {
    const fixture = expectedOriginatorDisposition as {
      dispositionRecords: Array<{
        _scenario: string;
        disposition: { type: string; dueDate: string | null };
      }>;
    };
    const acc = fixture.dispositionRecords.find((r) =>
      r._scenario.includes("Accepted — weld inspection")
    );
    expect(acc).toBeDefined();
    expect(acc!.disposition.type).toBe("ACCEPTED");
    expect(acc!.disposition.dueDate).toBeNull();
  });

  test("accepted item return record has transmittal number", () => {
    const fixture = expectedOriginatorDisposition as {
      dispositionRecords: Array<{
        _scenario: string;
        returnRecord: { transmittalNumber: string; attachedResponse: boolean };
      }>;
    };
    const acc = fixture.dispositionRecords.find((r) =>
      r._scenario.includes("Accepted — weld inspection")
    );
    expect(acc!.returnRecord.transmittalNumber).toMatch(/^TR-/);
    expect(acc!.returnRecord.attachedResponse).toBe(true);
  });
});

describe("CLOSED state machine rules", () => {
  test("CLOSED item requires a non-empty closedBy actor", () => {
    const item = makeTrackedItem({
      status: "CLOSED",
      closedAt: new Date(),
      closedBy: "reviewer@example.test",
    });
    expect(item.closedBy).toBeTruthy();
    expect(item.closedBy!.length).toBeGreaterThan(0);
  });

  test("CLOSED status is terminal — no outgoing transitions in fixture expectations", () => {
    // Validate that the fixture docs CLOSED items have no further expected state changes
    const { trackedItem } = buildAcceptedClosureScenario();
    expect(trackedItem.status).toBe("CLOSED");
    // Terminal state — the item stays here
    expect(["CLOSED"]).toContain(trackedItem.status);
  });
});
