# Source Build Phases — Roadmap Mapping

Maps the full source catalog to the phased build plan. Each phase delivers a
distinct chunk of value; pick the next one based on what unlocks the most
sources for the least adapter work.

---

## Phase 5I — Market Intelligence Scraper Foundation · ✅ SHIPPED

Existing scraper handles direct-PDF listings, CivicPlus Agenda Center, CivicClerk
fallback (added by Codex 2026-05-15). 15 sources live across Des Moines metro.

---

## Phase 5J — Tyler EnerGov Adapter · **highest ROI, next**

Add `sourceType: energov` to MarketSource. Use the EnerGov public API
(POST `/api/energov/search/public`) for structured data.

**Cost:** $0 LLM for primary extraction (data is structured JSON).
**Cities unlocked:** Des Moines (confirmed), Ankeny (probable).
**Effort:** 1 session.

Build order within phase:
1. Sidecar router `/market/scrape-energov` with paginated search
2. Module priority: **Plan first** (pre-permit), then Permit, then Project
3. Targeted detail-fetch policy: valuation > $1M OR commercial keyword match OR record type = "Plan" AND <30 days old
4. Incremental delta — track `lastEnteredDate` per source, pass as `EnteredDateFrom`
5. Tier 0 scoring (rules) for 95%+; Tier 1 (Ollama summary) for borderline; Tier 2 (Claude) for 1-2% ambiguous high-value

---

## Phase 5K — P&Z Prompt + UX Upgrades · **small, high-value parallel work**

No new sources. Improvements to the existing scraper based on the P&Z workflow diagram:

1. Add `signalSubtype` to Claude prompt: `SUP_CUP | REZONING | PLAT | VARIANCE | SITE_PLAN | OTHER`
2. Tighten status enum: `APPROVED | CONTINUED | DENIED | DISCUSSED_NO_VOTE`
3. When status=CONTINUED, auto-emit a watch task pointing at next meeting date
4. Owner/architect name extraction → auto-link to existing RelationshipEdge graph + "repeat developer" badge

**Effort:** ~30 lines of prompt + persist-layer changes.
**Order:** can ship before or alongside 5J.

---

## Phase 5L — Plan-room (Beeline) Workflow · **user's stated #1 priority**

Authenticated plan-room scraper + risk overlay. Detailed plan in CURRENT_STATE.md.

**Pre-reqs:**
- Credential vault + Settings tab (in queue, green-lit)
- Login workflow per platform
- Storage architecture (in queue, green-lit) for big spec book + drawing PDFs

**Sub-phases:**
- 5L-1: Auth + catalog scraping
- 5L-2: Watch list + doc download
- 5L-3: Risk overlay analysis

**Effort:** 3 sessions.

---

## Phase 5M — Cross-Source Lead Reconciliation · **needs 5J + 5L first**

Match records across sources to create high-confidence leads:

- Fuzzy entity matching on `(owner_name, location)` across MarketSignal records
- Auto-promotion: lead status `PENDING` → `CONFIRMED` when permit corroborates earlier P&Z signal
- Relationship graph gets explicit "GC selected" edge when permit names contractor
- Repeat-client surfacing: "Hubbell Realty has filed 8 projects in last 18 months"

**Effort:** 1-2 sessions. Pure data layer.

---

## Phase 5N — Assessor + Recorder Adapters

Stage 2 coverage — site-assemblage signals.

- **Vanguard CAMA adapter** (all 9 counties in footprint share the same UI):
  Polk · Dallas · Warren · Madison · Story · Jasper · Marion · Boone · Guthrie
- **Schneider Beacon adapter** for Dallas County (and any other Beacon counties found)
- **ESRI ArcGIS REST adapter** for Polk County Atlas (and any other published REST endpoints)

**Effort:** 1 session per platform, but one platform = all 9 counties.

---

## Phase 5O — Iowa Land Records Adapter

Statewide recorder consortium. Deed + mortgage + lien filings.

**Cost concern:** Pay-per-search or subscription. Use selectively for Stage 2
signals only — drive lookups from previously surfaced leads, not bulk crawl.

**Effort:** 1 session + ongoing cost management.

---

## Phase 5O-2 — Iowa MNLR Adapter (Mechanic's Notice and Lien Registry)

URL: `https://mnlr.iowa.gov/`. Preliminary lien notices filed by every
subcontractor mobilizing on a commercial project, within ~30 days of starting
work. Searchable by property / claimant / owner.

**Why it matters:** This is the single best source for the **sub-tier graph**.
Permit feeds name the GC; MNLR fills in the mechs, electricals, plumbing,
fire suppression, drywall, etc.

**Cost:** Free (state-run public registry).

**Effort:** 1 session.

**Pairs with 5M (reconciliation):** when a permit names a GC and the same
property shows up in MNLR with subs, the relationship graph gets the full
project cast.

---

## Phase 5P — Iowa DOT + DAS Bid Lettings Adapter

Horizontal/civil work + state agency procurement.

- Iowa DOT Lettings: `https://iowadot.gov/consultants-contractors/contracts/current-lettings`
- Iowa DOT Bid Tabs (post-award): `https://iowadot.gov/contracts/historical-completed-lettings/bid-tabs` — critical for GC win-rate tracking
- Iowa DAS: `https://bidopportunities.iowa.gov/`
- IMPACS / SciQuest

**Effort:** 1 session for DOT, separate session for DAS.

---

## Phase 5Q — Press Release + News Watcher (Stage 1 feed)

The earliest-signal layer. RSS where available, scrape where not.

Sources:
- IEDA news (highest yield): `https://opportunityiowa.gov/about/news`
- Iowa Governor press: `https://governor.iowa.gov/press-releases`
- Greater DSM Partnership announcements + PR Newswire mirror
- Business Record RSS
- Axios Des Moines
- IDNR Air Quality permit-issuance feed

Run as a separate background job. Cheap — RSS parsing, no LLM unless we want
to classify/score press releases.

**Effort:** 1 session.

---

## Phase 5R — OpenGov + Citizenserve + MyGov Adapters

Once Tyler EnerGov pattern is proven (5J), other portal platforms become similar work.

- **OpenGov Permitting**: WDM, Waukee
- **Citizenserve**: Altoona (ID 352), likely Indianola, Norwalk
- **MyGov**: possible Ankeny, Urbandale

**Effort:** 1 session per platform.

---

## Phase 5S — Institutional / K-12 Capital Project Feeds

- ISU FP&M bid dates page (well-structured, easy scrape)
- DMACC procurement pages
- K-12 district board agendas (DMPS, WDMCS, Ankeny CSD — all just passed bonds)
- DART, DSM Airport, DMWW procurement pages

**Effort:** 1 session for ISU + DMACC; school district board agendas can fold
into the existing CivicPlus Agenda Center workflow.

---

## Recommended sequence

Reconciling with the source-map "Tier 1 / 2 / 3" ordering from the canonical
document:

| Build phase | Source-map tier | Notes |
|---|---|---|
| **5K** (P&Z prompt upgrades) | n/a (existing scraper) | Ship while 5J in progress |
| **5J** (Tyler EnerGov adapter) | T1 #4 (DSM CSS) | Unlocks Des Moines + likely Ankeny |
| **5Q-a** (IEDA/Partnership/Gov press) | T1 #1 | Stage 1, cheap, high-yield |
| **5P-a** (Iowa DOT lettings) | T1 #2 | Civil/horizontal, predictable URLs |
| **5P-b** (Iowa DAS Bidopportunities) | T1 #3 | State agency bids |
| **5J-WDM** (OpenGov adapter for WDM) | T1 #5 (monthly PDF reports first) | Start with PDF reports, layer OpenGov later |
| **5N-Polk** (Polk Atlas ArcGIS) | T1 #6 | REST endpoints — easiest Stage 2 |
| **5K-RSS** (CivicPlus RSS feeds bulk) | T1 #7 | Many cities at once |
| **5Q-b** (Business Record RSS) | T1 #8 | Stage 1 narrative |
| **5L** (Beeline + risk overlay) | n/a — user-stated #1 | Multi-session, requires credential vault |
| **5R** (Citizenserve + MyGov adapters) | T2 #9-11 | Altoona, Waukee, Ankeny, Urbandale |
| **5J-DNR** (IDNR Air Quality) | T2 #12 | Industrial early-warning |
| **5J-SOS** (Iowa SOS LLC formation) | T2 #13 | Stage 1-2 entity precursor |
| **5N-Vanguard + Beacon** | T2 #14 | All 9 county assessors |
| **5S-ISU** (ISU FP&M bid dates) | T2 #15 | Institutional |
| **5R-Norwalk** (Indianola/Norwalk/Newton/Pella) | T3 #16 | Lower volume |
| **5S-K12** (school district board PDFs) | T3 #17 | DMPS/WDM/Ankeny/Waukee/Johnston post-bond |
| **5S-Transit** (DART/DSM Airport/DMWW) | T3 #18 | Limited bandwidth |
| **5O** (Iowa Land Records) | T3 #19 | Cost-gated; use selectively |
| **5O-2** (Iowa MNLR) | T3 #20-like | Free; sub-tier graph |
| **5M** (Cross-source reconciliation) | parallel to above | Entity normalization layer — see ENTITIES_WATCHLIST.md |
| **Trade-association directory backfill** | T3 #20 | One-time graph backfill |

**Critical parallel workstream**: The **entity-normalization layer** runs alongside
all Tier 1 work. Without it, the same project shows up as 5 different LLC names
across 5 sources. With it, those 5 records collapse to one project + relationship
graph. See [ENTITIES_WATCHLIST.md](./ENTITIES_WATCHLIST.md) for the seed validation set.

**Acceptance target**: 80% of commercial DSM-MSA projects detected at Stage 3
or earlier, ahead of Dodge/ConstructConnect.
