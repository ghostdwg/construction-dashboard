// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/specbook/__tests__/sourceSectionLink.test.ts
//
//  Exercises resolveSourceSectionAction()/buildSourceSectionHref() — the pure
//  decision logic behind the "View source section" action rendered for
//  SubmittalItem rows that carry a populated specSectionId. Pure unit tests:
//  no Prisma, no BlobStore, no filesystem — mirrors the existing repo
//  convention of testing route/service decision logic directly (see
//  fileAvailability.test.ts) rather than introducing component-rendering
//  test infra that doesn't otherwise exist in this repo (vitest here runs
//  node-environment *.test.ts only — no jsdom/@testing-library present).
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  buildSourceSectionHref,
  resolveSourceSectionAction,
} from "../sourceSectionLink";

describe("resolveSourceSectionAction", () => {
  // Mandatory test 1 — valid, populated specSectionId + available file
  // renders a "View source section" action linking to the exact route.
  test("populated specSectionId with available file resolves to a link with the exact href", () => {
    const action = resolveSourceSectionAction(42, 7, "durable-present");
    expect(action).toEqual({ kind: "link", href: "/api/bids/42/specbook/sections/7/pdf" });
  });

  test("legacy-present file also resolves to a link (not treated as unavailable)", () => {
    const action = resolveSourceSectionAction(42, 7, "legacy-present");
    expect(action).toEqual({ kind: "link", href: "/api/bids/42/specbook/sections/7/pdf" });
  });

  // Mandatory test 2 — no specSectionId (null/unlinked) renders NO action at
  // all: not a disabled one, not a fake one, nothing.
  test("null specSectionId resolves to null (no action at all)", () => {
    expect(resolveSourceSectionAction(42, null, "durable-present")).toBeNull();
    expect(resolveSourceSectionAction(42, null, "missing")).toBeNull();
    expect(resolveSourceSectionAction(42, null, null)).toBeNull();
  });

  test("undefined specSectionId resolves to null (no action at all)", () => {
    expect(resolveSourceSectionAction(42, undefined, "durable-present")).toBeNull();
  });

  // Mandatory test 3 — populated specSectionId whose target file is
  // missing/invalid renders the honest "unavailable" state, not a
  // working-looking link.
  test("populated specSectionId with missing file resolves to the honest unavailable state", () => {
    const action = resolveSourceSectionAction(42, 7, "missing");
    expect(action).toEqual({ kind: "unavailable", state: "missing" });
  });

  test("populated specSectionId with invalid file resolves to the honest unavailable state", () => {
    const action = resolveSourceSectionAction(42, 7, "invalid");
    expect(action).toEqual({ kind: "unavailable", state: "invalid" });
  });
});

describe("buildSourceSectionHref", () => {
  test("builds the exact existing section-PDF route path from validated numeric ids", () => {
    expect(buildSourceSectionHref(1, 1)).toBe("/api/bids/1/specbook/sections/1/pdf");
    expect(buildSourceSectionHref(123, 4567)).toBe("/api/bids/123/specbook/sections/4567/pdf");
  });

  // Mandatory test 4 — no unsafe path can be constructed: only ever a
  // positive integer is interpolated into the path, never an arbitrary
  // string, so there is no traversal/injection surface in the built href.
  test("rejects non-integer, negative, zero, and NaN ids instead of interpolating them", () => {
    expect(() => buildSourceSectionHref(1.5, 1)).toThrow();
    expect(() => buildSourceSectionHref(1, 1.5)).toThrow();
    expect(() => buildSourceSectionHref(-1, 1)).toThrow();
    expect(() => buildSourceSectionHref(1, -1)).toThrow();
    expect(() => buildSourceSectionHref(0, 1)).toThrow();
    expect(() => buildSourceSectionHref(1, 0)).toThrow();
    expect(() => buildSourceSectionHref(NaN, 1)).toThrow();
    expect(() => buildSourceSectionHref(1, NaN)).toThrow();
  });

  test("TypeScript signature accepts only `number` — a path-traversal-style string is a compile-time error, not just a runtime one", () => {
    expect(() => {
      // @ts-expect-error — sectionId must be a number, never a free-text/user-controlled string.
      buildSourceSectionHref(1, "../../../etc/passwd");
    }).toThrow();
    // The line above must fail to typecheck (asserted by `tsc --noEmit`
    // catching it if someone weakens the signature to `string | number`) —
    // it also throws at runtime here since coercing the string to a number
    // yields NaN, which the integer guard above rejects either way.
    expect(() => buildSourceSectionHref(1, Number("../../../etc/passwd"))).toThrow();
  });
});
