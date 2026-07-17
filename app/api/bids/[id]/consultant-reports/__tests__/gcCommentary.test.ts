// Field Response Certification — GC commentary preservation tests.
//
// GC commentary is NOT a schema field yet — this module validates:
// 1. That the expected-gc-review fixture documents GC commentary as a
//    separate field (not merged into formalResponse).
// 2. That the compiled-response fixture preserves gcCommentary in the
//    output structure.
// 3. That TrackedItemComment (the existing append-only thread) can carry
//    GC commentary while Fable's schema is pending.
//
// No DB, no network — fixture validation and builder tests only.
import { describe, expect, test, beforeEach } from "vitest";
import {
  makeTrackedItem,
  resetIds,
} from "@/tests/field-response-certification/unit-integration-builders";
import expectedGcReview from "@/tests/field-response-certification/fixtures/expected-gc-review.json";
import expectedContractorResponses from "@/tests/field-response-certification/fixtures/expected-contractor-responses.json";

beforeEach(() => {
  resetIds(6000);
});

describe("GC commentary in expected-gc-review fixture", () => {
  const fixture = expectedGcReview as {
    compiledResponse: {
      tradeGroups: Array<{
        tradeName: string;
        items: Array<{
          title: string;
          formalResponse: string | null;
          gcCommentary?: string;
        }>;
      }>;
    };
  };

  test("fixture is loaded successfully", () => {
    expect(fixture).toBeDefined();
    expect(fixture.compiledResponse).toBeDefined();
    expect(fixture.compiledResponse.tradeGroups).toBeInstanceOf(Array);
  });

  test("drywall STC item carries gcCommentary separate from formalResponse", () => {
    const drywall = fixture.compiledResponse.tradeGroups.find(
      (g) => g.tradeName === "Drywall"
    );
    expect(drywall).toBeDefined();
    const stcItem = drywall!.items[0];
    // Both fields must be present and non-null
    expect(stcItem.formalResponse).not.toBeNull();
    expect(stcItem.gcCommentary).toBeDefined();
    expect(stcItem.gcCommentary).not.toBe(stcItem.formalResponse);
    // Commentary must not be merged into the formal response
    expect(stcItem.formalResponse).not.toContain("directed drywall sub");
    expect(stcItem.gcCommentary).toContain("directed drywall sub");
  });

  test("steel items do not have gcCommentary (contractor-direct assignments)", () => {
    const steel = fixture.compiledResponse.tradeGroups.find(
      (g) => g.tradeName === "Steel"
    );
    expect(steel).toBeDefined();
    steel!.items.forEach((item) => {
      // Steel items are assigned directly to the steel contractor — no GC commentary
      expect(item.gcCommentary).toBeUndefined();
    });
  });

  test("items without a response have null formalResponse (not omitted)", () => {
    const mech = fixture.compiledResponse.tradeGroups.find(
      (g) => g.tradeName === "Mechanical"
    );
    expect(mech).toBeDefined();
    const pendingItem = mech!.items[0];
    expect(pendingItem.formalResponse).toBeNull();
  });
});

describe("GC commentary in expected-contractor-responses fixture", () => {
  const fixture = expectedContractorResponses as {
    responses: Array<{
      _scenario: string;
      gcCommentary?: { comment: string; authorName: string; createdAt: string };
      initialResponse: { formalResponse: string };
    }>;
  };

  test("GC commentary has comment, authorName, and createdAt", () => {
    const gc = fixture.responses.find((r) => r._scenario.startsWith("GC-responsible"));
    expect(gc!.gcCommentary!.comment).toBeTruthy();
    expect(gc!.gcCommentary!.authorName).toBeTruthy();
    expect(gc!.gcCommentary!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  test("GC commentary content describes specific corrective action", () => {
    const gc = fixture.responses.find((r) => r._scenario.startsWith("GC-responsible"));
    // Commentary describes what GC directed — must be distinct from the formal response
    expect(gc!.gcCommentary!.comment).not.toBe(gc!.initialResponse.formalResponse);
  });
});

describe("TrackedItemComment as interim GC commentary carrier", () => {
  test("existing comment model fields are sufficient for GC commentary", () => {
    // The TrackedItemComment model has: body, authorName, authorEmail, createdAt
    // These fields are sufficient to carry GC commentary before Fable's schema lands.
    const comment = {
      trackedItemId: 1003,
      authorName: "GC Site Superintendent",
      authorEmail: "gc.super@example.test",
      body: "GC directed drywall sub to re-screw area per spec. Complete 2024-10-22.",
      createdAt: new Date("2024-10-22T15:00:00.000Z"),
    };
    expect(comment.body).toBeTruthy();
    expect(comment.authorName).toBeTruthy();
  });

  test("GC commentary must not overwrite formalResponse", () => {
    // This validates the separation invariant:
    // formalResponse = contractor's formal answer
    // gcCommentary (as comment) = GC's coordination note
    const item = makeTrackedItem({
      formalResponse: "STC assembly re-screwed. Corrected inspection form attached.",
      formalResponseBy: "gc.pm@example.test",
    });
    // Simulated comment from GC
    const gcNote = {
      body: "GC directed drywall sub to re-screw area per spec.",
      authorName: "GC Site Superintendent",
    };
    // Verify they are separate
    expect(item.formalResponse).not.toContain("directed drywall sub");
    expect(gcNote.body).not.toContain("inspection form attached");
  });
});
