// Phase MI-7 — Parcel normalization tests.
//
// Verifies the deterministic-first contract: equivalent variants of the same
// parcel reference collapse to the same dedup key, and obviously-different
// references do NOT.

import { describe, expect, test } from "vitest";
import { classifyParcelKind, normalizeParcelRef } from "../normalize";

describe("classifyParcelKind", () => {
  test("classifies bare assessor parcel ids", () => {
    expect(classifyParcelKind("010-12345-678")).toBe("ASSESSOR");
    // Pure-digit strings that match the loose assessor numeric shape are
    // also treated as ASSESSOR — the loose pattern is intentional to catch
    // jurisdiction variants that drop separators.
    expect(classifyParcelKind("01012345678")).toBe("ASSESSOR");
  });

  test("classifies county-prefixed assessor ids", () => {
    expect(classifyParcelKind("Polk Co 010-12345-678")).toBe("ASSESSOR");
    expect(classifyParcelKind("Polk County 010-12345")).toBe("ASSESSOR");
  });

  test("classifies addresses", () => {
    expect(classifyParcelKind("5301 Mills Civic Parkway")).toBe("ADDRESS_ONLY");
    expect(classifyParcelKind("123 Main St")).toBe("ADDRESS_ONLY");
  });

  test("classifies legal descriptions", () => {
    expect(classifyParcelKind("Lot 7, Block 12, Westridge Plat 3")).toBe("LEGAL");
    expect(classifyParcelKind("Section 12, Township 79N, Range 24W")).toBe("LEGAL");
  });

  test("classifies utility refs", () => {
    expect(classifyParcelKind("WATER ACCT 4429321")).toBe("UTILITY");
    expect(classifyParcelKind("Sewer Account 17732")).toBe("UTILITY");
  });

  test("returns UNKNOWN for empty / nonsense input", () => {
    expect(classifyParcelKind("")).toBe("UNKNOWN");
    expect(classifyParcelKind("???")).toBe("UNKNOWN");
  });
});

describe("normalizeParcelRef — assessor parcel ids", () => {
  test("collapses formatting variants", () => {
    const a = normalizeParcelRef("010-12345-678");
    const b = normalizeParcelRef("010 12345 678");
    const c = normalizeParcelRef("01012345678", "ASSESSOR");
    expect(a).toBe("01012345678");
    expect(b).toBe("01012345678");
    expect(c).toBe("01012345678");
  });

  test("strips county prefix", () => {
    expect(normalizeParcelRef("Polk Co 010-12345-678")).toBe("01012345678");
    expect(normalizeParcelRef("Polk County 010-12345-678")).toBe("01012345678");
  });
});

describe("normalizeParcelRef — addresses", () => {
  test("collapses parkway / pkwy / pkway typo variants", () => {
    const a = normalizeParcelRef("5301 Mills Civic Parkway");
    const b = normalizeParcelRef("5301 Mills Civic Pkwy");
    const c = normalizeParcelRef("5301 Mills Civic Pkway");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("collapses street / st", () => {
    expect(normalizeParcelRef("123 Main Street")).toBe(normalizeParcelRef("123 Main St"));
  });

  test("collapses directional prefixes", () => {
    expect(normalizeParcelRef("123 North Main St")).toBe(normalizeParcelRef("123 N Main St"));
  });

  test("strips unit suffixes", () => {
    expect(normalizeParcelRef("5301 Mills Civic Pkwy Suite 200"))
      .toBe(normalizeParcelRef("5301 Mills Civic Pkwy"));
    expect(normalizeParcelRef("5301 Mills Civic Pkwy #5"))
      .toBe(normalizeParcelRef("5301 Mills Civic Pkwy"));
  });

  test("distinguishes different addresses", () => {
    const a = normalizeParcelRef("5301 Mills Civic Pkwy");
    const b = normalizeParcelRef("5305 Mills Civic Pkwy");
    expect(a).not.toBe(b);
  });
});

describe("normalizeParcelRef — legal + utility", () => {
  test("legal description: punctuation-insensitive", () => {
    const a = normalizeParcelRef("Lot 7, Block 12, Westridge Plat 3");
    const b = normalizeParcelRef("Lot 7 Block 12 Westridge Plat 3");
    expect(a).toBe(b);
  });

  test("utility: prefix stripped", () => {
    expect(normalizeParcelRef("WATER ACCT 4429321")).toBe("4429321");
    expect(normalizeParcelRef("Water Account 4429321")).toBe("4429321");
  });
});

describe("normalizeParcelRef — edge cases", () => {
  test("returns empty for empty input", () => {
    expect(normalizeParcelRef("")).toBe("");
  });

  test("returns empty for whitespace-only input", () => {
    expect(normalizeParcelRef("   ")).toBe("");
  });
});
