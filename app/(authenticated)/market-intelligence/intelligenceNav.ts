// ──────────────────────────────────────────────────────────────────────────────
//  app/(authenticated)/market-intelligence/intelligenceNav.ts
//
//  The Market Intelligence information architecture, as data. This is the single
//  source of truth for the intelligence sub-navigation — the component renders
//  it, and the unit test asserts the product boundary against it (no manual
//  "create a lead" affordance, evidence-first areas, and honest labelling of
//  areas whose data model exists but which have no finished operator surface).
//
//  "available"   → a real, implemented page renders live data at `href`.
//  "foundational"→ the data model / plumbing exists, but there is no finished
//                  standalone product surface yet. `href` may point at the
//                  nearest real surface (or be null). Never presented as done.
//
//  Rule: this nav describes DETECTED, evidence-derived intelligence. It contains
//  no creation/CRM entry point. Manual opportunities are Pursuits, not here.
// ──────────────────────────────────────────────────────────────────────────────

export type IntelligenceNavStatus = "available" | "foundational";

export type IntelligenceNavItem = {
  key: string;
  label: string;
  /** Real destination, or null when the area has no operator surface yet. */
  href: string | null;
  status: IntelligenceNavStatus;
  /** Required for foundational areas: an honest note about what is/ isn't built. */
  note?: string;
};

export const INTELLIGENCE_NAV: readonly IntelligenceNavItem[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/market-intelligence",
    status: "available",
  },
  {
    key: "briefings",
    label: "Intelligence Brief",
    href: "/market-intelligence/briefings",
    status: "available",
  },
  {
    key: "emerging-projects",
    label: "Emerging Projects",
    href: "/market-intelligence/projects",
    status: "available",
  },
  {
    key: "signals",
    label: "Signals",
    href: "/market-intelligence#signal-queue",
    status: "available",
  },
  {
    key: "relationships",
    label: "Relationships",
    href: "/market-intelligence/entities",
    status: "available",
  },
  {
    key: "organizations-people",
    label: "Organizations & People",
    href: "/market-intelligence/entities",
    status: "foundational",
    note: "Backed by the entity graph; entities are not yet typed as organizations vs. people.",
  },
  {
    key: "parcels",
    label: "Parcels & Ownership",
    href: null,
    status: "foundational",
    note: "Parcel and ownership-movement models exist; no operator surface is built yet.",
  },
  {
    key: "municipal-meetings",
    label: "Municipal Meetings",
    href: null,
    status: "foundational",
    note: "Meeting agendas/minutes enter today as source documents and signals; no dedicated municipal-meeting record surface yet.",
  },
  {
    key: "source-documents",
    label: "Source Documents",
    href: null,
    status: "foundational",
    note: "Open a document from a signal or Emerging Project; there is no standalone document index yet.",
  },
  {
    key: "watchlists",
    label: "Watchlists",
    href: "/market-intelligence/watchlists",
    status: "available",
  },
  {
    key: "alerts",
    label: "Alerts",
    href: "/market-intelligence/alerts",
    status: "available",
  },
  {
    key: "forecasting",
    label: "Forecasting",
    href: "/market-intelligence/corridors",
    status: "available",
  },
] as const;

/** True when `pathname` is within the section a nav item points at. */
export function isIntelligenceNavActive(
  item: IntelligenceNavItem,
  pathname: string
): boolean {
  if (!item.href) return false;
  const base = item.href.split("#")[0];
  if (base === "/market-intelligence") {
    // The overview owns the root exactly; deeper routes own their own subtree.
    return pathname === "/market-intelligence";
  }
  return pathname === base || pathname.startsWith(`${base}/`);
}
