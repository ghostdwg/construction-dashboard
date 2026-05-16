# Seed Entity Watchlist — Greater Des Moines Market

Use this list to **seed the entity-normalization graph** before any scraped data
lands. Validating that the fuzzy-matcher correctly collapses these entities is
the acceptance test for Phase 5M (cross-source reconciliation).

Each entry includes the canonical name, common LLC variants/aliases to watch
for, the relationship-graph role, and (where known) frequent counterparties.

---

## Developers / Owners

### Hubbell Realty Company
- **Role:** Developer (most active in DSM metro)
- **Frequent GC partners:** Weitz Company, Ryan Companies, Hansen Company
- **LLC pattern:** Likely uses single-purpose LLCs per project — cross-reference via Iowa SOS registered agent

### Knapp Properties
- **Role:** Developer + GC arm (CC&G Construction)
- **Notable:** Chris Costa is 2026 GDMP Board Chair
- **Vertical integration:** Often serves as own GC via CC&G Construction

### R&R Realty Group
- **Role:** Developer (industrial/office)
- **Submarket:** Heavy in Westown Pkwy and Westfield corridor

### Nelson Construction & Development
- **Role:** Developer + GC (north metro retail focus)
- **Submarket:** Ankeny and north Polk County

### Christensen Development
- **Role:** Developer
- **Asset class:** Multifamily-focused

### Hurd Real Estate Services
- **Role:** Investment sales + development

---

## Corporates (likely repeat capital projects)

### Casey's General Stores
- **Role:** Owner (corporate HQ)
- **HQ:** Ankeny
- **Activity:** Ongoing store buildouts + distribution facility expansion

### Vermeer Corp.
- **Role:** Owner (manufacturing)
- **Locations:** Pella HQ + new Bondurant facility ($102.7M IEDA award Feb 2026, 300k sq ft, 182 jobs)

### Pella Corp. (windows)
- **Role:** Owner (manufacturing)
- **Activity:** Manufacturing expansion

### Microsoft / Apple / Meta (data centers)
- **Role:** Owners
- **Locations:** WDM + Altoona data-center cluster
- **Typical GCs:** DPR, Holder Construction, M.A. Mortenson (national tier-1 data-center specialists)

### Iowa Health System / UnityPoint Health / MercyOne
- **Role:** Owners (healthcare)
- **Notable:** David Stark of UnityPoint chairs GDMP Government Policy Council

### Principal Financial Group
- **Role:** Owner (corporate)
- **Submarket:** Downtown DSM real estate + Drake University partnership

---

## General Contractors (regional + national active in DSM)

### Ryan Companies
- **Role:** GC
- **Origin:** Minneapolis-based, very active in DSM
- **Specialty:** Industrial + mixed-use

### The Weitz Company
- **Role:** GC
- **Origin:** DSM-based with national presence

### Neumann Brothers
- **Role:** Regional GC

### Story Construction
- **Role:** Regional GC
- **Origin:** Ames

### Henkel Construction
- **Role:** Regional GC

### Edge Commercial
- **Role:** Regional GC

---

## Validation tests for the entity-normalizer

When the fuzzy-matcher is built, it should pass these tests:

1. **LLC → parent collapse:** Multiple project-specific LLCs ("Dunn Property Plat 3 LLC", "Walnut Creek Industrial LLC", "Norwalk JV22 LLC") that share a registered agent + managing member in Iowa SOS should collapse to a single parent entity row.

2. **Repeat-relationship detection:** Given 14 historical permits in the corpus where "Hubbell" appears as owner and "Weitz" appears as GC, the relationships table should show `{owner: Hubbell, gc: Weitz, count: 14}`.

3. **Cross-source linking:** A signal from a P&Z minute that mentions "Norwalk JV22 LLC" in March, and a permit from EnerGov in May that names "Norwalk JV22 LLC" at the same address, should be linked as one project with two corroborating signals.

4. **Counterparty surfacing:** When a new permit is added with `owner=Hubbell`, the UI should suggest "frequent GC partners: Weitz, Ryan, Hansen" — pulled from the relationships table.

---

## Adding new entities

When real data flows in and reveals additional repeat-relationships, add them
here. The list is the source of truth for what the normalizer should be able
to collapse. Use the same format:

```
### {Canonical Name}
- **Role:** {Developer | Owner | GC | Architect | MEP | Engineer | Broker}
- **Notable:** {context, board roles, recent deals}
- **LLC patterns:** {known aliases or naming conventions}
- **Frequent counterparties:** {if known}
```
