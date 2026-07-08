// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/submittal/__tests__/provenanceLabels.test.ts
//
//  WP1b — pure label-mapping tests for the display-only provenance badge.
//  No Prisma, no React, no DB — getProvenanceLabel() is a pure function, so
//  this is plain vitest with no mocking. Covers all 6 known SubmittalItem
//  .source values (per WP1a.1's schema comment), the unknown/legacy-value
//  fallback, and asserts the labels never slip into quality/verification
//  language.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { getProvenanceLabel } from "../provenanceLabels";

const KNOWN_SOURCES = [
  "manual",
  "regex_seed",
  "ai_extraction",
  "csi_baseline",
  "ai_organized",
  "drawing_analysis",
] as const;

describe("getProvenanceLabel — known source values", () => {
  it.each(KNOWN_SOURCES)("maps %s to a non-empty text and className", (source) => {
    const label = getProvenanceLabel(source);
    expect(label.text.length).toBeGreaterThan(0);
    expect(label.className.length).toBeGreaterThan(0);
  });

  it("maps each known value to a distinct label", () => {
    const texts = KNOWN_SOURCES.map((s) => getProvenanceLabel(s).text);
    expect(new Set(texts).size).toBe(KNOWN_SOURCES.length);
  });

  it("manual maps to \"Manual\"", () => {
    expect(getProvenanceLabel("manual").text).toBe("Manual");
  });

  it("regex_seed maps to \"Regex seed\"", () => {
    expect(getProvenanceLabel("regex_seed").text).toBe("Regex seed");
  });

  it("drawing_analysis maps to \"Drawing\"", () => {
    expect(getProvenanceLabel("drawing_analysis").text).toBe("Drawing");
  });
});

describe("getProvenanceLabel — unknown/legacy fallback safety", () => {
  it("an unrecognized string falls back to a neutral label, not a crash", () => {
    expect(() => getProvenanceLabel("some_future_source_type")).not.toThrow();
    const label = getProvenanceLabel("some_future_source_type");
    expect(label.text).toBe("Unknown source");
    expect(label.className.length).toBeGreaterThan(0);
  });

  it("null falls back to the neutral label, not a crash", () => {
    expect(() => getProvenanceLabel(null)).not.toThrow();
    expect(getProvenanceLabel(null).text).toBe("Unknown source");
  });

  it("undefined falls back to the neutral label, not a crash", () => {
    expect(() => getProvenanceLabel(undefined)).not.toThrow();
    expect(getProvenanceLabel(undefined).text).toBe("Unknown source");
  });

  it("empty string falls back to the neutral label", () => {
    expect(getProvenanceLabel("").text).toBe("Unknown source");
  });
});

describe("getProvenanceLabel — claim discipline", () => {
  const FORBIDDEN_WORDS = ["verified", "confirmed", "reviewed", "checked", "approved", "validated"];

  it("no known-source label implies quality, verification, or review", () => {
    for (const source of KNOWN_SOURCES) {
      const text = getProvenanceLabel(source).text.toLowerCase();
      for (const word of FORBIDDEN_WORDS) {
        expect(text).not.toContain(word);
      }
    }
  });

  it("the unknown-source fallback also implies no quality claim", () => {
    const text = getProvenanceLabel("anything_else").text.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      expect(text).not.toContain(word);
    }
  });
});
