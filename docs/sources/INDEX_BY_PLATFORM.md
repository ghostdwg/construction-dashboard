# Sources by Platform — Adapter Design Reference

One adapter per platform unlocks every city on that platform. This index is
ordered roughly by **expected ROI per adapter built** (high-volume platforms
that cover many cities first).

Status legend:
- **CONFIRMED** — fingerprinted in the wild
- **LIKELY** — UX and URL patterns match; re-fingerprint at first crawl
- **POSSIBLE** — vendor unknown; needs probing

---

## 1. Tyler EnerGov CSS — *highest priority for Phase 5J*

Public ASP.NET portal, predictable URL params, HTML table results.
Backend behaves like an undocumented REST API (POST to `/api/energov/search/public`).

| Jurisdiction | URL | Status | Notes |
|---|---|---|---|
| **Des Moines** | `https://css.dmgov.org/EnerGov_Prod/SelfService` | CONFIRMED | Largest, most data-rich. Branded "Customer Self Service (CSS)" |
| Ankeny | `Ankeny One Stop Permit Web Portal` | LIKELY | "One Stop" branding could also be MyGov; fingerprint at first crawl |

**Adapter notes:** No public API contract, but search POST body is stable
across EnerGov installations. Use the existing Codex EnerGov scraper script
as the starting template; adapt to multi-tenant config.

**Cost to integrate:** $0 LLM — JSON-structured fields go straight to MarketSignal.

---

## 2. OpenGov Permitting (formerly ViewPoint Cloud)

Cloud SPA. Public search at `/#/explore`-style URLs. Some pages require
headless browser rendering.

| Jurisdiction | URL | Status |
|---|---|---|
| **West Des Moines** | `https://www.wdm.iowa.gov/government/development-services/city-access-portal-how-to-register` | LIKELY (UX + login flow signatures match) |
| **Waukee** | `https://www.waukee.org/143/Permits-Applications` | LIKELY (new 2024 portal with draft-save, multi-user, in-portal payment) |

**Adapter notes:** SPA = expect Playwright fallback for some pages.

---

## 3. Citizenserve

Multi-tenant, stable installation IDs. URL pattern:
`citizenserve.com/Portal/PortalController?...&installationID={id}` or
`citizenserve.com/{city}/`.

| Jurisdiction | URL | Status | Install ID |
|---|---|---|---|
| **Altoona** | `https://www.citizenserve.com/altoona/` | CONFIRMED | 352 |
| Indianola | `https://www.indianolaiowa.gov/860/Permits-and-Applications` | LIKELY | unknown |
| Norwalk | `Citizen Portal` referenced on city site | LIKELY | unknown |

**Adapter notes:** Throttle to ~1 req/sec. Installation IDs are stable —
register-by-city is enough.

---

## 4. MyGov

Smaller-city focus. URL typically `mygov.us` or `permits.mygov.us`.

| Jurisdiction | URL | Status |
|---|---|---|
| Ankeny | "One Stop" portal | POSSIBLE (or Tyler EnerGov; fingerprint first) |
| Urbandale | `https://www.urbandale.org/469/Permits-Applications` | POSSIBLE (could also be Citizenserve) |

---

## 5. CivicPlus Agenda Center — *already supported by current scraper*

`/{city}.gov/AgendaCenter` with categorized RSS feeds at
`/AgendaCenter/RSS.aspx?CID={category-id}`. **Already in production today**
via the `_DOC_URL_PATTERN` regex + `_MMDDYYYY-id` date parser.

Cities confirmed working with current scraper (Des Moines MSA):

| Jurisdiction | Status | Notes |
|---|---|---|
| **Urbandale** | CONFIRMED | 175 dated PDFs found |
| **Pleasant Hill** | added | uses `pleasanthilliowa.org` (not `cityofpleasanthill.com`) |
| **Grimes** | added | |
| **Indianola** | added | |
| **Waukee** | added | |
| **Windsor Heights** | added | |
| **Johnston** | added | BoardDocs variant; may use CivicClerk on agendas |
| Ankeny | added | CivicClerk fallback engaged automatically |
| Knoxville | available | not yet added |
| Many small Iowa cities | available | many already use this stack |

**Adapter notes:** All sources of this type can be added via the existing
SourcesPanel → Add Source workflow today.

---

## 6. CivicClerk — *Codex added support 2026-05-15*

Sibling to CivicPlus. Agenda data served from `*.api.civicclerk.com/v1/Events`
JSON API (not from the site HTML). Fallback in
`sidecar/routers/market.py:_fetch_civicclerk_candidates` handles this.

| Jurisdiction | URL | Tenant |
|---|---|---|
| **Bondurant** | `https://www.cityofbondurant.com/` | `bondurantia` (hardcoded) |
| **Ankeny** | `https://www.ankenyiowa.gov/129/Agendas-Minutes` | `ankenyia` (extracted from HTML) |
| Johnston | `https://www.cityofjohnston.com/...` | tenant guess `johnstonia` (untested) |
| WDM | `https://www.wdm.iowa.gov/...` | tenant guess `wdmia` (untested) |

**Adapter notes:** Hardcoded `_CIVICCLERK_KNOWN_TENANTS_BY_HOST` table in
[market.py:475](apps/construction-dashboard/sidecar/routers/market.py#L475)
should be externalized to env/settings so non-developers can add cities.

---

## 7. CivicLive (PowerSchool) — *small adapter needed*

Different URL pattern than CivicPlus. Older CMS.

| Jurisdiction | URL |
|---|---|
| Norwalk | `https://norwalk-iowa-gov.hosted.civiclive.com/...` |

---

## 8. Revize CMS

Document-center pattern at `cms2.revize.com/revize/{city}/...`. Well-organized PDFs.

| Jurisdiction | URL |
|---|---|
| Des Moines | docs hosted on Revize CMS, navigable via dsm.city pages |

---

## 9. Vanguard Appraisals CAMA — *all county assessors in IA*

Statewide standard. URL pattern: `{county}.iowaassessors.com`.

| County | URL | Stage |
|---|---|---|
| Polk | `https://www.assess.co.polk.ia.us/` (legacy CGI variant) | 2, 8 |
| Dallas | `https://dallas.iowaassessors.com/` | 2, 8 |
| Warren | `https://warren.iowaassessors.com/` | 2, 8 |
| Madison | `https://madison.iowaassessors.com/` | 2, 8 |
| Story | `https://story.iowaassessors.com/` | 2, 8 |
| Jasper | `https://jasper.iowaassessors.com/` | 2, 8 |
| Marion | `https://marion.iowaassessors.com/` | 2, 8 |
| Boone | `https://boone.iowaassessors.com/` | 2, 8 |
| Guthrie | `https://guthrie.iowaassessors.com/` | 2, 8 |

**Adapter notes:** No public API. HTML scraping with polite throttling.
One adapter = all Iowa counties.

---

## 10. Schneider Geospatial Beacon — *assessor parcel data*

URL: `beacon.schneidercorp.com/Application.aspx?AppID={id}`.
Some installations expose ArcGIS REST FeatureServer endpoints.

| County | URL | AppID |
|---|---|---|
| Dallas | `https://beacon.schneidercorp.com/Application.aspx?AppID=909&LayerID=17429&PageTypeID=2&PageID=7823` | 909 |

---

## 11. ESRI ArcGIS REST — *highest-yield automated source*

REST FeatureServer endpoints expose parcels, zoning, subdivisions, TIF
districts as queryable JSON. **No HTML scraping needed.**

| Entity | URL | Notes |
|---|---|---|
| Polk County Atlas | `https://atlas.polkcountyiowa.gov/` | REST endpoints under `/arcgis/rest/services/...` — fingerprint at crawl |

**Adapter notes:** ArcGIS FeatureServer query interface is well-documented.
Filter by date, bounding box, attribute. Pagination via `resultOffset`/`resultRecordCount`.

---

## 12. Granicus / Legistar — *agenda management*

Two flavors:
- **Granicus**: `{city}.granicus.com` — provides structured agendas + ICS calendars
- **Legistar**: `{city}.legistar.com` — full ordinance tracking

| Jurisdiction | Status |
|---|---|
| Ames | LIKELY Granicus (URL pattern matches `cityofames.org`) |

Iowa cities tend to use the simpler CivicPlus Agenda Center instead.

---

## 13. Iowa DOT Bid Express — *horizontal/civil work*

Official bid submittal platform for Iowa DOT. URL: `https://www.bidx.com/`.

| Source | URL |
|---|---|
| Iowa DOT Lettings | `https://iowadot.gov/consultants-contractors/contracts/current-lettings` |
| Bid Tabs | `https://iowadot.gov/contracts/historical-completed-lettings/bid-tabs` |

**Adapter notes:** Plan downloads are large ZIP files (plans + estimating
proposals). Subscription required for full plan-holder lists; some data
scrapeable from DOT pages directly.

---

## 14. IMPACS / SciQuest — *Iowa state procurement*

SciQuest-hosted: `https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa`

Also: Iowa DAS Bidding Opportunities at `https://bidopportunities.iowa.gov/`

---

## 15. BidNet Direct — *aggregator (subscription)*

URL: `https://www.bidnetdirect.com/iowa`. Aggregates state and local Iowa
gov bids; many smaller cities post here exclusively. Login required for
full details.

---

## 16. PDF / Email Intake — *no portal*

These cities have no queryable permit portal. Primary intelligence path is
P&Z agenda PDFs + monthly council packets.

- Newton (Jasper County)
- Pella (Marion County) — Vermeer/Pella Corp HQ
- Most small jurisdictions across the footprint

**Adapter notes:** Already covered by the existing scraper if the agenda
listing page is parseable. Manual followup required for permit-level info.

---

## 17. Iowa Land Records — *statewide recorder consortium*

URL: `https://iowalandrecords.org/`. Routes to every county Recorder's
office. Deed, mortgage, lien, easement filings.

**Adapter notes:** Pay-per-search or subscription. Highest cost-per-record
in this list — use selectively for Stage 2 (site assemblage) signals.

---

## 18. Iowa DNR Air Quality Construction Permits — *industrial early-warning*

URL: `https://idnraqrr.iowadnr.gov/ConPermitSearch/ConstructionPermit`

Searches air-quality construction permits by city or permit number.
**Critical for industrial/manufacturing project detection** — often filed
*before* the building permit.

---

## 19. Iowa Secretary of State — *LLC formation tracker*

URL: `https://sos.iowa.gov/search/business/search.aspx`. New project LLCs
("XYZ Industrial LLC") are often filed 30-90 days before site work starts.
Stage 1-2.

**Critical for entity normalization:** the registered agent + managing member
on each LLC is the link that collapses single-purpose project LLCs back to
their parent owner. See [ENTITIES_WATCHLIST.md](./ENTITIES_WATCHLIST.md) for
the seed list this normalizer should validate against.

---

## 20. Iowa Mechanic's Notice and Lien Registry (MNLR) — *sub-tier discovery*

URL: `https://mnlr.iowa.gov/`. Iowa requires preliminary lien notices to be
filed in the MNLR. Searchable by property, claimant, or owner.

**Why it matters:** Every commercial project of consequence generates MNLR
filings within ~30 days of subcontractor mobilization. This is the **single
best way to discover the sub-tier of a job** (mech, elec, plumbing, fire
suppression, drywall, etc.) — neither permit feeds nor agendas surface this
relationship cleanly.

**Stage 6–7.** Confirmation of active construction + GC-sub-supplier graph.

**Adapter notes:** Public search portal. Throttle politely; some IA agency
systems have session-based pagination.

---

## Anti-bot considerations summary

- **None observed** on official permit portals during research (May 2026)
- **Iowa Land Records** + some assessor sites: session-based pagination, preserve cookies
- **Citizenserve, OpenGov**: throttle ~1 req/sec or risk throttling
- **ISU FP&M, Iowa DOT**: very large ZIP downloads — fetch on schedule, not continuously
- **Polk City (`polkcityia.gov`)**: Cloudflare bot protection — needs Playwright with cf-clearance
