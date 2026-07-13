// Module OPS4 (Phase 1B) — derived consultant badge: pure precedence
// truth table. disposed > responded > linked > unlinked.
import { describe, expect, test } from "vitest";

import { deriveConsultantBadge } from "../consultantBadge";

describe("deriveConsultantBadge", () => {
  test("truth table — every combination", () => {
    const cases: Array<[boolean, boolean, boolean, string]> = [
      // [linked, responded, disposed] → badge
      [false, false, false, "unlinked"],
      [true,  false, false, "linked"],
      [false, true,  false, "responded"], // response without a citing observation still reads responded
      [true,  true,  false, "responded"],
      [false, false, true,  "disposed"],  // disposition wins even without a response
      [true,  false, true,  "disposed"],
      [false, true,  true,  "disposed"],
      [true,  true,  true,  "disposed"],
    ];
    for (const [linked, responded, disposed, expected] of cases) {
      expect(
        deriveConsultantBadge({
          hasLinkedObservation: linked,
          hasFormalResponse: responded,
          hasDispositionRecord: disposed,
        })
      ).toBe(expected);
    }
  });
});
