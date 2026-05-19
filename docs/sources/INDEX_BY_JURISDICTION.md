# Sources by Jurisdiction — Per-City Reference

Tier indicator:
- **TIER 1** — high commercial activity, prioritize first
- **TIER 2** — moderate activity, second wave
- **TIER 3** — low volume, cover via county-level scraping
- **INST** — institutional (university, K-12, healthcare) capital projects

---

## Polk County

### Des Moines · **TIER 1**
The largest, most data-rich jurisdiction. Tyler EnerGov + Revize CMS + Polk Assessor.

- **CSS / EnerGov Permit Portal** (Stage 5–7): `https://css.dmgov.org/EnerGov_Prod/SelfService`
- **Development Services hub**: `https://www.dsm.city/departments/development_services/`
- **P&Z Commission agendas** (Stage 3–4): Revize CMS, PDF packets
- **City Council agendas**: `https://www.dsm.city/` → Government → City Council
- **MUNIS ESS** (vendor payments): `https://webmunis.dmgov.org/ess/`
- **Polk County Assessor** (Stage 2 + 8): `https://www.assess.co.polk.ia.us/`
- **Polk County Atlas** (ArcGIS REST): `https://atlas.polkcountyiowa.gov/`

### West Des Moines · **TIER 1**
Microsoft/Apple/Meta data-center cluster. Most-active commercial market in IA.

- **City Access Portal (CAP)** (Stage 5–7): OpenGov likely
- **Monthly Permit Reports (PDF)** (Stage 6): `https://www.wdm.iowa.gov/government/development-services/building-inspection/building-permit-reports`
- **P&Z Commission** (Stage 3–4): meets monthly
- **WDM Economic Development**: chamber + local agencies
- **Dallas County Assessor / Polk County Assessor**: depends on parcel location

### Ankeny · **TIER 1**
Fastest-growing city of its size. Amazon, FedEx, Casey's HQ, Vermeer-adjacent.

- **Ankeny One Stop Permit Portal** (Stage 5–7): Tyler EnerGov OR MyGov — fingerprint at crawl
- **Building Permit Reports** (Stage 6): `https://www.ankenyiowa.gov/368/Building-Permit-Reports`
- **Agenda Center** (Stage 3–4): CivicPlus, RSS feeds available — **already added to system 2026-05-15**
- **Ankeny Economic Development Corp**: `https://www.ankenyedc.com/`

### Urbandale · **TIER 1**
Cloud permit portal. CivicPlus CMS for site.

- **Permit Applications & Portal** (Stage 5–7): MyGov or Citizenserve — fingerprint
- **P&Z Commission**: `https://www.urbandale.org/340/Planning-Zoning-Commission` — **already added 2026-05-15** (175 dated PDFs found)
- **Plats & Site Plans**: `https://www.urbandale.org/482/Plats-Site-Plans`
- **Municipal Code (AmLegal)**: cross-reference zoning districts

### Bondurant · **TIER 1**
Meta data center + new $102.7M Vermeer facility (IEDA Feb 2026).

- **CivicClerk fallback** (already wired by Codex 2026-05-15) — 50 docs found
- Hardcoded tenant: `bondurantia`
- Watch IEDA announcements for new megadeals

### Johnston · **TIER 2**
Permit intake partly email/PDF.

- **CivicPlus Agenda Center** (Stage 3–4): `https://www.cityofjohnston.com/AgendaCenter` — **added 2026-05-15**
- Site plan procedure: `https://www.cityofjohnston.com/112/Site-Plan`
- Building permits: email/PDF model — Stage 5–6 weak

### Altoona · **TIER 2**

- **Citizenserve portal** (Stage 5–7): `https://www.citizenserve.com/altoona/` — Installation ID **352**
- **Altoona Now! blog** (Stage 6 narrative): `https://altoonanow.org/category/building-permits/feed/` (RSS)
- **City Council + P&Z agendas**: agenda center
- **Code of Ordinances (AmLegal)**: cross-reference

### Pleasant Hill · **TIER 2**
- Likely CivicPlus + portal under "Development Services" — **added to system 2026-05-15**

### Clive · **TIER 2**
- Likely Citizenserve or MyGov for permits (Hickman/University growth)
- P&Z + Council on CivicPlus

### Grimes · **TIER 2**
- Northwest Beltway corridor — high commercial growth
- **CivicPlus Agenda Center** — **added 2026-05-15**

### Windsor Heights · **TIER 3**
- Small. Email/PDF intake common.
- P&Z agendas via Agenda Center — **added 2026-05-15**

### Polk City · **TIER 3**
- Cloudflare bot protection on `polkcityia.gov` — needs Playwright
- Email/PDF intake

### Polk County small cities — **TIER 3**
Mitchellville, Runnells, Sheldahl, Alleman, Elkhart, Granger — cover via:
- **Polk County GIS Atlas** for parcel-level overlays
- **Polk County Recorder via Iowa Land Records**
- Each city's CivicPlus Agenda Center

---

## Dallas County

### Waukee · **TIER 1**
New permit system 2024, cloud portal.

- **Permits & Applications** (Stage 5–7): OpenGov or MyGov likely
- **Community Development map**: `https://waukee.org/135/Community-Development` — interactive project map (scrape underlying data layer)
- **Monthly Permit Reports (PDF)** (Stage 6): `https://www.waukee.org/478/Monthly-Permit-Reports`
- **P&Z Commission** (CivicPlus Agenda Center) — **added 2026-05-15**
- **Municipal Code (AmLegal)**

### Adel · **TIER 3**
Growing along Highway 6. PDF permit intake, agendas on CivicPlus.

### Perry · **TIER 3**
Tyson Foods plant closure 2024, active redevelopment.

### Dallas County (unincorporated + small cities) · **TIER 2**
- **Dallas County Assessor / Schneider Beacon**: `AppID=909`
- **Dallas County P&Z + Board of Supervisors** (CivicPlus)
- Small cities (Dallas Center, Van Meter, De Soto, Redfield, Woodward, etc.): cover via county

---

## Warren County

### Indianola · **TIER 1**

- **Online Permitting Software** (Stage 5–7): Citizenserve or MyGov likely
- **Land Use Change Application** + **Site Development Application**: linked from Permits page
- **CivicPlus Agenda Center** — **added 2026-05-15**

### Norwalk · **TIER 2**
- **Citizen Portal** referenced — likely Citizenserve
- **CivicLive (PowerSchool) CMS** for main site
- **Already integrated** — direct PDF list from `/government/agenda___minutes.php`

### Carlisle · **TIER 3**
- **Direct PDF listing** at `https://www.carlisleiowa.org/minutes-and-agendas` — **added 2026-05-15**

### Warren County (small cities) · **TIER 3**
- Cumming, Hartford, Lacona, Martensdale, Milo, New Virginia, Sandyville, Spring Hill: cover via county
- **Warren County P&Z**: `https://www.warrencountyia.gov/government/business-and-planning/zoning/`
- **Vanguard CAMA**: `https://warren.iowaassessors.com/`

---

## Madison County · **TIER 3**

- Winterset (county seat) — PDF intake, agendas on city site
- Small cities (Earlham, St. Charles, Truro, Macksburg, Patterson, Bevington, Peru): cover via county
- **Vanguard CAMA**: `https://madison.iowaassessors.com/`

---

## Story County

### Ames · **TIER 1**
ISU drives significant institutional construction.

- **License & Permits hub** (Stage 5–7): `https://www.cityofames.org/Doing-Business/License-Permits`
- Granicus CMS — mixed email/PDF + portal
- P&Z, ZBA, City Council — Granicus/Legistar pattern

### Iowa State University (Ames) · **INST · TIER 1**
- **FP&M Bid Dates**: `https://www.fpm.iastate.edu/construction_projects/bid_dates.asp` — **CRITICAL SOURCE**
- **ISU Procurement / ISUBid**: `https://supplier.procurement.iastate.edu/isubid/construction`
- **Bid Express** (`bidx.com`) for some lettings

### Story County small cities · **TIER 3**
Huxley, Slater, Cambridge, Maxwell, Collins, Kelley, Sheldahl, Zearing — cover via county

---

## Jasper County

### Newton · **TIER 2**
Former Maytag site, Iowa Speedway, wind-energy supply chain.

- **CivicPlus Agenda Center** (Stage 3–4): primary intelligence
- Building permits: **PDF/email intake** — no portal observed

### Jasper County (small cities) · **TIER 3**
Colfax, Mingo, Prairie City, Monroe, Reasnor, Sully, Baxter, etc. — county-level coverage

---

## Marion County

### Pella · **TIER 1**
**Vermeer Corp HQ + Pella Corp HQ.** Drove the Feb 2026 IEDA Bondurant expansion.

- P&Z: `https://cityofpella.com/194/Planning-Zoning`
- **No portal** — permit intake via Building Official direct (Jerry Byers, 641.628.0043)
- Rely on agendas

### Knoxville · **TIER 3**
- **CivicPlus** patterns, P&Z + Council on Agenda Center
- PDF permit intake

### Marion County (small cities) · **TIER 3**

---

## Boone County · **TIER 3**

### Boone (city)
- CivicPlus + PDF permit intake

### Boone County small cities (Madrid, Ogden, Luther, Beaver)
- Madrid closest to Polk County line — most likely metro spillover

---

## Guthrie County (eastern) · **TIER 3**

### Stuart, Panora, Guthrie Center, etc.
- Sit along I-80 western edge of reach
- PDF permit intake, county coverage primary

---

## Institutional (cross-county)

### K-12 Bond-funded Capital Projects · **INST · TIER 1**

| District | 2025 Bond | URL |
|---|---|---|
| **Des Moines Public Schools** | $265M (Nov 2025 — 73.6% yes) | `https://www.dmschools.org/departments/operations/long-range-planning/...` |
| **West Des Moines CSD** | $135M (Nov 2025 — 69%+ yes) | `https://www.wdmcs.org/` |
| **Ankeny Community Schools** | $130M (Nov 2025) — "Innovative Hub" | `https://www.ankenyschools.org/` |

Plus Waukee, Johnston, Urbandale, SE Polk, Norwalk, Indianola, Pella, Newton, Knoxville, Ames, Boone CSDs — continuous capital pipelines.

### Higher Ed · **INST · TIER 1**
- **DMACC**: multi-campus, recurring projects
- **Drake University Facilities**
- **Simpson College (Indianola)**
- **Central College (Pella)**
- **Grand View University (Des Moines)**

### Transit / Airport / Utility · **INST · TIER 1**
- **DART** (Des Moines Area Regional Transit)
- **Des Moines International Airport (DSM)** — $500M+ terminal replacement
- **Ankeny Regional Airport**
- **Des Moines Water Works**
- **MidAmerican Energy** — track via IUB/IUC filings
- **Iowa Finance Authority** — affordable housing tax credits

---

## State-level (cross-jurisdiction) feeds

These are foundational — they run as background feeds across all jurisdictions.

- **IEDA news** (Stage 1): `https://opportunityiowa.gov/about/news`
- **Iowa Governor announcements** (Stage 1): `https://governor.iowa.gov/press-releases`
- **Iowa DOT Lettings** (Stage 5–6 horizontal): `https://iowadot.gov/consultants-contractors/contracts/current-lettings`
- **Iowa DAS Bidding Opportunities**: `https://bidopportunities.iowa.gov/`
- **Iowa SOS Business Search** (Stage 1–2): `https://sos.iowa.gov/search/business/search.aspx`
- **Iowa Land Records** (Stage 2): `https://iowalandrecords.org/`
- **IDNR Air Quality Permits** (Stage 3 industrial): `https://idnraqrr.iowadnr.gov/ConPermitSearch/ConstructionPermit`
- **Greater DSM Partnership** (Stage 1): `https://www.dsmpartnership.com/`
- **Trade media** (Stage 1): Business Record, Des Moines Register, Axios Des Moines

---

## Status snapshot (as of 2026-05-15)

### Working in production right now

- Norwalk (Council + P&Z)
- Des Moines (Council Docs + Meetings page)
- Clive (Council + P&Z)
- Altoona (Council + P&Z) — via direct PDF, not yet Citizenserve
- Carlisle (Council + P&Z)
- Urbandale (Agenda Center — CivicPlus)
- Pleasant Hill (Agenda Center)
- Grimes (Agenda Center)
- Indianola (Agenda Center)
- Waukee (Agenda Center)
- Windsor Heights (Agenda Center)
- Johnston (Agenda Center)
- Ankeny (CivicClerk fallback)
- Bondurant (CivicClerk fallback — Codex 2026-05-15)

### Highest-value next adds

- Des Moines via Tyler EnerGov CSS — Stage 5–7 permit data (Phase 5J)
- Altoona via Citizenserve — Stage 5–7 permit data
- WDM via OpenGov — Stage 5–7
- Waukee via OpenGov — Stage 5–7
- IEDA press releases — Stage 1 (Phase 5Q)
- ISU FP&M bid dates — Stage 5–6 institutional
- Iowa DOT lettings — Stage 5–6 civil
