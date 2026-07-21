import { describe, expect, test } from "vitest";
import {
  INTELLIGENCE_NAV,
  isIntelligenceNavActive,
  type IntelligenceNavItem,
} from "../intelligenceNav";

// The intelligence sub-navigation IS the product boundary made concrete. These
// tests assert the boundary against the nav model, not against raw source text.

function item(key: string): IntelligenceNavItem {
  const found = INTELLIGENCE_NAV.find((i) => i.key === key);
  if (!found) throw new Error(`nav item ${key} missing`);
  return found;
}

describe("Market Intelligence navigation is evidence-first, not a lead CRM", () => {
  test("exposes no manual creation / lead-CRM affordance", () => {
    for (const nav of INTELLIGENCE_NAV) {
      const haystack = `${nav.key} ${nav.label} ${nav.href ?? ""}`.toLowerCase();
      expect(haystack).not.toContain("new lead");
      expect(haystack).not.toContain("add lead");
      expect(haystack).not.toContain("create");
      // No user-facing "Lead" vocabulary anywhere in the IA.
      expect(nav.label.toLowerCase()).not.toMatch(/\blead\b/);
    }
    // And there is no create/new/intake destination at all.
    expect(
      INTELLIGENCE_NAV.some((n) => /\/(new|create|intake)(\b|\/)/.test(n.href ?? ""))
    ).toBe(false);
  });

  test("Emerging Projects is a first-class, available area", () => {
    const ep = item("emerging-projects");
    expect(ep.label).toBe("Emerging Projects");
    expect(ep.status).toBe("available");
    expect(ep.href).toBe("/market-intelligence/projects");
  });

  test("covers the intended intelligence structure", () => {
    const labels = INTELLIGENCE_NAV.map((n) => n.label);
    for (const expected of [
      "Overview",
      "Intelligence Brief",
      "Emerging Projects",
      "Signals",
      "Relationships",
      "Municipal Meetings",
      "Source Documents",
      "Watchlists",
      "Alerts",
      "Forecasting",
    ]) {
      expect(labels).toContain(expected);
    }
  });

  test("every available area points at a real market-intelligence route", () => {
    for (const nav of INTELLIGENCE_NAV.filter((n) => n.status === "available")) {
      expect(nav.href, `${nav.key} must have an href`).toBeTruthy();
      expect(nav.href!.split("#")[0]).toMatch(/^\/market-intelligence(\/|$)/);
    }
  });

  test("foundational areas are honestly labelled, never faked as complete", () => {
    const foundational = INTELLIGENCE_NAV.filter((n) => n.status === "foundational");
    expect(foundational.length).toBeGreaterThan(0);
    for (const nav of foundational) {
      // Each foundational area explains what does / does not exist.
      expect(nav.note, `${nav.key} needs an honest note`).toBeTruthy();
      expect((nav.note ?? "").length).toBeGreaterThan(20);
    }
    // Parcels and municipal meetings are foundational (no finished surface).
    expect(item("parcels").status).toBe("foundational");
    expect(item("municipal-meetings").status).toBe("foundational");
  });

  test("active-state resolution is scoped correctly", () => {
    // Overview owns the root exactly and does not light up on deeper routes.
    expect(isIntelligenceNavActive(item("overview"), "/market-intelligence")).toBe(true);
    expect(
      isIntelligenceNavActive(item("overview"), "/market-intelligence/projects")
    ).toBe(false);
    // A subtree route lights up its own item.
    expect(
      isIntelligenceNavActive(item("emerging-projects"), "/market-intelligence/projects/abc")
    ).toBe(true);
    // Foundational areas without a destination are never active.
    expect(isIntelligenceNavActive(item("parcels"), "/market-intelligence")).toBe(false);
  });
});
