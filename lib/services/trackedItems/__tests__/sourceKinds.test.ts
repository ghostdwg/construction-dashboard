// R2 remediation — TrackedItem.sourceKind canonical vocabulary. The
// constants module is the single source of truth; legacy production values
// stay readable forever and are never re-emitted by new code.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_SOURCE_KINDS,
  LEGACY_SOURCE_KINDS,
  TRACKED_ITEM_SOURCE_KIND,
  isCanonicalSourceKind,
  isKnownSourceKind,
  isMeetingSourceKind,
  sourceKindLabel,
} from "../sourceKinds";

describe("canonical vocabulary", () => {
  it("contains exactly the six canonical values", () => {
    expect([...CANONICAL_SOURCE_KINDS].sort()).toEqual([
      "consultant_observation",
      "field_report",
      "manual",
      "meeting_action_item",
      "meeting_design_change",
      "meeting_register",
    ]);
  });

  it("canonical and legacy sets are disjoint and all known", () => {
    for (const v of CANONICAL_SOURCE_KINDS) {
      expect(isCanonicalSourceKind(v), v).toBe(true);
      expect(LEGACY_SOURCE_KINDS.includes(v), v).toBe(false);
    }
    for (const v of LEGACY_SOURCE_KINDS) {
      expect(isCanonicalSourceKind(v), v).toBe(false);
      expect(isKnownSourceKind(v), v).toBe(true);
    }
  });

  it("legacy production values remain readable (meeting, consultant_report, spec_section)", () => {
    expect(isKnownSourceKind("meeting")).toBe(true);
    expect(isKnownSourceKind("consultant_report")).toBe(true);
    expect(isKnownSourceKind("spec_section")).toBe(true);
    expect(sourceKindLabel("meeting")).toBe("meeting");
    expect(sourceKindLabel("consultant_report")).toBe("consultant report");
    expect(sourceKindLabel("spec_section")).toBe("spec section");
  });

  it("meeting family covers canonical + legacy meeting-derived kinds only", () => {
    expect(isMeetingSourceKind("meeting")).toBe(true);
    expect(isMeetingSourceKind(TRACKED_ITEM_SOURCE_KIND.MEETING_ACTION_ITEM)).toBe(true);
    expect(isMeetingSourceKind(TRACKED_ITEM_SOURCE_KIND.MEETING_DESIGN_CHANGE)).toBe(true);
    expect(isMeetingSourceKind(TRACKED_ITEM_SOURCE_KIND.MEETING_REGISTER)).toBe(true);
    expect(isMeetingSourceKind("field_report")).toBe(false);
    expect(isMeetingSourceKind("consultant_observation")).toBe(false);
  });

  it("labels every known value and falls back safely for unknowns", () => {
    for (const v of [...CANONICAL_SOURCE_KINDS, ...LEGACY_SOURCE_KINDS]) {
      expect(sourceKindLabel(v), v).not.toBe("");
    }
    expect(sourceKindLabel("something_unknown")).toBe("manual entry");
  });
});
