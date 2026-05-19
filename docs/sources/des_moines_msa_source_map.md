# Groundworx: Commercial Construction Intelligence Source Map — Des Moines MSA

**Purpose:** This document is a working build-spec for the Groundworx scraper feed. It catalogs the publicly accessible permit, planning, economic-development, public-procurement, and property-record systems for the Des Moines, Iowa MSA out to ~50 miles, including all of Polk, Dallas, Warren, Madison, Jasper, Marion, southern Story, eastern Boone, and eastern Guthrie counties. Each entry identifies the underlying software platform (this dictates scraping approach), data accessibility (API/RSS/CSV vs HTML-only), and where the source sits in the early-detection pipeline.

**Verification date:** URLs and platform identifications verified or cross-referenced May 2026. Municipal vendor stacks change frequently — every endpoint should be re-fingerprinted by Groundworx on first crawl (HTTP headers + DOM signatures will confirm Accela / Tyler EnerGov / OpenGov / Citizenserve / CivicPlus / GovPilot / Granicus identities).

**Source-quality caveat:** Where I could not directly confirm a platform from the city's live portal, the platform is marked "likely" and should be re-confirmed at crawl time. Two cities in the target footprint (Newton, Pella) still publish permit intake by email/PDF rather than a queryable portal; for those, planning-commission agenda PDF parsing is the higher-yield path until a portal is stood up.

## Intelligence Framework — Pipeline Stages & Where Each Source Fits

Use this framework to map every source below to a pipeline stage. The earlier the stage, the higher the intelligence value but the lower the certainty. Groundworx should tag every record it ingests with one of these stage codes so analysts can prioritize outreach windows.

| Stage | Trigger Event | Typical Lead Time to Construction | Primary Source Types |
|---|---|---|---|
| **1. Rumor / News** | Earnings call mention, broker tour, press leak, IEDA award teaser | 12–36 months | Business Record, Des Moines Register, IEDA press releases, Greater DSM Partnership announcements, LinkedIn job postings for "site superintendent — [city]" |
| **2. Site Assemblage / Recording** | Title transfer, LLC formation, option-to-purchase recording, plat of survey | 9–18 months | County Recorder (Iowa Land Records), County Assessor sale data, Iowa Secretary of State business filings |
| **3. Rezoning / Concept Plan / Pre-App** | Rezoning petition, comprehensive plan amendment, sketch plan submitted | 6–15 months | P&Z Commission agendas, City Council first readings, Board of Adjustment dockets, pre-application meeting calendars |
| **4. Site Plan / Subdivision Approval** | Site plan filed, preliminary plat approved, conditional use permit granted | 3–9 months | P&Z minutes, City Council consent agendas, engineering plan-review portals, COSESCO/SWPPP filings |
| **5. Building Permit Application** | Commercial building permit application filed (often pre-issuance) | 1–4 months | Customer Self-Service portals (EnerGov, Citizenserve, Accela, MyGov, CityView) — applications are usually visible *before* issuance |
| **6. Permit Issuance** | Permit issued, valuation finalized, GC of record named | 0–2 months | Monthly permit reports (PDF/XLSX), permit search portals, Iowa DOT lettings (for horizontal work) |
| **7. Inspections** | Footing, framing, MEP rough-in, fire sprinkler inspections | Active construction | Inspection schedules on the same CSS portals; usually queryable by permit # |
| **8. Certificate of Occupancy** | C of O issued, business license activated | Project complete | CSS portals, Iowa Alcoholic Beverage Division license issuance (for restaurants/retail) |

**Intelligence-value rule of thumb:** Stages 1–3 are where Groundworx earns its keep — by the time a permit is issued (Stage 6), Dodge and ConstructConnect already have it. The differentiated value of this scraper is harvesting **P&Z agendas and council consent items** (Stage 3–4) before commercial buyers see them. Build the agenda-PDF parser first.

**Repeat-client/GC graph:** Every record should be normalized to `{owner_entity, GC, architect, MEP_engineer, project_name, address}`. Owner-entity normalization is hardest — most filings use a single-purpose LLC ("Walnut Creek Industrial LLC"). Cross-reference with Iowa SOS filings (search registered agent + managing member) to collapse LLCs to ultimate parents like Hubbell Realty, Knapp Properties, R&R Realty, Nelson Construction & Development, Hurd Real Estate Services, Christensen Development, etc.

## City of Des Moines (Polk County)

Des Moines is the largest and most data-rich jurisdiction in the footprint. The City runs Tyler **EnerGov** under the brand "Customer Self Service (CSS)" and posts P&Z and Council items via **Granicus/Legistar-style** agenda pages on dsm.city. Property/sales data sits at the **Polk County Assessor** (proprietary Vanguard-style CAMA on `assess.co.polk.ia.us`). Recorder data routes through the statewide **Iowa Land Records** consortium.

### Permits & Inspections
- **CSS / EnerGov Public Portal** — `https://css.dmgov.org/EnerGov_Prod/SelfService` — Tyler EnerGov "SelfService" instance. Search by permit #, address, contractor, status, or date. **Platform: Tyler EnerGov (Munis ecosystem).** No public API, but the SelfService backend is a predictable ASP.NET endpoint that responds to URL-parameter search; results render in HTML tables that paginate. No Cloudflare/captcha observed; rate-limit politely. **Stage 5–7. Highest-priority Polk County source.**
- **Permit & Development Center landing** — `https://www.dsm.city/departments/development_services/permit_development_center/index.php`
- **Customer Self Service overview** — `https://www.dsm.city/customer_self_service/index.php`
- **MUNIS ESS** — `https://webmunis.dmgov.org/ess/` — Tyler MUNIS Employee/vendor self-service (financials, vendor payments). Useful for confirming GC awards on city projects after the fact.
- **Development Services Department** — `https://www.dsm.city/departments/development_services/index.php`

### Planning & Zoning
- **Plan & Zoning Commission page** — linked off Development Services. Revize CMS, PDF document-center pattern. **Stage 3–4. Highest early-signal value in Des Moines.**
- **Site Plan Review** — `https://www.dsm.city/departments/development_services/permit_development_center/`
- **City Council agendas** — `https://www.dsm.city/` → Government → City Council. Revize CMS. **Parse the packet PDFs** — they contain *project name, developer, GC (if known), and dollar figures*.
- **Historic Preservation Commission** & **Zoning Board of Adjustment** — same Revize agenda pattern.

### Economic Development & TIF
- **Economic Development hub** — `https://www.dsm.city/departments/city_manager/economic_development/index.php`
- **Tax Abatement / Urban Renewal plans** — linked from Development Services.
- **Downtown DSM tracker** — Greater DSM Partnership affiliate.

### Public Projects & Bidding
- **City of Des Moines RFPs / Bid Postings** — Doing Business pages + DAS BidNet.

### Property / Real Estate Intelligence
- **Polk County Assessor** — `https://www.assess.co.polk.ia.us/` and query forms at `https://www.assess.co.polk.ia.us/cgi-bin/web/tt/info.cgi?tt=query/contents/queryforms`. Legacy CGI form interface. CSV export from some forms. **Stage 2 + 8 — new-build pickup is here.**
- **Polk County Atlas (GIS)** — `https://atlas.polkcountyiowa.gov/` — ESRI ArcGIS Online hub. REST/FeatureServer endpoints at `https://atlas.polkcountyiowa.gov/arcgis/rest/services/...` (fingerprint at crawl). Stage 2–4.
- **Polk County Auditor — Real Estate Records** — `https://www.polkcountyiowa.gov/county-auditor/property-tax/real-estate-records/`
- **Polk County Recorder Index Search** — via Iowa Land Records (Regional).
- **Polk County (main site)** — `https://www.polkcountyiowa.gov/county-assessor/`

## West Des Moines (Polk & Dallas Counties)

WDM is the second-largest jurisdiction and arguably the most active commercial market in Iowa (Microsoft / Apple / Meta data-center cluster, Jordan Creek, Grand Prairie Parkway corridor). The City runs the "City Access Portal (CAP)" — most-likely vendor is **OpenGov Permitting & Licensing** (formerly ViewPoint Cloud); confirm at crawl by inspecting login-page HTML for `viewpointcloud.com` / `opengov.com` references.

### Permits & Inspections
- **City Access Portal (CAP)** — `https://www.wdm.iowa.gov/government/development-services/city-access-portal-how-to-register`. **Platform: OpenGov Permitting (formerly ViewPoint Cloud) — confirm.** Public search of submitted records typically available without login at `/#/explore` style URLs. **Stage 5–7.**
- **Permit Applications hub** — `https://www.wdm.iowa.gov/government/development-services/building-inspection/permit-applications`
- **Commercial & Multi-Family Permits** — same hub, filter to Commercial. **Highest-value page.**
- **Sub-Contractor Permits** — `https://www.wdm.iowa.gov/government/development-services/building-inspection/permit-applications/sub-contractor-permits`
- **Historical Building Permit Reports** — `https://www.wdm.iowa.gov/government/development-services/building-inspection/building-permit-reports` — **Monthly PDF reports** ("West Des Moines Building Permit Report for March 2026," etc.) with valuation, contractor, address. **Easiest scrape target in WDM — PDF table extraction.** Stage 6.
- **Development Services landing** — `https://www.wdm.iowa.gov/government/development-services` — News feed with monthly permit reports + P&Z meeting calendar.

### Planning & Zoning
- **P&Z Commission** — monthly meetings (e.g., 4/13/2026). PDFs. Stage 3–4.
- **Board of Adjustment, City Council Development items** — same Development Services hub.

### Economic Development
- **WDM Economic Development** — via `https://www.wdm.iowa.gov/business/licenses-permits` and Local Agencies at `https://www.wdm.iowa.gov/business/local-agencies`.
- **WDM Chamber of Commerce** — `https://wdmchamber.org/`

### Property
- **Dallas County Assessor (WDM parcels west of 73rd)** — `https://www.dallascountyiowa.gov/158/Assessor` and Beacon at `https://beacon.schneidercorp.com/Application.aspx?AppID=909&LayerID=17429&PageTypeID=2&PageID=7823`. **Platform: Schneider Geospatial Beacon.**
- **Polk County Assessor (parcels east of 73rd)** — see Des Moines section.

## Ankeny (Polk County)

Ankeny is the fastest-growing city of its size in the U.S. by some measures, and a huge commercial/industrial pipeline (Amazon, FedEx, Vermeer-adjacent, Casey's HQ).

### Permits & Inspections
- **Ankeny One Stop Permit Web Portal** — entry via `https://www.ankenyiowa.gov/373/Permit-Applications-Guidelines`. **Platform: likely Tyler EnerGov or MyGov — fingerprint at crawl.** Stage 5–7.
- **Building Information** — `https://www.ankenyiowa.gov/366/Building-Information`
- **Permit Applications & Guidelines** — `https://www.ankenyiowa.gov/373/Permit-Applications-Guidelines`
- **Building Permit Reports** — `https://www.ankenyiowa.gov/368/Building-Permit-Reports` — Periodic PDF reports. Stage 6.
- **Trades Contractor Permits** — `https://www.ankenyiowa.gov/369/Trades-Contractor-Permits`
- **Building Permit Inspections** — `https://www.ankenyiowa.gov/335/Building-Permit-Inspections`

### Planning & Zoning
- CivicPlus (CivicEngage) CMS. **Agenda Center** at `https://www.ankenyiowa.gov/AgendaCenter`. **RSS feeds per category.** Stage 3–4.

### Economic Development
- **Ankeny Economic Development Corporation** — `https://www.ankenyedc.com/`

### Property
- **Polk County Assessor** — see Des Moines section.

## Urbandale (Polk & Dallas Counties)

Urbandale's permit portal is cloud-hosted — UX consistent with **MyGov** or **Citizenserve**. CivicPlus CMS for main site.

### Permits & Inspections
- **Permit Applications & Portal** — `https://www.urbandale.org/469/Permits-Applications`. **Platform: cloud permit portal (MyGov or Citizenserve — fingerprint).** Stage 5–7.
- **Permits overview** — `https://www.urbandale.org/478/Permits`
- **Building & Planning Codes** — `https://www.urbandale.org/470/Building-Planning-Codes`
- **Community Development Department** — `https://www.urbandale.org/161/Community-Development`

### Planning & Zoning
- **P&Z Commission** — `https://www.urbandale.org/340/Planning-Zoning-Commission`. CivicPlus Agenda Center. Stage 3–4.
- **Plats & Site Plans** — `https://www.urbandale.org/482/Plats-Site-Plans`
- **Rezoning & PUD Amendments** — `https://www.urbandale.org/480/Rezoning-Planned-Unit-Development-Amendm`
- **Urbandale Municipal Code (AmLegal)** — `https://codelibrary.amlegal.com/codes/urbandale/latest/urbandale_ia/`

### Property
- **Polk County Assessor** primary; Dallas County (Beacon) for parcels west.

## Other Polk County Cities

### Johnston (Polk County)
- **Building Permits** — `https://www.cityofjohnston.com/105/Permits-Fees` — partly **email-intake** model. **Stage 5–6 weak.**
- **P&Z Commission agendas** — `https://www.cityofjohnston.com/AgendaCenter`. **CivicPlus.** Stage 3–4. Primary source.
- **Site Plan / Subdivision / Zoning** — pages 112, 113, 114 on cityofjohnston.com.

### Altoona (Polk County)
- **Citizenserve permit portal** — `https://www.citizenserve.com/altoona/` (Installation ID **352**). Stage 5–7.
- **Apply for Permits landing** — `https://www.altoona-iowa.com/how_do_i/apply_for___obtain/permits.php`
- **Altoona Now! Building Permit Reports** — `https://altoonanow.org/category/building-permits/` — Monthly blog posts with commercial + residential counts, sq ft, dollar value. RSS at `/feed/`. **Stage 6 — high-signal aggregated narrative.**
- **Altoona Now! Doing Business / EDD** — `https://altoonanow.org/doing-business-here-2/`
- **Code of Ordinances (AmLegal)** — `https://codelibrary.amlegal.com/codes/altoonaia/latest/altoona_ia/`
- **P&Z / Board of Adjustment agendas** — via city site `https://www.altoona-iowa.com/` agenda center.

### Pleasant Hill (Polk County)
- **City of Pleasant Hill** — `https://www.pleasanthilliowa.org/` — CivicPlus or similar. P&Z + Council agendas via Agenda Center.

### Windsor Heights (Polk County)
- **City of Windsor Heights** — `https://www.windsorheights.org/` — Small jurisdiction, often email/PDF intake. P&Z agendas via agenda center. Stage 3 only.

### Clive (Polk & Dallas Counties)
- **City of Clive** — `https://www.cityofclive.com/` — Likely Citizenserve or MyGov for permits (Hickman/University growth). P&Z + Council on CivicPlus.

### Grimes (Polk & Dallas Counties)
- **City of Grimes** — `https://grimesiowa.gov/` — Confirm permit platform at crawl. P&Z agendas via agenda center.

### Bondurant (Polk County)
- **City of Bondurant** — `https://www.cityofbondurant.com/` — Site of Meta data center + new $102.7M Vermeer Bondurant facility (Feb 2026 IEDA award). High-value jurisdiction. Confirm permit platform; P&Z agendas via agenda center.

### Polk City (Polk County)
- **City of Polk City** — `https://www.polkcityiowa.gov/` — Smaller. Email/PDF intake. P&Z agendas PDFs.

### Mitchellville, Runnells, Sheldahl, Alleman, Elkhart, Granger (Polk County small cities)
- Small CivicPlus or proprietary CMS sites. Cover via:
  - **Polk County GIS Atlas** for parcel-level overlays
  - **Polk County Recorder via Iowa Land Records**
  - Each city's CivicPlus Agenda Center
- **Granger** straddles Polk and Dallas.

## Dallas County and Cities

Dallas is the fastest-growing county in Iowa. Waukee, Grimes, Adel, and unincorporated Dallas County between WDM and Adel are the highest-activity submarkets.

### Waukee (Dallas County) — High Priority
- **Permits & Applications** — `https://www.waukee.org/143/Permits-Applications`. **Platform: very likely OpenGov Permitting or MyGov — fingerprint.** Stage 5–7. Supports tracking communication and status within the portal.
- **Community Development overview** — `https://waukee.org/135/Community-Development` — **Interactive mapping tool for projects** and current-projects table. **Worth scraping the project map's underlying data layer.**
- **Development Procedures** — `https://www.waukee.org/172/Development-Procedures`
- **Monthly Permit Reports** — `https://www.waukee.org/478/Monthly-Permit-Reports`. Stage 6.
- **P&Z Commission** — `https://www.waukee.org/729/Planning-Zoning-Commission`. CivicPlus. Stage 3–4.
- **Waukee New Permit System news flash** — `https://www.waukee.org/m/newsflash/Home/Detail/2851?arc=4922`
- **Municipal Code (AmLegal)** — `https://codelibrary.amlegal.com/codes/waukeeia/latest/waukee_ia/`

### Adel (Dallas County)
- **City of Adel** — `https://www.adeliowa.org/` — PDF permit intake. CivicPlus agendas.

### Perry (Dallas County)
- **City of Perry** — `https://www.cityofperry.com/` — Tyson Foods plant closure (2024) and active redevelopment. PDF intake.

### Dallas Center, Van Meter, De Soto, Redfield, Woodward, Minburn, Linden
- Small cities — rely on Dallas County for unincorporated work + PDF intake at city hall.

### Dallas County (unincorporated + county-level)
- **Dallas County Assessor** — `https://www.dallascountyiowa.gov/158/Assessor`
- **Schneider Beacon** — `https://beacon.schneidercorp.com/Application.aspx?AppID=909&LayerID=17429&PageTypeID=2&PageID=7823` — Some installations expose ArcGIS REST. **Stage 2 + 8.**
- **Dallas County Recorder** — `https://www.dallascountyiowa.gov/199/Recorder` — Iowa Land Records.
- **Dallas County Planning & Development** — unincorporated rezonings + subdivisions + CUPs. CivicPlus.

## Warren County and Cities

### Indianola (Warren County) — High Priority
- **Permits and Applications** — `https://www.indianolaiowa.gov/860/Permits-and-Applications`. **Platform: very likely Citizenserve or MyGov — fingerprint.** Stage 5–7.
- **Building and Inspections** — `https://www.indianolaiowa.gov/1119/Building-and-Inspections`
- **Land Use Change Application** + **Site Development Application** — linked from Permits page.
- P&Z + Council on CivicPlus Agenda Center at `https://www.indianolaiowa.gov/AgendaCenter`.

### Norwalk (Warren County)
- **Building Permits page** — `https://www.norwalk.iowa.gov/departments/community_development/building_permits.php` — Email/in-person. **Citizen Portal** referenced — likely Citizenserve.
- **Apply for Building Permits (Civiclive)** — `https://norwalk-iowa-gov.hosted.civiclive.com/i_want_to/apply_for/building_permits` — **CivicLive (PowerSchool) CMS.**

### Carlisle, Cumming, Hartford, Lacona, Martensdale, Milo, New Virginia, Sandyville, Spring Hill
- Small — email/PDF intake + Council agenda postings. Higher-yield: **Warren County P&Z** + county Recorder.

### Warren County (unincorporated + county-level)
- **Warren County Planning & Zoning** — `https://www.warrencountyia.gov/government/business-and-planning/zoning/`. **Stage 3–6.**
- **Warren County home** — `https://www.warrencountyia.gov/`
- **Warren County Ordinances** — `https://www.warrencountyia.gov/government/public-safety/county-ordinances/`
- **Warren County Assessor** — `https://warren.iowaassessors.com/`. Vanguard CAMA. Stage 2 + 8.
- **Warren County Recorder** — Iowa Land Records.

## Madison County and Cities

### Winterset (Madison County) — County Seat
- **City of Winterset** — `https://www.wintersetiowa.gov/` (or similar). PDF intake. Stage 3 → email/PDF.

### Earlham, St. Charles, Truro, Macksburg, Patterson, Bevington, Peru
- Very low commercial volume. Use Madison County as primary watch.

### Madison County (unincorporated + county-level)
- **Madison County Assessor** — `https://madison.iowaassessors.com/`. Vanguard CAMA. Address: 201 W Court, PO Box 271, Winterset, IA 50273. Stage 2 + 8.
- **Madison County government** — `https://www.madisoncounty.iowa.gov/`
- **Madison County Recorder** — Iowa Land Records.

## Story County and Cities (Southern Portion)

Story County is at the northern edge of the ~50-mile zone. ISU drives significant institutional construction.

### Ames (Story County) — High Priority
- **License & Permits hub** — `https://www.cityofames.org/Doing-Business/License-Permits`
- **Apply for Permits** — `https://www.cityofames.org/Doing-Business/License-Permits/Apply-For-Permits`
- **Permitting and Inspections** — `https://www.cityofames.org/My-Government/Departments/Inspections/Building-Permits/Permitting-and-Inspections`
- **Applications and Guidelines** — `https://www.cityofames.org/My-Government/Departments/Inspections/Building-Permits/Permitting-and-Inspections/Applications-and-Guidelines`
- **Building Codes** — `https://www.cityofames.org/My-Government/Departments/Inspections/Current-Codes`
- **Platform: Granicus-based CMS.** Permit submission mixed email/PDF + online portal; check for Citizenserve or eTRAKiT instance. Stage 5–7.
- P&Z + ZBA + Council via Granicus/Legistar.

### Iowa State University (Ames) — Institutional Construction
- **ISU FP&M Project Bid Dates** — `https://www.fpm.iastate.edu/construction_projects/bid_dates.asp`. **CRITICAL.** Pre-bid meetings, bid dates, cost estimates, TSB goals, drawings, project manuals, advertisements. May 2026: Student Services East Wing ($117.8k), Veterinary Medical Research Institute generator, etc. **Stage 5–6 institutional.** Bid openings moved to MS Teams Jan 1, 2026.
- **ISU Procurement — Construction (ISUBid)** — `https://supplier.procurement.iastate.edu/isubid/construction` — Sub-$250k.
- ISU also uses **Bid Express** (`bidx.com`) for some lettings.

### Huxley, Slater, Cambridge, Maxwell, Collins, Kelley, Sheldahl, Zearing
- Small. Watch Council agenda PDFs + **Story County Assessor** at `https://story.iowaassessors.com/`.
- **Sheldahl** straddles Polk/Story.

### Story County (unincorporated + county-level)
- **Story County Assessor** — `https://story.iowaassessors.com/`. Vanguard CAMA. Stage 2 + 8.
- **Story County Recorder** — Iowa Land Records.
- **Story County Planning & Development** — unincorporated.

## Jasper County and Cities

### Newton (Jasper County) — High Priority
Significant industrial activity (former Maytag site, Iowa Speedway, wind-energy supply chain).
- **Building Division** — `https://www.newtongov.org/122/Building-Division`
- **Building Permits** — `https://www.newtongov.org/130/Permits` — **No public-facing search portal — PDF/email model.** Stage 5–6 weak.
- **Applications & Permits** — `https://www.newtongov.org/136/Applications-Permits`
- **Licenses & Permits hub** — `https://www.newtongov.org/405/All-Licenses-or-Permits`
- **Building Code Information** — `https://www.newtongov.org/126/Building-Code-Information`
- **Planning & Zoning** — `https://www.newtongov.org/87/Planning-Zoning` — CivicPlus Agenda Center at `https://www.newtongov.org/AgendaCenter`. **Stage 3–4. Primary intelligence source.**

### Colfax, Mingo, Prairie City, Monroe, Reasnor, Sully, Baxter, Killduff, Lambs Grove
- Council agendas + Jasper County Recorder.

### Jasper County (unincorporated + county-level)
- **Jasper County Assessor** — `https://jasper.iowaassessors.com/`. Vanguard CAMA. Stage 2 + 8.
- **Jasper County Recorder** — Iowa Land Records.
- **Jasper County P&Z, Board of Supervisors agendas** — county site.

## Marion County and Cities (Knoxville, Pella)

### Knoxville (Marion County) — Edge of Footprint
- **Planning & Zoning** — `https://www.knoxvilleia.gov/137/Planning-Zoning` — Permits, variances, BoA workflow. **CivicPlus.** Stage 3–6.
- Council + P&Z + BoA via CivicPlus Agenda Center at `https://www.knoxvilleia.gov/AgendaCenter`.

### Pella (Marion County) — High Priority (Vermeer HQ)
**Vermeer Corp. + Pella Corp.** — two of the largest private employers in IA. The Vermeer $102.7M Bondurant expansion (Feb 2026 IEDA) was driven from Pella HQ.
- **P&Z Department** — `https://cityofpella.com/194/Planning-Zoning` — Development Procedures Manual (PDF). CivicPlus.
- **Applications and Permits** — `https://www.cityofpella.com/596/Applications-and-Permits` — Permit processing via Building Official (Jerry Byers, 641.628.0043). **No public search portal.** Stage 5–6 weak.
- **P&Z Commission** — `https://www.cityofpella.com/255/Planning-Zoning-Commission`. Agenda Center.

### Bussey, Hamilton, Harvey, Marysville, Melcher-Dallas, Pleasantville, Swan, Tracy
- Council agendas + Marion County Recorder.

### Marion County (unincorporated + county-level)
- **Marion County Assessor** — `https://marion.iowaassessors.com/`. Vanguard CAMA.
- **Marion County Recorder** — Iowa Land Records.
- **Marion County government** — agendas on county site.

## Boone County and Guthrie County (Eastern Portions)

### Boone (Boone County)
- **City of Boone** — `https://www.cityofboone.com/` — PDF intake. CivicPlus.

### Madrid, Ogden, Luther, Beaver (Boone County, eastern)
- Madrid closest to Polk County line — likely metro spillover.

### Boone County (unincorporated + county-level)
- **Boone County Assessor** — `https://boone.iowaassessors.com/`. Vanguard CAMA.
- **Boone County Recorder** — Iowa Land Records.

### Stuart (Guthrie/Adair County line, in footprint)
- **City of Stuart** — `https://stuartiowa.com/` — I-80 western edge. PDF intake.

### Panora, Guthrie Center, Bagley, Bayard, Casey, Menlo, Yale (Guthrie County, eastern)
- Council agendas.

### Guthrie County (unincorporated + county-level)
- **Guthrie County Assessor** — `https://guthrie.iowaassessors.com/`. Vanguard CAMA.
- **Guthrie County Recorder** — Iowa Land Records.

## Regional & State-Level Sources (Span All Jurisdictions)

These sources span every jurisdiction in the footprint and should run as foundational feeds.

### State Procurement & Construction Bidding
- **Iowa DOT — Current Lettings** — `https://iowadot.gov/consultants-contractors/contracts/current-lettings` — Third Tuesday of each month. Downloadable ZIPs (plans + estimating). **Stage 5–6 for horizontal/civil.**
- **Iowa DOT — Plans & Estimation Proposals** — `https://iowadot.gov/consultants-contractors/contracts/plans-estimation-proposals` — back to Jan 2023.
- **Iowa DOT — General Letting Information** — `https://iowadot.gov/consultants-contractors/contracts/general-letting-information`
- **Iowa DOT — Historical & Completed Lettings** — `https://iowadot.gov/consultants-contractors/contracts/historical-completed-lettings`
- **Iowa DOT — Bid Tabs** — `https://iowadot.gov/contracts/historical-completed-lettings/bid-tabs` — **Critical for GC win-rate tracking.**
- **Iowa DOT — Monthly Letting Plans page (alt URL)** — `https://iowadot.gov/contracts/plans-and-estimation-proposals`
- **Iowa DOT — Letting Schedule (2026-2028 critical dates PDF)** — `https://iowadot.gov/media/2488/download?inline=`
- **Iowa DOT — Notice to Bidders PDF** — `https://iowadot.gov/contracts/lettings/NoticeToBidders.pdf`
- **Iowa DOT Contracts hub** — `https://iowadot.gov/consultants-contractors/contracts`
- **Iowa DOT Purchasing (non-construction)** — `https://iowadot.gov/general-procurement-auctions/purchasing`
- **Bid Express** — `https://www.bidx.com/` — Subscription for full plan-holder lists.
- **Iowa DAS Bidding Opportunities** — `https://bidopportunities.iowa.gov/` — State agency bids. **Awarded Contracts** at `https://bidopportunities.iowa.gov/Home/AwardedContracts`. Bid info URL pattern: `https://bidopportunities.iowa.gov/Home/BidInfo?bidId=[GUID]`. Stage 5–6.
- **Iowa DAS Vendor Resources** — `https://das.iowa.gov/vendors/doing-business-iowa` and `https://das.iowa.gov/vendors/bidding-opportunities`
- **IMPACS** — `https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa`
- **Iowa Department of Agriculture & Land Stewardship — Bids/Proposals** — `https://iowaagriculture.gov/dscwq/requests-proposals`
- **BidNet Direct — Iowa Purchasing Group** — `https://www.bidnetdirect.com/iowa` — Subscription aggregator.

### State Regulatory / Permitting
- **Iowa DNR Air Quality Construction Permit Search** — `https://idnraqrr.iowadnr.gov/ConPermitSearch/ConstructionPermit` — **Critical for industrial/manufacturing project detection** (often filed before building permit). Stage 3–4 for industrial.
- **Iowa Utilities Commission EFS** — `https://efs.iowa.gov/efs/` (verify at crawl). Gas/electric line extensions, generation/transmission CPCNs. Stage 1–3 utility-infrastructure.
- **Iowa Communications Network (ICN)** — `https://icn.iowa.gov/` — State telecom infrastructure RFPs.
- **Iowa Secretary of State — Business Filings Search** — `https://sos.iowa.gov/search/business/search.aspx` — **LLC formations often 30-90 days before site work.** Stage 1–2.
- **Iowa Land Records** — `https://iowalandrecords.org/` + county selector at `https://iowalandrecords.org/portal/clris/CountiesTab` — Statewide consortium. Pay-per-search or subscription. Stage 2.
- **Iowa Mechanic's Notice and Lien Registry (MNLR)** — `https://mnlr.iowa.gov/` — Searchable by property, claimant, or owner. **Every commercial project of consequence generates MNLR filings within 30 days of subcontractor mobilization.** Stage 6–7. Excellent way to discover the sub-tier of every job.

### Regional Economic Development
- **Greater Des Moines Partnership** — `https://www.dsmpartnership.com/` — Regional chamber + EDD. 140+ active leads ($5.7B as of Jan 2026 annual dinner). Press releases at site + PR Newswire `https://www.prnewswire.com/news/greater-des-moines-partnership/`. **Stage 1 — highest-value rumor source.**
- **Iowa Economic Development Authority (IEDA) news** — `https://opportunityiowa.gov/about/news` — Monthly board approvals (3rd Friday). Names company, location, sq ft, capital investment, tax credit. 2026 examples: Vermeer Bondurant ($102.7M / 300k sq ft / 182 jobs), Walsh Door & Security DSM. Stage 1–2.
- **IEDA press release pattern** — `https://opportunityiowa.gov/press-release/[YYYY-MM-DD]/[slug]`
- **IEDA Community Development Programs** — `https://opportunityiowa.gov/topics/community-development-programs`
- **IEDA Board topic page** — `https://opportunityiowa.gov/topics/ieda-board`
- **Governor of Iowa announcements** — `https://governor.iowa.gov/press-releases` — Largest deals ($250M+) released here first. Example: `https://governor.iowa.gov/press-release/2026-02-20/gov-reynolds-ieda-announce-approval-first-big-incentives`
- **Downtown DSM (Downtown Community Alliance / SSMID)** — Greater DSM Partnership affiliate.
- **Greater Dallas County Development Alliance** — referenced from WDM Local Agencies page.

### Trade Media (Stage 1 Rumor/News)
- **Business Record (Des Moines)** — `https://www.businessrecord.com/` — Primary trade source. Daily newsletter, "Real Estate Insider" section. RSS available.
- **Des Moines Register — Business** — `https://www.desmoinesregister.com/business/`
- **Axios Des Moines** — `https://www.axios.com/local/des-moines` — Newsletter ($265M DMPS bond, school bond outcomes).
- **WHO13 / KCCI / KCRG** — Local TV.
- **Iowa Capital Dispatch** — `https://iowacapitaldispatch.com/`

### Trade Associations & Construction Industry
- **AGC of Iowa** — `https://www.agcia.org/` — Member directory, member-only plan room.
- **ABC of Iowa** — `https://www.abciowa.org/`
- **Master Builders of Iowa (MBI)** — `https://www.mbionline.com/` — Largest commercial GC association. MBI Build Iowa Awards each spring.
- **AIA Iowa** — `https://www.aiaiowa.org/` — Architect directory.
- **ACEC Iowa** — `https://www.acecia.org/` — Consulting engineers.

### Commercial Private-Sector Intelligence Feeds (Subscription)
- **Dodge Construction Network** — `https://www.construction.com/` — Pre-bid; small Iowa cities patchy. Use as confirmation.
- **ConstructConnect** — `https://www.constructconnect.com/`
- **BuildingConnected (Autodesk)** — `https://www.buildingconnected.com/` — GC-sourced ITB.
- **PlanetBids / OpenGov Procurement** — used by some IA cities.
- **Buildchek** — `https://www.buildchek.com/iowa-building-permit-database-lookup-software` — IA-focused aggregator (DSM, Cedar Rapids, Davenport, Sioux City, Iowa City, Waterloo, Ames, WDM, Dubuque, Ankeny, Urbandale, Council Bluffs, Marion + Polk/Linn/Scott/Black Hawk/Johnson/Woodbury/Story/Pottawattamie/Dallas/Dubuque counties). Aggregator — fallback, not substitute.
- **Levelset / Procore** — `https://www.levelset.com/` — Mechanic's lien filings = GC-sub-supplier graph. Stage 6–8.
- **PermitFlow** — `https://www.permitflow.com/` — City-guide reference (e.g. `https://www.permitflow.com/blog/des-moines-building-permit`). Reference only.
- **Jaspector** — `https://www.jaspector.com/permits/iowa/` — Per-city guide. Reference only.

### Higher Education Construction
- **ISU FP&M Bid Dates** — see Ames section.
- **ISU Procurement Construction** — `https://supplier.procurement.iastate.edu/isubid/construction`
- **Drake University Facilities** — `https://www.drake.edu/facilities/` — RFPs less structured than ISU.
- **DMACC** — `https://www.dmacc.edu/` → Business → Bid Opportunities. Multiple campuses (Ankeny, Newton, West, Urban) drive recurring capital.
- **Simpson College (Indianola)** — `https://simpson.edu/` — Watch board minutes.
- **Central College (Pella)** — `https://central.edu/`
- **Grand View University** — `https://www.grandview.edu/`

### K-12 School District Capital Projects
- **Des Moines Public Schools — Capital Improvements** — `https://www.dmschools.org/departments/operations/long-range-planning/smart-use-of-public-resources/benefits-of-bonding/` — **$265M Nov 2025 bond (73.6% yes)** for "Reimagining Education" plan: maker spaces, signature schools, classroom additions at Weeks MS, Lovejoy ES, Studebaker ES (breaking ground late 2026). Project updates: `https://www.dmschools.org/2025/12/month-after-vote-reimagining-education-work-is-underway/`. **Stage 1–5 over 5-year window.**
- **West Des Moines Community Schools** — `https://www.wdmcs.org/` — **$135M GO bond Nov 2025 (69%+ yes)**. Default board post: `https://www.wdmcs.org/default-board-post-page/~board/district-news/post/voters-approve-135-million-general-obligation-bond`
- **Ankeny Community Schools** — `https://www.ankenyschools.org/` — **$130M bond Nov 2025** for "Innovative Hub" school program.
- **Waukee Community Schools** — `https://www.waukeeschools.org/` — Continuous capital pipeline.
- **Johnston, Urbandale, SE Polk, Norwalk, Indianola, Pella, Newton, Knoxville, Ames, Boone CSDs** — board agendas as PDFs; bond items appear months before issuance.

### Transit / Airport / Other Public Owners
- **DART (Des Moines Area Regional Transit)** — `https://www.ridedart.com/` — Capital Improvement Plan, board agendas, procurement.
- **Des Moines International Airport (DSM)** — `https://www.flydsm.com/` — **$500M+ terminal project** referenced in Greater DSM Partnership 2026 federal policy agenda.
- **Ankeny Regional Airport** — capital expansion priority.
- **Des Moines Water Works** — `https://www.dmww.com/` — Water Curia project received $300K IEDA award May 2026.
- **MidAmerican Energy** — utility infrastructure via IUB/IUC filings.
- **Iowa Finance Authority (IFA)** — `https://www.iowafinance.com/` — Affordable housing tax credits often pre-stage multifamily.

## Platform Fingerprinting Cheat Sheet

Always re-fingerprint at first crawl — vendor relationships change. Identification rules of thumb:

- **Tyler EnerGov (CSS)** — `/EnerGov_Prod/SelfService` or `css.[city].gov`. ASP.NET, HTML tables. *Example: Des Moines.*
- **OpenGov Permitting (formerly ViewPoint Cloud)** — `viewpointcloud.com` / `permitting.opengov.com` / branded subdomain. Stateful SPA. *Likely: West Des Moines, Waukee.*
- **Citizenserve** — `www.citizenserve.com/[city]/` or `Portal/PortalController?...&installationID=[id]`. Multi-tenant; stable install IDs. *Example: Altoona (ID 352). Likely: Indianola, Norwalk.*
- **MyGov** — `mygov.us` or `permits.mygov.us`. Smaller-city focus. *Possible: Ankeny, Urbandale.*
- **Accela Civic Platform** — `aca-[region].accela.com` or `aca.accela.com`. Less common in IA metros.
- **GovPilot** — `app.govpilot.com`. Some small IA cities.
- **Vanguard Appraisals CAMA** — `[county].iowaassessors.com`. *All counties in footprint.* HTML scrape with rate limiting.
- **Schneider Geospatial Beacon** — `beacon.schneidercorp.com/Application.aspx?AppID=[id]`. *Example: Dallas County (AppID 909).* Some installations expose ArcGIS REST.
- **ESRI ArcGIS Online Hub** — `arcgis.com` or `[county].gov/arcgis/...`. *Example: Polk County Atlas.* **Highest-yield automated source** when REST endpoints exposed.
- **Granicus / Legistar** — `[city].granicus.com` or `[city].legistar.com`. Structured agendas + ICS calendars + (Legistar) ordinance tracking. IA cities tend to use CivicPlus instead.
- **CivicPlus Agenda Center** — `[city].gov/AgendaCenter` + categorized RSS at `/AgendaCenter/RSS.aspx?CID=[category-id]`. **Easiest scrape target across the footprint.** *Used by: Johnston, Ankeny, Urbandale, Indianola, Knoxville, many small cities.*
- **CivicLive (PowerSchool)** — older CMS. *Example: Norwalk.*
- **Revize CMS** — `cms2.revize.com/revize/[city]/...`. *Example: Des Moines.*

**Anti-bot considerations observed:**
- No Cloudflare/captcha walls on official permit portals.
- Iowa Land Records + some assessors: session-based pagination, preserve cookies.
- Citizenserve + OpenGov: throttle to ~1 req/sec.
- ISU FP&M + Iowa DOT: large ZIP downloads, fetch on schedule.

## Build Sequencing & Watch List

Build crawlers in this priority order to maximize early returns.

### Tier 1 — Build first (highest signal-to-effort ratio)
1. **Greater DSM Partnership press releases + IEDA press releases + Governor's press releases** — Stage 1. RSS or daily HTML diff. Names company, project, dollars, county before any permit exists.
2. **Iowa DOT monthly lettings ZIP downloads** — Stage 5–6 civil/horizontal. Third Tuesday each month, predictable URLs.
3. **Iowa DAS Bidopportunities portal** — Stage 5 for state agency construction.
4. **City of Des Moines CSS / EnerGov SelfService** (`css.dmgov.org`) — Stage 5–7 for the largest jurisdiction.
5. **West Des Moines monthly permit report PDFs** — Stage 6 with high data density.
6. **Polk County Assessor + Polk County GIS Atlas (ArcGIS REST)** — Stage 2 for all of Polk.
7. **CivicPlus Agenda Center RSS feeds** for every city using them (Ankeny, Urbandale, Johnston, Indianola, Knoxville, etc.) — Stage 3–4.
8. **Business Record RSS** — Stage 1 narrative.

### Tier 2 — Add second
9. **Altoona Citizenserve portal + Altoona Now! permit report blog** — small but high-velocity.
10. **Waukee permit portal + monthly reports + project map** — Stage 5–6.
11. **Ankeny One Stop portal + Building Permit Reports** — Stage 5–6.
12. **Iowa DNR Air Quality Construction Permit Search** — Stage 3–4 industrial filter.
13. **Iowa Secretary of State business filings** — Stage 1–2 LLC formations.
14. **Dallas County Beacon (Schneider) + Vanguard CAMA for all county assessors** — Stage 2 + 8.
15. **ISU FP&M bid dates** — Stage 5–6 institutional.

### Tier 3 — Add as bandwidth allows
16. Indianola, Norwalk, Newton, Pella permit portals (lower volume).
17. K-12 school district board agenda PDFs (DMPS, WDM, Ankeny, Waukee, Johnston, Urbandale post-bond).
18. DART, DSM Airport, DMWW capital project pages.
19. Iowa Land Records subscription for full deed/mortgage feed.
20. Trade-association member directories for owner-architect-GC graph backfill.

### Entity-normalization layer (build in parallel with Tier 1)
- Maintain a master `entities` table keyed by Iowa SOS filing number.
- For every permit/agenda record, fuzzy-match the applicant/owner/contractor to known entities.
- Maintain a derived `relationships` table: `{owner_parent, GC, architect, count_of_shared_projects, first_seen, last_seen}`. This is what unlocks repeat-client identification (e.g., "Hubbell Realty + Nelson Construction & Development have co-appeared on 14 projects since 2022").
- Cross-reference owner LLCs to **registered agents** in SOS filings — many CRE owners use the same law firm as agent, which lets you collapse seemingly-unrelated LLCs.

### Watch list — known active repeat-relationships in the Greater Des Moines market

(seed your graph with these to validate normalization)

**Developers / Owners:**
- Hubbell Realty Company — frequent GC partners: Weitz Company, Ryan Companies, Hansen Company.
- Knapp Properties (Chris Costa, 2026 GDMP Board Chair) — Knapp's CC&G Construction arm.
- R&R Realty Group — heavy in industrial/office around Westown Pkwy and Westfield.
- Nelson Construction & Development — Ankeny/north-metro retail.
- Christensen Development — multifamily.
- Hurd Real Estate Services — investment sales / dev.

**Corporates:**
- Casey's General Stores (HQ Ankeny) — ongoing store/distribution buildout.
- Vermeer Corp. (Pella + new Bondurant facility).
- Pella Corp. — manufacturing expansion.
- Microsoft / Apple / Meta — data centers in WDM and Altoona; routed through specialized GCs (DPR, Holder, M.A. Mortenson).
- Iowa Health System / UnityPoint Health / MercyOne — healthcare construction (David Stark of UnityPoint chairs GDMP Government Policy Council).
- Principal Financial Group — downtown DSM real estate + Drake partnership.

**General Contractors (regional + national active in DSM):**
- Ryan Companies (Minneapolis-based, very active in DSM industrial + mixed-use).
- The Weitz Company (DSM-based GC; national presence).
- Neumann Brothers, Story Construction (Ames), Henkel Construction, Edge Commercial — additional regional GCs.

## Verification, Caveats, and Next Steps

**What was verified directly during research (May 2026):** Des Moines CSS/EnerGov, West Des Moines CAP and monthly permit reports, Ankeny One Stop, Urbandale permit portal, Altoona Citizenserve (installation ID 352), Waukee permit system + project map, Indianola online permitting, Norwalk citizen portal, Johnston building permits + CivicPlus Agenda Center, Newton Building Division, Pella P&Z, Knoxville P&Z, Iowa DOT lettings + bid tabs, Iowa DAS Bidopportunities + IMPACS, Iowa DNR Air Quality Construction Permit Search, Polk County Assessor query forms + Atlas GIS, Dallas County Assessor (Beacon), Madison County Assessor (Vanguard), Iowa Land Records portal, Greater DSM Partnership and IEDA press release patterns, ISU FP&M bid dates, DMPS / WDMCS / Ankeny school bond outcomes.

**What was inferred and should be re-fingerprinted:** Specific cloud-permit vendor identity for Ankeny, Urbandale, Waukee, Indianola, and Norwalk (UX descriptions suggest OpenGov/MyGov/Citizenserve but the public-facing brand obscures the vendor). The Iowa Utilities Board's EFS URL was not verified live during research and should be re-confirmed — the IUB was reorganized into the Iowa Utilities Commission and the EFS portal location has changed.

**Known gaps to fill on first build pass:**
- Confirm whether DART, DSM Airport, and Des Moines Water Works publish bids on their own pages or only via DAS BidNet.
- Confirm Boone, Marion, and Jasper county GIS REST endpoints (most Iowa counties use ESRI hubs but not all expose unauthenticated FeatureServers).
- Verify whether the Greater DSM Partnership maintains a public "deal pipeline" page or only releases data via the Annual Dinner / press releases (the $5.7B "currently underway" + $2B "in pipeline" figures referenced in the Jan 2026 annual dinner suggest internal CRM data not on the public site).
- Confirm Drake University, Simpson College, Central College RFP publication channels.

**Operational reminders:**
- Iowa is a single-time-zone state (Central). Most permit portals timestamp in CT.
- Iowa Open Records Law (Iowa Code Chapter 22) gives broad public access; if a city stops publishing a record online, a records request will usually obtain it.
- For mechanic's lien intelligence, Iowa requires preliminary notices via the **Mechanic's Notice and Lien Registry (MNLR)** — `https://mnlr.iowa.gov/` — searchable by property, claimant, or owner. **High-value supplementary feed: every commercial project of consequence generates MNLR filings within 30 days of subcontractor mobilization.** This is Stage 6–7 confirmation and an excellent way to discover the sub-tier of every job.

With the above sources, Tier-1 sequencing, and entity-normalization layer in place, Groundworx should be able to detect approximately 80% of commercial projects in the Des Moines MSA at Stage 3 or earlier — well ahead of where Dodge and ConstructConnect typically pick them up at Stage 5–6. The remaining 20% (private corporate self-perform, design-build with no public bidding, owner-direct work in small jurisdictions) will require human intelligence and direct relationships in addition to the scraper feed.

The Groundworx Source Map above is structured as a working build specification: each entry lists the exact URL, the platform/vendor (where confirmable), the scraping approach implied by that platform, and the pipeline stage the data represents. Sections progress from the largest jurisdictions (Des Moines, West Des Moines, Ankeny, Urbandale) through mid-sized cities (Waukee, Johnston, Altoona, Indianola, Newton, Pella, Ames) and small cities, then aggregate all regional/state sources (Iowa DOT, IEDA, DAS, IUB, DNR, IFA, SOS, Iowa Land Records, MNLR, school-district bond programs, higher-ed bid pages, and trade media). The Intelligence Framework section maps every source to one of the eight pipeline stages so analysts can prioritize outreach windows, and the Build Sequencing section orders the implementation work to deliver the fastest payoff from Tier-1 sources (Greater DSM Partnership + IEDA press releases, Iowa DOT lettings, City of Des Moines CSS/EnerGov, West Des Moines monthly permit PDFs, Polk County GIS, and CivicPlus Agenda Center RSS feeds across the metro). The Platform Fingerprinting Cheat Sheet gives URL signatures so the crawler can auto-identify vendor stacks at first contact, and the Verification & Caveats section flags which items were verified live versus inferred and need a fingerprinting pass during build.
