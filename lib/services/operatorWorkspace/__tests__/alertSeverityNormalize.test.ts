// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/__tests__/alertSeverityNormalize.test.ts
//  Phase O2.2 PR8 — Severity normalization tests.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  NORMALIZED_ALERT_SEVERITIES,
  SEVERITY_NORMALIZATION_VERSION,
  normalizeSeverity,
  normalizeSeverityDetailed,
  normalizedSeverityRank,
  pickHigherSeverity,
} from "../alertSeverityNormalize";

describe("PR8 severity normalization", () => {
  test("version is v1", () => {
    expect(SEVERITY_NORMALIZATION_VERSION).toBe("v1");
  });

  test("exactly four normalized bands in expected order", () => {
    expect(NORMALIZED_ALERT_SEVERITIES).toEqual(["INFO", "WATCH", "IMPORTANT", "CRITICAL"]);
  });

  describe("normalizeSeverity — legacy → normalized mapping", () => {
    const cases: Array<[string | null | undefined, string]> = [
      ["INFO",       "INFO"],
      ["WATCH",      "WATCH"],
      ["ATTENTION",  "IMPORTANT"],   // legacy → normalized
      ["URGENT",     "CRITICAL"],    // legacy → normalized
      ["IMPORTANT",  "IMPORTANT"],   // idempotent
      ["CRITICAL",   "CRITICAL"],    // idempotent
      ["info",       "INFO"],        // case-insensitive
      ["Critical",   "CRITICAL"],    // case-insensitive
      [null,         "INFO"],        // null → INFO
      [undefined,    "INFO"],        // undefined → INFO
      ["GARBAGE",    "INFO"],        // unknown → INFO
      ["",           "INFO"],        // empty → INFO
    ];
    for (const [input, expected] of cases) {
      test(`${JSON.stringify(input)} → ${expected}`, () => {
        expect(normalizeSeverity(input)).toBe(expected);
      });
    }
  });

  describe("normalizeSeverityDetailed — decisions", () => {
    test("mapped (legacy ATTENTION → IMPORTANT)", () => {
      expect(normalizeSeverityDetailed("ATTENTION")).toEqual({
        input: "ATTENTION", output: "IMPORTANT", decision: "mapped",
      });
    });
    test("idempotent (already-normalized IMPORTANT)", () => {
      expect(normalizeSeverityDetailed("IMPORTANT")).toEqual({
        input: "IMPORTANT", output: "IMPORTANT", decision: "idempotent",
      });
    });
    test("unknown_input degrades to INFO", () => {
      expect(normalizeSeverityDetailed("FOO")).toEqual({
        input: "FOO", output: "INFO", decision: "unknown_input",
      });
    });
    test("null_input → INFO", () => {
      expect(normalizeSeverityDetailed(null)).toEqual({
        input: null, output: "INFO", decision: "null_input",
      });
    });
  });

  describe("normalizedSeverityRank + pickHigherSeverity", () => {
    test("rank is strictly increasing", () => {
      expect(normalizedSeverityRank("INFO"))     .toBe(0);
      expect(normalizedSeverityRank("WATCH"))    .toBe(1);
      expect(normalizedSeverityRank("IMPORTANT")).toBe(2);
      expect(normalizedSeverityRank("CRITICAL")) .toBe(3);
    });
    test("pickHigherSeverity returns the higher band", () => {
      expect(pickHigherSeverity("INFO",      "WATCH"))    .toBe("WATCH");
      expect(pickHigherSeverity("IMPORTANT", "CRITICAL")) .toBe("CRITICAL");
      expect(pickHigherSeverity("WATCH",     "IMPORTANT")).toBe("IMPORTANT");
      expect(pickHigherSeverity("CRITICAL",  "INFO"))     .toBe("CRITICAL");
    });
    test("pickHigherSeverity is reflexive", () => {
      for (const s of NORMALIZED_ALERT_SEVERITIES) {
        expect(pickHigherSeverity(s, s)).toBe(s);
      }
    });
  });
});
