// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/__tests__/seed.test.ts
//  Phase MI-3 — Watchlist parser tests.
//
//  Pure-function tests on the markdown parser. No Prisma involved.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { parseWatchlist } from "../seed";

describe("parseWatchlist", () => {
  test("parses a single ### heading with Role line", () => {
    const md = `
## Developers / Owners

### Hubbell Realty Company
- **Role:** Developer (most active in DSM metro)
- **Frequent GC partners:** Weitz Company, Ryan Companies, Hansen Company
- **LLC pattern:** Likely single-purpose LLCs
`;
    const entries = parseWatchlist(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].rawName).toBe("Hubbell Realty Company");
    expect(entries[0].normalizedName).toBe("hubbell");
    expect(entries[0].entityType).toBe("Developer");
    expect(entries[0].category).toBe("Developers / Owners");
    expect(entries[0].knownCounterparties).toContain("Weitz Company");
    expect(entries[0].knownCounterparties).toContain("Ryan Companies");
    expect(entries[0].knownCounterparties).toContain("Hansen Company");
  });

  test("parses multi-entity heading split on slash", () => {
    const md = `
## Corporates

### Microsoft / Apple / Meta (data centers)
- **Role:** Owners
- **Locations:** WDM + Altoona
`;
    const entries = parseWatchlist(md);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.rawName)).toEqual(["Microsoft", "Apple", "Meta"]);
    for (const e of entries) {
      expect(e.entityType).toBe("Owner");
    }
  });

  test("infers GC type from category when role line is ambiguous", () => {
    const md = `
## General Contractors (regional + national active in DSM)

### Ryan Companies
- **Role:** GC
- **Origin:** Minneapolis-based

### Story Construction
- **Role:** Regional GC
- **Origin:** Ames
`;
    const entries = parseWatchlist(md);
    expect(entries.find((e) => e.rawName === "Ryan Companies")?.entityType).toBe("GC");
    expect(entries.find((e) => e.rawName === "Story Construction")?.entityType).toBe("GC");
  });

  test("captures notes from bullet lines (multi-line)", () => {
    const md = `
## Developers / Owners

### Knapp Properties
- **Role:** Developer + GC arm (CC&G Construction)
- **Notable:** Chris Costa is 2026 GDMP Board Chair
- **Vertical integration:** Often serves as own GC via CC&G Construction
`;
    const entries = parseWatchlist(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].entityType).toBe("Developer");
    expect(entries[0].notes).toContain("Chris Costa");
    expect(entries[0].notes).toContain("Vertical integration");
  });

  test("skips the example skeleton at the bottom of the file", () => {
    const md = `
## Adding new entities

### {Canonical Name}
- **Role:** {Developer | Owner | GC}
- **Notable:** {context}
`;
    const entries = parseWatchlist(md);
    expect(entries).toHaveLength(0);
  });

  test("ignores entries with no normalizedName", () => {
    const md = `
## Section

### ,,,
- **Role:** Owner
`;
    const entries = parseWatchlist(md);
    expect(entries).toHaveLength(0);
  });

  test("preserves entity ordering from the markdown", () => {
    const md = `
## Developers / Owners

### Hubbell Realty Company
- **Role:** Developer

### Knapp Properties
- **Role:** Developer

### R&R Realty Group
- **Role:** Developer
`;
    const entries = parseWatchlist(md);
    expect(entries.map((e) => e.rawName)).toEqual([
      "Hubbell Realty Company",
      "Knapp Properties",
      "R&R Realty Group",
    ]);
  });

  test("normalizes each parsed name deterministically", () => {
    const md = `
## Developers / Owners

### Hubbell Realty Company, LLC
- **Role:** Developer
`;
    const entries = parseWatchlist(md);
    expect(entries[0].normalizedName).toBe("hubbell");
  });
});
