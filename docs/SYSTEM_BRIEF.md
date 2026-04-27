# NeuroGlitch Construction Intelligence — System Brief
**For use in fresh Claude sessions. Last updated: 2026-04-20.**

---

## 1. What This Platform Is

A full-stack construction intelligence platform built for a General Contractor estimator. It covers the entire bid lifecycle — from job intake through scope analysis, subcontractor leveling, procurement, post-award handoff, and Procore integration — with a Python AI sidecar for document intelligence.

Built and operated solo. Currently single-user. Multi-tenancy is deferred.

**Live at:** `http://localhost:3000` (dev) | **Sidecar:** `http://localhost:8001`  
**Repos:** `github.com/ghostdwg/construction-dashboard` (this) | `github.com/ghostdwg/bid-dashboard` (stable parallel)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| UI | React 19, Tailwind CSS v4 |
| ORM | Prisma 7 |
| Database | SQLite (local dev) / Turso libSQL (production target) |
| Auth | Auth.js v5 (email + password, JWT sessions) |
| AI | Anthropic Claude API (Sonnet + Haiku) |
| Email | Resend API or SMTP (abstracted via provider interface) |
| Python Sidecar | FastAPI + Uvicorn at :8001 |
| Sidecar AI | PyMuPDF4LLM (spec parsing), WeasyPrint (PDF generation), Anthropic SDK |
| State | Zustand (client), React 19 useSyncExternalStore (theme) |
| Tables | TanStack Table v8 + TanStack Virtual |
| Charts | Recharts |
| Excel | ExcelJS |
| Scheduling | Custom working-day CPM engine (TypeScript) |

---

## 3. Repository Structure

```
construction-dashboard/
├── app/                    Next.js App Router pages + API routes
│   ├── api/                REST endpoints (see Section 6)
│   ├── bids/[id]/          Bid detail tabbed view
│   ├── settings/           Settings shell
│   └── components/         Shared UI components
├── lib/
│   ├── services/           Business logic (AI, email, schedule, contacts, etc.)
│   ├── auth.ts             Auth.js config
│   └── prisma.ts           Prisma client singleton
├── prisma/
│   ├── schema.prisma       Full data model (35+ models)
│   └── migrations/         SQLite migration history
├── sidecar/                Python FastAPI service
│   ├── main.py             App entry, auth middleware, router wiring
│   ├── routers/            parse.py, drawings.py, meetings.py, briefing.py
│   └── services/           spec_parser, spec_intelligence, drawing_intelligence,
│                           meeting_intelligence, briefing_generator, submittal_intelligence
└── docs/architecture/      ROADMAP.md, CURRENT_STATE.md, SESSION_STARTER.md
```

---

## 4. Data Model — Key Entities

### Core Domain
- **Bid** — central record. Has `projectName`, `status`, `projectType` (PUBLIC/PRIVATE/NEGOTIATED/CM_AT_RISK), `workflowType` (BID | PROJECT), all INT1 intake fields (14 fields: deliveryMethod, ownerType, buildingType, sqft, stories, LD terms, site constraints, etc.), `constructionStartDate`, `projectDurationDays`
- **Trade** — 46-trade dictionary with CSI codes. Junction to bids via `BidTrade`
- **BidTrade** — trade assignment per bid. Has `tier` (TIER1/TIER2/TIER3), `leadTimeDays`, RFQ tracking fields
- **Subcontractor** — sub directory with `isPreferred` (internal only, never in AI), `procoreVendorId`
- **BidInviteSelection** — which subs are invited per bid-trade, with `rfqStatus`

### AI & Documents
- **BidIntelligenceBrief** — AI-generated bid brief with `riskFlags`, `assumptionsToResolve`, `addendumDeltas`, `isStale`
- **AiGapFinding** — gap findings with severity, sourceRef, sourceDocument
- **GeneratedQuestion** — RFI register with numbering, priority, response, impact
- **SpecBook / SpecSection** — uploaded specs. SpecSection has `csiNumber`, `rawText`, `aiExtractions` (JSON), `canonicalTitle`
- **DrawingUpload / DrawingSheet** — drawing set with `analysisJson` (discipline breakdown), trade mapping
- **AddendumUpload** — per-addendum delta JSON, summary, `deltaGeneratedAt`
- **EstimateUpload** — contains `pricingData` (NEVER returned to client or AI) and `scopeLines`
- **CsiMasterformat** — ~3,995 MasterFormat 2020 Level 3 codes for title canonicalization

### Post-Award
- **ProjectContact** — project team (roles: OWNER/OWNER_REP/ARCHITECT/ENGINEER/INTERNAL_PM/etc.)
- **BuyoutItem** — per-trade contract tracking. `committedAmount`, `contractStatus` (7-stage lifecycle), `poNumber`, `changeOrderAmount`, `paidToDate`, `retainagePercent`
- **SubmittalItem** — submittal register. `source` (ai_extraction | regex_seed | manual | drawing_analysis), `type` (9 types), `status` (8-stage lifecycle), `specSectionId`, `linkedActivityId`, `packageId`
- **SubmittalPackage** — grouped submittal containers with status and routing
- **SubmittalDistributionTemplate** — per-trade routing rules

### Scheduling
- **ScheduleActivity** — H4 legacy schedule (Primavera-style activityIds, FS chain, MSP CSV export)
- **ScheduleActivityV2** — Phase 5C CPM schedule (9-phase template, all 4 dependency types FS/SS/FF/SF, positive/negative lag)
- **ScheduleDependency / ScheduleVersion** — dependency graph + version history

### Meetings & Operations
- **Meeting / MeetingParticipant / MeetingActionItem** — Phase 5D meeting intelligence
- **ProcorePush / RfiItem / ProcoreWebhookEvent** — Tier F Procore bridge
- **AppSetting** — key/value settings store (API keys, email config, etc.)
- **AiTokenConfig** — per-call max_tokens overrides
- **AiUsageLog** — every Anthropic call logged (model, tokens, cost, callKey, bidId)

---

## 5. Module Inventory — All Completed

### Pursuit Layer (bid-dashboard origin, carried forward)
| ID | Name |
|---|---|
| INT1 | Job Intake — 14-field project context capture, feeds AI brief + GNG1 |
| Module 14 | Document Intelligence — spec + drawing upload, three-state trade matching |
| Module 15/15a/15b | AI Review, Bid Brief, Per-Trade Gap Analysis |
| GNG1 | Go/No-Go Gate — 4 scored gates from existing data (no AI call) |
| Module 16a | Addendum Delta — incremental per-addendum JSON, scope change detection |
| Module 2b | Subcontractor Intelligence |
| Module 5b | Estimate Sanitization — pricing redaction engine |
| Modules 6a/6b/6c | Estimate Intake, Scope Leveling Engine, Leveling Questions + Export |
| Module C1/C2/C3 | Bid Spread Analysis, Scope-Cost Correlation, Estimate Intelligence |
| Module D1/D2/D3 | Bid Submission Snapshot, Award Outcome Tracking, Post-Bid Analytics |
| Module P1/P2/P3/P4 | Procurement Timeline, Trade Tier Classification, RFI Register, DBE Compliance |
| RFQ1 | RFQ Email Distribution via Resend or SMTP |
| SET1/SET1+ | Settings shell, AI cost observability, email provider abstraction (Resend + SMTP) |
| Auth Wall A | Email/password login, JWT sessions, route protection |

### Post-Award Handoff (Tier E — all complete)
| ID | Name |
|---|---|
| H1 | Handoff Packet — 8-sheet XLSX, assembles from all bid data |
| H2 | Buyout Tracker — 7-stage contract lifecycle, financial rollup |
| H3 | Submittal Register — regex seeder, 8-stage lifecycle, Procore CSV export |
| H4 | Schedule Seed — canonical CSI sequence, FS chain, MSP CSV export |
| H5 | Owner-Facing Estimate — trade-level XLSX with GC markup, contingency |
| H6 | Budget Creation — cost codes, GC overhead lines, XLSX for ERP import |
| H7 | Contact Handoff — Outlook CSV, Google CSV, vCard export |
| H8 | Award Notifications — sub + internal team emails via provider abstraction |

### Procore Bridge (Tier F — F1–F4 complete)
| ID | Name |
|---|---|
| F1 | CSV/XLSX export package (vendor, budget, submittal, contact) |
| F2 | REST API — OAuth 2.0 push for vendors, contacts, submittals, budget |
| F3 | Bidirectional sync — webhook receiver, RFI pull, submittal status sync |
| F4 | Schedule push — MSP XML 2007 generator, Procore schedule import API |
| F5 | Daily Log weather claim integration — NOT STARTED |

### Phase 5 Construction Intelligence (all complete)
| Phase | Name |
|---|---|
| 5A | Python FastAPI sidecar — spec splitting, per-section AI analysis |
| 5B | Spec intelligence pipeline — CSI MasterFormat model, AI extraction, submittal generation |
| 5C | CPM Scheduling — 9-phase template, full dependency engine, Gantt UI, MSP CSV |
| 5D | Meeting Intelligence — transcription, diarization, Claude analysis, action items |
| 5E | Superintendent Briefing — auto-assembled PDF field report via WeasyPrint |
| 5G-1 | SubmittalItem.specSectionId auto-linkage from AI extractions |
| 5G-2 | Schedule-tied due dates — backward math from install activity |
| 5G-3 | Distribution templates, routing panel |
| 5G-3.5 | SubmittalPackage model, package-grouped register |
| 5G-3.6 | Bulk-edit grid UI with inline editing |
| 5G-ext | Drawing cross-reference — drawing analysisJson → sidecar → submittal items |
| 5H | Warranty, training, inspections, closeout registers from aiExtractions |

---

## 6. API Surface

### Bid Management
```
GET/POST   /api/bids
GET/PATCH  /api/bids/[id]
GET        /api/bids/[id]/intelligence
GET        /api/bids/[id]/submission
GET        /api/bids/[id]/go-no-go
GET        /api/bids/[id]/compliance
```

### AI Features
```
POST       /api/bids/[id]/intelligence/generate       (bid brief)
POST       /api/bids/[id]/gap-analysis/generate
GET        /api/bids/[id]/specbook/gaps
GET        /api/bids/[id]/drawings/gaps
GET/POST   /api/bids/[id]/specbook/analyze
POST       /api/bids/[id]/specbook/analyze/complete
GET        /api/bids/[id]/addendums/[id]/delta/route
GET        /api/bids/[id]/leveling/[rowId]/question
GET        /api/settings/ai-forecast
GET        /api/settings/ai-usage
```

### Post-Award
```
GET/POST   /api/bids/[id]/contacts
GET/PATCH/DELETE /api/bids/[id]/contacts/[contactId]
GET/PATCH  /api/bids/[id]/buyout
GET/POST   /api/bids/[id]/submittals
GET/PATCH  /api/bids/[id]/submittals/[id]
GET        /api/bids/[id]/submittals/packages
GET/POST   /api/bids/[id]/submittals/generate-ai
GET/POST   /api/bids/[id]/handoff
POST       /api/bids/[id]/handoff/export
POST       /api/bids/[id]/schedule/export
GET/POST   /api/bids/[id]/warranties
```

### Procore Bridge
```
POST       /api/procore/push
GET        /api/procore/webhook
POST       /api/procore/webhook
GET        /api/bids/[id]/procore/rfis
POST       /api/bids/[id]/procore/sync
```

### Settings
```
GET/PATCH  /api/settings/app
POST       /api/settings/email/test
```

---

## 7. Python Sidecar Architecture (:8001)

Auth: `X-API-Key` header required on all routes (set in `.env`).

### Routers
| Router | Routes |
|---|---|
| `parse.py` | `POST /parse/specs` — spec PDF → section split → AI extraction per section |
| `drawings.py` | `POST /parse/drawings` — drawing PDF → discipline analysis → trade mapping |
| `meetings.py` | `POST /meetings/transcribe` — audio → Whisper transcription → diarization → Claude analysis |
| `briefing.py` | `POST /briefing/generate` — superintendent field briefing → WeasyPrint PDF |

### Services
- `spec_parser.py` — PyMuPDF4LLM split, section boundary detection
- `spec_intelligence.py` — Claude analysis per section (Sonnet for complex divisions, Haiku for others)
- `drawing_intelligence.py` — discipline parsing, sheet index analysis, cross-reference to spec sections
- `meeting_intelligence.py` — transcription pipeline, speaker diarization, action item extraction
- `briefing_generator.py` — Jinja2 templates → WeasyPrint → PDF bytes
- `submittal_intelligence.py` — drawing-sourced submittal item generation
- `schedule_intelligence.py` — AI-assisted schedule analysis

---

## 8. Hard Rules (Non-Negotiable)

1. `EstimateUpload.pricingData` — **never** returned to client, **never** in any AI prompt. `scopeLines` only.
2. Sub name, company, `isPreferred` — **never** in any AI prompt or sub-facing export.
3. `pricingData` boundary is enforced at the API layer, not just the UI.
4. `/bids/[id]/leveling` is a redirect to `?tab=leveling` — never recreate as a standalone page.

---

## 9. Current State (as of 2026-04-20)

- **All planned phases complete.** System is in maintenance + targeted refinement mode.
- Last shipped: Drawing cross-reference for submittal generation (Phase 5G extension)
- Running: Next.js 16.2.4, Prisma 7.7, Auth.js v5, React 19
- Database: SQLite (local), Turso libSQL targeted for production
- Auth: single user, email/password. Multi-tenancy (Auth B+C) deferred.
- Procore: F1–F4 complete. F5 (Daily Log) not started.
- Phase 5F (Drawing OCR + Quantity Takeoff) — stretch goal, requires GPU

### Deferred / Queued
- Auth Wall B+C — per-user isolation + RBAC (needs real second user)
- Phase 5F — Drawing OCR + Quantity Takeoff (GPU hardware required)
- Phase 5G-4 — Submittal Workflow Templates
- Tier F F5 — Daily Log weather claims
- Production deployment (Postgres migration, HTTPS, hosting)

---

## 10. The Pivot — NeuroGlitch Signal Intelligence

The platform above is the **first vertical**: Construction Intelligence.

The architectural pivot is to extract the intelligence layer from the construction dashboard and make it a **shared signal detection engine** that feeds multiple verticals.

### NeuroGlitch Target Structure
```
C:\NeuroGlitch\
├── construction-dashboard\   ← current platform (this codebase)
├── intelligence\             ← shared ingestion + routing engine (new)
├── data\                     ← pipeline data
├── runtime\                  ← Docker + env
├── integrations\             ← Procore, MLS, etc.
└── modules\                  ← scalable features
```

### Two Active Verticals

**Vertical 1: Commercial Construction Intelligence**
- Permit scraping (building permits, commercial only)
- City council / planning & zoning meeting scraper (agenda + minutes PDFs)
- Entity co-occurrence tracking (who is GC → who are their subs)
- Early project detection before bids are posted
- Feeds into existing construction-dashboard

**Vertical 2: SignalForge — Real Estate Signal Intelligence**
- Life-event detection (marriage records → renter identification)
- Household enrichment (address, owner/renter, time at residence)
- Lead scoring (rule-based → ML over time)
- Outreach workflow (text, email, direct mail)
- Weekly operating cadence: import → enrich → score → contact → log

### Shared Core (NeuroGlitch Signal Engine)

All verticals share the same spine:

```
RAW SOURCES → INGESTION → NORMALIZATION → ROUTER → ENRICHMENT → VERTICAL SIGNAL ENGINE → OUTPUT
```

**Normalized event schema (the integration contract):**
```json
{
  "source_type": "permit | meeting | marriage | deed | zoning | etc.",
  "source_name": "Polk County Permits",
  "event_date": "YYYY-MM-DD",
  "entities": [],
  "raw_text": "",
  "link": "",
  "ingest_timestamp": ""
}
```

**Router logic:**
- `source_type = marriage` → Residential Signal Engine (SignalForge)
- `source_type = building_permit` → Commercial Construction Intelligence
- text contains "rezoning / variance / site plan" → Commercial + Acquisition
- entity co-occurrence tracking → Relationship Intelligence layer

### Build Order (Recommended)

| Phase | What | Rationale |
|---|---|---|
| 1 | Permit scraper (one county) | Direct ROI for construction, validates ingestion pipeline |
| 2 | City council meeting parser | Pre-permit intelligence, PDF text extraction |
| 3 | Entity co-occurrence tracker | GC → sub relationship graph |
| 4 | Router + normalize layer | Worth building once 2+ sources exist |
| 5 | SignalForge (marriage records) | Second vertical, proves shared spine |
| 6 | Dashboard UI | Command center after data is flowing |

### New Repo Target
`C:\NeuroGlitch\intelligence\` — Python-first, separate from the Next.js dashboard.
Stack: FastAPI (already proven in sidecar), PostgreSQL, Playwright/Puppeteer for scraping, spaCy for NLP, Claude API for entity extraction and summarization.

---

## 11. Questions for Architecture Session

1. Should `intelligence/` be a standalone service that **pushes** signals into the construction dashboard DB, or should the dashboard **pull** from a shared signal API?
2. What is the multi-tenancy model for SignalForge — is this a SaaS product or an internal tool for the real estate friend?
3. For the construction vertical: does the GC sub-relationship graph live in the construction-dashboard schema or in the intelligence layer?
4. Where does the identity enrichment (address, owner/renter lookup) live — third-party API or self-built?
5. What is the MVP definition for Phase 1 of the intelligence layer — a weekly CSV output is sufficient to validate before building any UI?
