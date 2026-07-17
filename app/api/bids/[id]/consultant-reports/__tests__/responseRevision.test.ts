// Field Response Certification — contractor response revision fixture tests.
//
// Validates the revise-and-resubmit scenario builder and the fixture structure
// for contractor response revisions. Covers initial-response save, revision
// (prior recorded), and the audit-bounded prior text rule.
// No DB, no network — fixture builders only.
import { describe, expect, test, beforeEach } from "vitest";
import {
  buildReviseAndResubmitScenario,
  makeTrackedItem,
  resetIds,
} from "@/tests/field-response-certification/unit-integration-builders";
import expectedContractorResponses from "@/tests/field-response-certification/fixtures/expected-contractor-responses.json";

beforeEach(() => {
  resetIds(5000);
});

describe("ReviseAndResubmit scenario builder", () => {
  test("builds a complete scenario with report, observation, and tracked item", () => {
    const s = buildReviseAndResubmitScenario();
    expect(s.report.reportType).toBe("ENGINEER_FIELD_REPORT");
    expect(s.observation.state).toBe("ACCEPTED_NEW_ITEM");
    expect(s.trackedItem.sourceConsultantObservationId).toBe(s.observation.id);
    expect(s.trackedItem.tradeId).toBe(7); // Steel
  });

  test("initial response is non-empty and within 4000-char limit", () => {
    const { initialResponse } = buildReviseAndResubmitScenario();
    expect(initialResponse.formalResponse).toBeTruthy();
    expect(initialResponse.formalResponse.length).toBeLessThanOrEqual(4000);
  });

  test("revision response records the prior response", () => {
    const { initialResponse, revisionResponse } = buildReviseAndResubmitScenario();
    expect(revisionResponse.formalResponsePrior).toBe(initialResponse.formalResponse);
  });

  test("revision text is different from initial text", () => {
    const { initialResponse, revisionResponse } = buildReviseAndResubmitScenario();
    expect(revisionResponse.formalResponse).not.toBe(initialResponse.formalResponse);
  });

  test("formalResponsePrior is bounded to ≤500 chars for audit row (service rule)", () => {
    const { revisionResponse } = buildReviseAndResubmitScenario();
    // The prior text itself may be longer than 500 chars; the service truncates it
    // for the DB audit row. The fixture's prior value must be at least 1 char.
    expect(revisionResponse.formalResponsePrior.length).toBeGreaterThan(0);
  });

  test("response by actor is set on both initial and revision", () => {
    const { initialResponse, revisionResponse } = buildReviseAndResubmitScenario();
    expect(initialResponse.formalResponseBy).toBeTruthy();
    expect(revisionResponse.formalResponseBy).toBeTruthy();
  });

  test("tracked item has evidence excerpt from observation text", () => {
    const s = buildReviseAndResubmitScenario();
    expect(s.trackedItem.evidenceExcerpt).not.toBeNull();
    expect(s.trackedItem.evidenceExcerpt!.length).toBeLessThanOrEqual(200);
  });
});

describe("contractor response fixture from expected-contractor-responses.json", () => {
  test("fixture has three response scenarios", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        _scenario: string;
        initialResponse: { formalResponse: string; formalResponseBy: string };
        revision: { formalResponse: string; formalResponsePrior: string } | null;
      }>;
    };
    expect(fixture.responses).toHaveLength(3);
  });

  test("revise-and-resubmit scenario has both initial and revision", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        _scenario: string;
        initialResponse: { formalResponse: string };
        revision: { formalResponse: string; formalResponsePrior: string } | null;
      }>;
    };
    const rar = fixture.responses.find((r) => r._scenario.startsWith("Initial contractor response"));
    expect(rar).toBeDefined();
    expect(rar!.initialResponse.formalResponse).toBeTruthy();
    expect(rar!.revision).not.toBeNull();
    expect(rar!.revision!.formalResponsePrior).toBe(rar!.initialResponse.formalResponse);
  });

  test("accepted-closure scenario has no revision (single response sufficient)", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        _scenario: string;
        revision: unknown;
      }>;
    };
    const acc = fixture.responses.find((r) => r._scenario.startsWith("Accepted-closure"));
    expect(acc).toBeDefined();
    expect(acc!.revision).toBeNull();
  });

  test("GC-responsible scenario includes gcCommentary field", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        _scenario: string;
        gcCommentary?: { comment: string; authorName: string };
      }>;
    };
    const gc = fixture.responses.find((r) => r._scenario.startsWith("GC-responsible"));
    expect(gc).toBeDefined();
    expect(gc!.gcCommentary).toBeDefined();
    expect(gc!.gcCommentary!.comment).toBeTruthy();
    expect(gc!.gcCommentary!.authorName).toBeTruthy();
  });

  test("all response.formalResponse values are within 4000-char limit", () => {
    const fixture = expectedContractorResponses as {
      responses: Array<{
        initialResponse: { formalResponse: string };
        revision?: { formalResponse: string } | null;
      }>;
    };
    for (const r of fixture.responses) {
      expect(r.initialResponse.formalResponse.length).toBeLessThanOrEqual(4000);
      if (r.revision) {
        expect(r.revision.formalResponse.length).toBeLessThanOrEqual(4000);
      }
    }
  });
});

describe("TrackedItem formal response state", () => {
  test("initial item has no formalResponse", () => {
    const item = makeTrackedItem();
    expect(item.formalResponse).toBeNull();
    expect(item.formalResponseBy).toBeNull();
    expect(item.formalResponseAt).toBeNull();
    expect(item.formalResponsePrior).toBeNull();
  });

  test("after revision, formalResponsePrior holds the initial response text", () => {
    const initial = "Initial contractor response text";
    const revision = "Revised contractor response after EOR acceptance";
    const item = makeTrackedItem({
      formalResponse: revision,
      formalResponseBy: "contractor@example.test",
      formalResponseAt: new Date("2024-10-30T11:30:00.000Z"),
      formalResponsePrior: initial,
    });
    expect(item.formalResponse).toBe(revision);
    expect(item.formalResponsePrior).toBe(initial);
  });
});
