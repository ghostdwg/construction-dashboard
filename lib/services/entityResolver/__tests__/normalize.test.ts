// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/__tests__/normalize.test.ts
//  Phase MI-2 — normalizeEntityName() acceptance tests.
//
//  Watchlist source: docs/sources/ENTITIES_WATCHLIST.md
//  Specifically covers acceptance scenarios:
//    - Hubbell variants collapse correctly
//    - Municipality variants collapse correctly
//    - Broker/company abbreviations normalize
//    - LLC / L.L.C. / Inc. punctuation insensitivity
//    - Architect / Engineer suffix stripping
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { normalizeEntityName } from "../normalize";

describe("normalizeEntityName — Hubbell variants", () => {
  test("canonical: Hubbell Realty Company", () => {
    expect(normalizeEntityName("Hubbell Realty Company")).toBe("hubbell");
  });
  test("with LLC suffix", () => {
    expect(normalizeEntityName("Hubbell Realty Company, LLC")).toBe("hubbell");
  });
  test("short form", () => {
    expect(normalizeEntityName("Hubbell")).toBe("hubbell");
  });
  test("Hubbell Realty (no Company)", () => {
    expect(normalizeEntityName("Hubbell Realty")).toBe("hubbell");
  });
  test("HUBBELL REALTY CO. (all-caps, abbreviated Co.)", () => {
    expect(normalizeEntityName("HUBBELL REALTY CO.")).toBe("hubbell");
  });
  test("Hubbell Properties (alternate descriptor)", () => {
    expect(normalizeEntityName("Hubbell Properties")).toBe("hubbell");
  });
});

describe("normalizeEntityName — Weitz variants", () => {
  test("with leading The + Company suffix", () => {
    expect(normalizeEntityName("The Weitz Company")).toBe("weitz");
  });
  test("short form", () => {
    expect(normalizeEntityName("Weitz")).toBe("weitz");
  });
  test("Weitz Co. (abbreviated Co.)", () => {
    expect(normalizeEntityName("Weitz Co.")).toBe("weitz");
  });
  test("Weitz Construction", () => {
    expect(normalizeEntityName("Weitz Construction")).toBe("weitz");
  });
});

describe("normalizeEntityName — LLC / L.L.C. punctuation insensitivity", () => {
  test("L.L.C. matches LLC", () => {
    expect(normalizeEntityName("Walnut Creek Industrial, L.L.C.")).toBe(
      "walnutcreekindustrial"
    );
  });
  test("plain LLC suffix", () => {
    expect(normalizeEntityName("Walnut Creek Industrial LLC")).toBe(
      "walnutcreekindustrial"
    );
  });
  test("project-LLC pattern: Norwalk JV22 LLC", () => {
    expect(normalizeEntityName("Norwalk JV22 LLC")).toBe("norwalkjv22");
  });
  test("Inc. suffix", () => {
    expect(normalizeEntityName("Casey's General Stores, Inc.")).toBe(
      "caseysgeneralstores"
    );
  });
});

describe("normalizeEntityName — ampersand normalization", () => {
  test("CC&G Construction collapses ampersand", () => {
    expect(normalizeEntityName("CC&G Construction")).toBe("ccg");
  });
  test("R&R Realty Group", () => {
    expect(normalizeEntityName("R&R Realty Group")).toBe("rr");
  });
  test("spaces around ampersand", () => {
    expect(normalizeEntityName("R & R Realty Group")).toBe("rr");
  });
  test("Snyder & Associates (engineering)", () => {
    expect(normalizeEntityName("Snyder & Associates")).toBe("snyder");
  });
});

describe("normalizeEntityName — municipality cleanup", () => {
  test("City of Des Moines", () => {
    expect(normalizeEntityName("City of Des Moines")).toBe("desmoines");
  });
  test("CITY OF WEST DES MOINES (caps)", () => {
    expect(normalizeEntityName("CITY OF WEST DES MOINES")).toBe("westdesmoines");
  });
  test("Town of Bondurant", () => {
    expect(normalizeEntityName("Town of Bondurant")).toBe("bondurant");
  });
  test("County of Polk", () => {
    expect(normalizeEntityName("County of Polk")).toBe("polk");
  });
  // "Polk County" (no "of") is a named entity, not a prefixed form — the
  // normalizer doesn't strip the trailing "County" word.
  test("Polk County stays joined (no 'of' prefix)", () => {
    expect(normalizeEntityName("Polk County")).toBe("polkcounty");
  });
});

describe("normalizeEntityName — architecture / engineering suffix stripping", () => {
  test("Architects", () => {
    expect(normalizeEntityName("OPN Architects")).toBe("opn");
  });
  test("Architecture", () => {
    expect(normalizeEntityName("Substance Architecture")).toBe("substance");
  });
  test("Engineering", () => {
    expect(normalizeEntityName("Shive-Hattery Engineering")).toBe("shivehattery");
  });
  test("Engineers", () => {
    expect(normalizeEntityName("Bishop Engineering Engineers")).toBe("bishop");
  });
  test("Associates", () => {
    expect(normalizeEntityName("Bolton & Menk Associates")).toBe("boltonmenk");
  });
});

describe("normalizeEntityName — GC name variants", () => {
  test("Ryan Companies", () => {
    expect(normalizeEntityName("Ryan Companies")).toBe("ryan");
  });
  test("Neumann Brothers stays compound", () => {
    // "Brothers" is not in the suffix list — it's part of the canonical name.
    expect(normalizeEntityName("Neumann Brothers")).toBe("neumannbrothers");
  });
  test("Story Construction", () => {
    expect(normalizeEntityName("Story Construction")).toBe("story");
  });
  test("Henkel Construction", () => {
    expect(normalizeEntityName("Henkel Construction")).toBe("henkel");
  });
});

describe("normalizeEntityName — multi-word suffixes", () => {
  test("Real Estate suffix stripped", () => {
    expect(normalizeEntityName("Hurd Real Estate Services")).toBe("hurd");
  });
  test("General Contractor suffix stripped", () => {
    expect(normalizeEntityName("Foo General Contractor")).toBe("foo");
  });
});

describe("normalizeEntityName — edge cases", () => {
  test("empty string", () => {
    expect(normalizeEntityName("")).toBe("");
  });
  test("whitespace only", () => {
    expect(normalizeEntityName("   ")).toBe("");
  });
  test("only-suffix name keeps last token", () => {
    // Tokens [llc] — single token left; the while loop stops because we
    // require length > 1. So normalize to "llc".
    expect(normalizeEntityName("LLC")).toBe("llc");
  });
  test("hyphenated names collapse", () => {
    expect(normalizeEntityName("Shive-Hattery")).toBe("shivehattery");
  });
  test("numbers preserved", () => {
    expect(normalizeEntityName("Plat 3 LLC")).toBe("plat3");
  });
});
