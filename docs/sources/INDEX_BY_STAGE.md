# Sources by Pipeline Stage — Intelligence Value Reference

Every record we ingest gets tagged with one of these 8 stages. Earlier stages
= higher intelligence value but lower certainty.

**Strategic principle:** Stages 1-3 are where Groundworx earns its keep —
by the time a permit issues (Stage 6), Dodge + ConstructConnect already
have it. The differentiated value is harvesting **P&Z agendas + council
consent items at Stage 3-4** before commercial buyers see them.

---

## Stage 1 — Rumor / News
**Lead time: 12–36 months · Certainty: low**

What triggers a Stage 1 signal: earnings-call mention, broker tour, press
leak, IEDA award teaser, LinkedIn job posting for "site superintendent — [city]".

| Source | URL | Notes |
|---|---|---|
| Greater DSM Partnership | `https://www.dsmpartnership.com/` | Tracks 140+ active project leads ($5.7B capital investment underway as of Jan 2026) |
| Partnership press releases (PR Newswire mirror) | `https://www.prnewswire.com/news/greater-des-moines-partnership/` | Easy RSS scrape |
| **IEDA news** | `https://opportunityiowa.gov/about/news` | **Highest-value Stage 1 source.** Monthly board approvals (3rd Friday) name company, location, sq ft, capital investment, tax credit. URL pattern: `/press-release/[YYYY-MM-DD]/[slug]` |
| Iowa Governor announcements | `https://governor.iowa.gov/press-releases` | Largest deals ($250M+) often released here first |
| Business Record (Des Moines) | `https://www.businessrecord.com/` | Primary trade source; daily newsletter; "Real Estate Insider" section |
| Des Moines Register Business | `https://www.desmoinesregister.com/business/` | Mainstream business reporting |
| Axios Des Moines | `https://www.axios.com/local/des-moines` | Newsletter with significant project coverage |
| Iowa Capital Dispatch | `https://iowacapitaldispatch.com/` | Statewide policy + project reporting |

---

## Stage 2 — Site Assemblage / Recording
**Lead time: 9–18 months · Certainty: medium**

What triggers: title transfer, LLC formation, option-to-purchase recording, plat of survey.

| Source | URL |
|---|---|
| **Iowa SOS Business Search** | `https://sos.iowa.gov/search/business/search.aspx` (LLC formations — often 30-90 days before site work) |
| Iowa Land Records (statewide recorder) | `https://iowalandrecords.org/` |
| Polk County Auditor Real Estate | `https://www.polkcountyiowa.gov/county-auditor/property-tax/real-estate-records/` |
| Polk County Assessor | `https://www.assess.co.polk.ia.us/` |
| Polk County Atlas (ArcGIS) | `https://atlas.polkcountyiowa.gov/` — has REST FeatureServer endpoints |
| Dallas County Beacon | `https://beacon.schneidercorp.com/Application.aspx?AppID=909&...` |
| Vanguard CAMA (all county assessors) | `https://{county}.iowaassessors.com/` |

---

## Stage 3 — Rezoning / Concept Plan / Pre-App
**Lead time: 6–15 months · Certainty: medium-high**

What triggers: rezoning petition, comp plan amendment, sketch plan submitted.

| Source | Type | Notes |
|---|---|---|
| **P&Z Commission agendas** | CivicPlus Agenda Center across most cities | **Highest-yield source in the entire system** |
| City Council first readings | CivicPlus / CivicLive / Revize | Rezonings appear in council 2nd reading after P&Z recommends |
| Board of Adjustment dockets | CivicPlus | Variances, special-use permits |
| Pre-application meeting calendars | Per-city (when posted) | Some cities post these; most don't |
| **IDNR Air Quality permits** | `https://idnraqrr.iowadnr.gov/ConPermitSearch/ConstructionPermit` | Industrial early-warning — filed before building permit |

---

## Stage 4 — Site Plan / Subdivision Approval
**Lead time: 3–9 months · Certainty: high**

What triggers: site plan filed, preliminary plat approved, conditional use permit granted.

| Source | Type |
|---|---|
| P&Z minutes (decisions) | Same agendas as Stage 3, but with vote outcomes |
| City Council consent agendas | CivicPlus / CivicLive / Revize |
| Engineering plan-review portals | OpenGov / Citizenserve where available |
| COSESCO / SWPPP filings | IDNR + city engineering |

**Note:** Existing scraper extracts both Stage 3 and Stage 4 signals from the
same P&Z documents — the only difference is the `status` field (DISCUSSED vs APPROVED).

---

## Stage 5 — Building Permit Application
**Lead time: 1–4 months · Certainty: high**

What triggers: commercial building permit application filed (often pre-issuance).

| Source | Type | Coverage |
|---|---|---|
| **Tyler EnerGov CSS portals** | API-like POST search | Des Moines (likely Ankeny) |
| OpenGov Permitting portals | SPA + Playwright fallback | WDM, Waukee likely |
| Citizenserve portals | HTML pagination | Altoona, Indianola, Norwalk likely |
| MyGov portals | Per-city | Some smaller cities |
| Iowa DOT Lettings (horizontal) | ZIP downloads | Statewide DOT projects |
| Iowa DAS Bidding | `https://bidopportunities.iowa.gov/` | State agency bids |

---

## Stage 6 — Permit Issuance
**Lead time: 0–2 months · Certainty: high**

What triggers: permit issued, valuation finalized, GC of record named.

| Source | Type |
|---|---|
| Monthly permit reports (PDF/XLSX) | Per-city — WDM, Ankeny, Waukee, Altoona publish |
| CSS portal "Issued" filter | EnerGov / OpenGov / Citizenserve search filter |
| Iowa DOT bid tabs | `https://iowadot.gov/contracts/historical-completed-lettings/bid-tabs` |
| **Altoona Now! blog feed** | `https://altoonanow.org/category/building-permits/feed/` — RSS with aggregated narrative |

---

## Stage 7 — Inspections
**Lead time: active construction · Certainty: confirmed**

| Source | Notes |
|---|---|
| Inspection schedules on CSS portals | Queryable by permit # |
| **Iowa Mechanic's Notice and Lien Registry (MNLR)** | `https://mnlr.iowa.gov/` — preliminary lien notices filed within ~30 days of sub mobilization. Best way to discover the full sub-tier of a job (mech, elec, plumbing, fire suppression, drywall). Searchable by property, claimant, owner. |

---

## Stage 8 — Certificate of Occupancy
**Lead time: project complete · Certainty: confirmed**

| Source | Notes |
|---|---|
| CSS portals | C of O issuance |
| Iowa Alcoholic Beverage Division | License issuance for restaurants/retail (proxy for build completion) |
| Vanguard CAMA (assessor) | New-build pickup when added to roll |

---

## Cross-stage: Cross-Reference Strategy

The killer feature of having multiple stages populated is **lead reconciliation**:

- Stage 1 IEDA award names "XYZ Industrial LLC"
- Stage 2 Iowa SOS shows "XYZ Industrial LLC" formed 60 days later, registered agent X
- Stage 3 P&Z agenda mentions "XYZ Industrial LLC requests rezoning at 123 Main St"
- Stage 5 EnerGov shows permit applied at 123 Main St, XYZ Industrial LLC, valuation $4.2M, GC = Smith Construction
- Stage 6 Permit issued — confirmation that Smith Construction won the job
- Stage 7 MNLR shows preliminary lien notices from Acme Electrical, Smith MEP, and others — the full sub-tier surfaces

Each cross-match adds confidence. By Stage 5-7, the lead is a CONFIRMED project
with a named GC AND named subs — actionable competitive intelligence even
without ever attending the meeting.

This is Phase 5M (lead reconciliation) on the roadmap. See
[ENTITIES_WATCHLIST.md](./ENTITIES_WATCHLIST.md) for the seed list of repeat-
relationship entities used to validate the entity-normalizer.

## 80% / 20% target

With Tier 1 sources running + entity normalization layer, ~80% of commercial
projects in the Des Moines MSA should be detectable at Stage 3 or earlier —
ahead of where Dodge and ConstructConnect typically pick them up at Stage 5-6.

Remaining ~20% (private corporate self-perform, design-build with no public
bidding, owner-direct work in small jurisdictions) requires human intelligence
and direct relationships, not scraper coverage.
