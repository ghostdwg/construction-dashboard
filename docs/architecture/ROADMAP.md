# Roadmap — Construction Intelligence Platform
# Version 2.8 — Last Updated: 2026-04-19
# Repo: construction-dashboard (forked from bid-dashboard)
# Parallel repo: bid-dashboard (active, still receiving updates)

---

## SYSTEM MISSION

A modular construction intelligence platform covering the full project
lifecycle — from bid intake through post-award handoff, field execution
support, and closeout.

Three wings drive the pursuit phase. Post-award modules carry ingested
data forward into project execution without re-entry. The system enforces
workflow by structure: the tool IS the SOP.

The core problem: information from the spec book doesn't flow to the people
who need it, when they need it. This system reads the spec once, extracts
everything, routes it to the right registers, and generates the right
deliverables for each audience.

---

## TWO-REPO STRATEGY

This project runs across two parallel repositories:

### bid-dashboard (production)
  - GitHub: ghostdwg/bid-dashboard
  - Local: c:\Users\jjcou\bid-dashboard
  - Purpose: stable preconstruction tool, used on live bids
  - Receives: Tier F completion, auth refinements, minor enhancements,
    bug fixes discovered on real jobs
  - Rule: never break what works. Test on real bids.

### construction-dashboard (expansion)
  - GitHub: ghostdwg/construction-dashboard
  - Local: c:\Users\jjcou\construction-dashboard
  - Purpose: Phase 5 construction intelligence expansion
  - Receives: Python sidecar, spec intelligence, scheduling module,
    meeting intelligence, superintendent briefing, drawing OCR
  - Also receives: all bid-dashboard updates via periodic sync
  - Rule: experimental work lives here. Break things freely.

### Sync Protocol — Pulling bid-dashboard updates into construction-dashboard

When you complete work in bid-dashboard that should flow into
construction-dashboard, run this from the construction-dashboard directory:

  cd c:\Users\jjcou\construction-dashboard

  # First time only — add bid-dashboard as a remote
  git remote add upstream https://github.com/ghostdwg/construction-dashboard.git
  # Actually, since they started as copies, add the original:
  git remote add bid-dashboard https://github.com/ghostdwg/bid-dashboard.git

  # Each time you want to pull bid-dashboard changes:
  git fetch bid-dashboard main
  git merge bid-dashboard/main --no-edit

  # If there are conflicts, resolve them, then:
  git add .
  git commit -m "sync: merge bid-dashboard updates"
  git push origin main

Do this BEFORE starting a new Phase 5 build session so you're always
working on top of the latest bid-dashboard state.

When Phase 5 modules stabilize and you want to push them back to
bid-dashboard, cherry-pick specific commits:

  cd c:\Users\jjcou\bid-dashboard
  git remote add construction ../construction-dashboard
  git cherry-pick <commit-hash>
  git push origin main

---

## CURRENT STACK

| Layer | Technology | Role |
|-------|-----------|------|
| Language | TypeScript | Every file — frontend and backend |
| Framework | Next.js 16 (App Router) | Server components, API routes, routing |
| UI | React 19 | Component rendering |
| Styling | Tailwind CSS v4 | All styling — no separate CSS files |
| Database | SQLite via Prisma ORM | Local dev.db — Postgres migration planned |
| AI | Anthropic Claude API | Brief generation, gap analysis, spec extraction |
| Email | Resend API + nodemailer | RFQ emails, award notifications (provider-agnostic) |
| Auth | Auth.js v5 (next-auth) | Login wall, JWT sessions, role badges |
| Exports | exceljs + react-email | XLSX, CSV, vCard, HTML emails |

**Planned addition (construction-dashboard only):**
Python FastAPI sidecar (port 8001) for document intelligence, OCR,
schedule export (MSP XML + P6 XER), and PDF generation.

---

## ARCHITECTURE — THREE WINGS + LIFECYCLE

### Phase 1 — Pursuit (Bid Management) ✅ COMPLETE
  Wing 1: Job Intake (INT1) ✅
  Wing 2: Scope Intelligence (14, 15, 15a, 15b) ✅
  Wing 3: Bid Leveling (6a-6c, Tier C, Tier D) ✅

### Phase 2 — Award Gate ✅ COMPLETE

### Phase 3 — Post-Award / Handoff (Tier E) ✅ COMPLETE
  All 8 modules shipped (H1-H8 + H1+).

### Phase 4 — Procore Bridge (Tier F) — IN PROGRESS
  H3 submittal CSV is the first shipped piece.
  Remaining: F1-F5 (see Stream A below).

### Phase 5 — Construction Intelligence (construction-dashboard only)
  Python sidecar, spec intelligence, interactive scheduling,
  meeting analysis, superintendent briefing, drawing OCR.

---

## COMPLETED MODULES (35 total)

### Foundation + Core Intelligence
| Module | Description | Status |
|--------|-------------|--------|
| Tiers 1–3 | Core schema, UI, navigation | ✅ COMPLETE |
| Tier A | AI Layer + Core Data Model | ✅ COMPLETE |
| Module 2b | Subcontractor Intelligence Layer | ✅ COMPLETE |
| Module 14 | Document Intelligence | ✅ COMPLETE |
| Module 15a | Bid Intelligence Brief | ✅ COMPLETE |
| Module 15b | Per-Trade Scope Gap Analysis | ✅ COMPLETE |
| Module GNG1 | Go/No-Go Gate Widget | ✅ COMPLETE |
| Module 16a | Addendum Delta Processing | ✅ COMPLETE |
| Module INT1 | Job Intake — Wing 1 | ✅ COMPLETE |

### Procurement + Leveling + Bid Assembly
| Module | Description | Status |
|--------|-------------|--------|
| Module 5b | Estimate Sanitization | ✅ COMPLETE |
| Module 6a | Estimate Intake | ✅ COMPLETE |
| Module 6b | Scope Leveling Engine | ✅ COMPLETE |
| Module 6c | Leveling Questions + Export | ✅ COMPLETE |
| Tier B | Procurement Intelligence (P1–P4) | ✅ COMPLETE |
| Tier C | Estimate Intelligence (C1–C3) | ✅ COMPLETE |
| Tier D | Bid Assembly + Post-Bid (D1–D3) | ✅ COMPLETE |
| RFQ1 | RFQ Email Distribution | ✅ COMPLETE |

### Post-Award Handoff (Tier E)
| Module | Description | Status |
|--------|-------------|--------|
| H1 | Handoff Packet | ✅ COMPLETE |
| H1+ | Project Contacts | ✅ COMPLETE |
| H2 | Buyout Tracker | ✅ COMPLETE |
| H3 | Submittal Register (regex seeder + Procore CSV) | ✅ COMPLETE |
| H4 | Schedule Seed (CSI sequence, FS chain, MSP CSV) | ✅ COMPLETE |
| H5 | Owner-Facing Estimate | ✅ COMPLETE |
| H6 | Budget Creation | ✅ COMPLETE |
| H7 | Contact Handoff (Outlook/Google/vCard) | ✅ COMPLETE |
| H8 | Award Notifications | ✅ COMPLETE |

### Infrastructure
| Module | Description | Status |
|--------|-------------|--------|
| SET1 | Settings & Cost Observability | ✅ COMPLETE |
| SET1+ | Email Provider Abstraction | ✅ COMPLETE |
| Auth A | Auth Wall Level A | ✅ COMPLETE |
| Nav | UI Nav Refactor (sidebar) | ✅ COMPLETE |
| Theme | Light/Dark Toggle | ✅ COMPLETE |
| Procore | CSV Import | ✅ COMPLETE |
| AI Tokens | Per-Call Token Config | ✅ COMPLETE |

### Pursuit Enhancements
| Module | Description | Status |
|--------|-------------|--------|
| Decision Log | BidDecision model (8 categories, ACTIVE/SUPERSEDED/VOID), DecisionLogTab, inline edit, briefing PDF integration | ✅ COMPLETE |

### Phase 5 Extensions
| Module | Description | Status |
|--------|-------------|--------|
| 5D+ Hybrid | Teams Hybrid transcription — GPU worker (WhisperX + pyannote on 4070 Ti via Tailscale), VTT parser, transcript merger, AWAITING_NAMES flow, SpeakerNamingPanel | ✅ COMPLETE |

---

## ACTIVE WORK — THREE PARALLEL STREAMS

Work is organized into three streams. Stream A runs in bid-dashboard.
Streams B and C run in construction-dashboard. Sync regularly.

### ━━━ STREAM A: bid-dashboard completion ━━━
### (done in bid-dashboard, synced to construction-dashboard)

#### A1. Tier F — Procore Integration Bridge
Priority: NEXT
Estimated: 5-8 sessions

| Item | Description | Status |
|------|-------------|--------|
| F1 | CSV/XLSX export — vendor, budget, submittal, contact imports | ✅ COMPLETE |
| F2 | REST API — OAuth 2.0, project/vendor/budget/submittal push | ✅ COMPLETE |
| F3 | Bidirectional sync — webhooks, RFI sync | ✅ COMPLETE |
| F4 | Schedule push — Procore accepts MPP, XML, XER, PP | ✅ COMPLETE |
| F5 | Daily Log weather claim integration (§15.1.6 custom fields) | NOT STARTED |

Note: F4 and F5 benefit from Phase 5C (scheduling module) and the
Python sidecar (MPXJ/PyP6XER export). Consider building F1-F3 in
bid-dashboard now, and F4-F5 after Phase 5A/5C land in construction-dashboard.

#### A2. Auth Wall — Levels B + C
Priority: DEFERRED until there is a real second user
Estimated: 4-6 sessions
Prerequisite: SQLite → Postgres migration (done in Phase 5A)

| Item | Description | Status |
|------|-------------|--------|
| Level B | Per-user isolation — where clause on bid queries | NOT STARTED |
| Level C | Role-based middleware — admin/PM/estimator visibility | NOT STARTED |
| OAuth | Microsoft / Google SSO providers | NOT STARTED |
| Magic Link | Email-based passwordless login (model exists) | NOT STARTED |

#### A3. Production Readiness
Priority: DEFERRED until pre-deploy
Prerequisite: Auth B+C complete

| Item | Description | Status |
|------|-------------|--------|
| Database | SQLite → Postgres migration | NOT STARTED |
| Secrets | AppSetting secrets → real secret manager | NOT STARTED |
| Security | HTTPS, rate limiting, secure cookie flags | NOT STARTED |
| Deploy | Target selection + CI/CD pipeline | NOT STARTED |

#### A4. Carried Forward — Minor Enhancements
Priority: OPPORTUNISTIC — pick these up when you're already touching
the relevant module on a live job. Don't build sessions around them.

| From | Enhancement | Absorbed By | Status |
|------|-------------|-------------|--------|
| H2 | Auto-populate originalBidAmount from leveling data | — | NOT STARTED |
| H2 | PO issuance to sub via email (reuses RFQ1 infra) | — | NOT STARTED |
| H3 | Submittal attachments / file uploads | — | NOT STARTED |
| H3 | Review round tracking (1st, resubmission, etc.) | — | NOT STARTED |
| H3 | AI-driven submittal extraction (replace regex) | Phase 5B | ABSORBED |
| H4 | SS/FF/SF predecessors + lag (full CPM) | Phase 5C | ABSORBED |
| H4 | SVG Gantt visualization | Phase 5C | ABSORBED |
| H4 | Procore schedule export (.xer/.mpp) | Phase 5C + F4 | ABSORBED |
| SET1 | Per-bid cost ledger view (currently global) | — | NOT STARTED |
| SET1 | Budget alerts ("spent $X, set a cap?") | — | NOT STARTED |
| SET1 | Real Anthropic tokenizer (replace chars/4) | — | NOT STARTED |

Items marked ABSORBED will be resolved when their Phase 5 module ships
in construction-dashboard and gets synced back. Don't build them separately.

### ━━━ STREAM B: Phase 5 — construction intelligence ━━━
### (done in construction-dashboard)

#### Phase 5A: Python Sidecar — Document Intelligence Foundation
Estimated: 80–120 hours (Weeks 1–4)
Status: ✅ COMPLETE

FastAPI service at 127.0.0.1:8001, co-located under /sidecar.
Foundation for all document intelligence, OCR, schedule export, PDF generation.

Endpoints:
  /parse/specs          — spec book parsing (PyMuPDF4LLM + pdfplumber)
  /parse/specs/async    — async queue for large docs (Redis + RQ)
  /ocr/drawings         — drawing sheet OCR (PaddleOCR v3, PP-OCRv5)
  /ocr/drawings/titleblock — title block extraction (OpenCV + PaddleOCR)
  /takeoff/quantities   — area measurement (OpenCV + SAM)
  /takeoff/count        — fixture counting (YOLOv8)
  /export/msp           — MS Project XML (MPXJ via JPype)
  /export/xer           — Primavera P6 XER (PyP6XER)
  /export/pdf           — PDF reports (WeasyPrint + Jinja2)
  /transcribe           — meeting audio (WhisperX, local mode)
  /health               — service status, GPU, memory

Also includes: PostgreSQL migration (prerequisite for Auth B+C).

Architecture:
  - FastAPI + Uvicorn, bound to localhost only
  - Shared API key via env var for authentication
  - Docker Compose: Next.js + sidecar + PostgreSQL
  - npm concurrently for dev, Docker Compose for production
  - Redis + RQ for async processing of large spec books

PDF parsing:
  Primary: PyMuPDF4LLM — 0.12s/page, structured markdown, CSI hierarchy
  Tables: pdfplumber — MIT license, visual debugging for bordered tables
  Scanned: marker — 33.7K stars, 122 pages/sec on GPU, --force_ocr

OCR for drawings:
  PaddleOCR v3.0 (PP-OCRv5) — 60K+ stars, 0.10 CER vs Tesseract 0.18
  Pipeline: 300 DPI render → OpenCV line removal → PaddleOCR → regex → title block

#### Phase 5B: Spec Intelligence Pipeline — Five Registers
Estimated: 120–160 hours (Weeks 5–10)
Status: ✅ COMPLETE (AI extraction pipeline + submittal generation; all 5 derived view registers shipped)

Reads spec once, routes every requirement to the right register.
Upgrades H3's regex seeder to full AI-powered extraction.

Five extraction targets:
  Submittals   — Part 1 SUBMITTALS article → submittal register (H3 upgrade)
  Warranties   — Part 1 WARRANTY article → warranty register (NEW model)
  Training     — Part 1/3 TRAINING article → training register (NEW model)
  Closeout     — Div 01 (01 77–01 79) → closeout checklist (NEW model)
  Testing      — Part 3 FIELD QC → inspection log (NEW model)

AI extraction engine (3-pass):
  Pass 1 (Haiku, ~$0.10/book): TOC parse, CSI section boundaries
  Pass 2 (Sonnet, ~$1.50/book): per-section structured extraction
  Pass 3 (Sonnet, ~$0.50/book): cross-reference, dedup, link closeout to submittals
  Total: ~$2–4/book. Batch API halves this.

When this ships, it ABSORBS these bid-dashboard deferrals:
  - H3: AI-driven submittal extraction (replaces regex seeder)

#### Phase 5C: Interactive Scheduling Module
Estimated: 120–160 hours (Weeks 11–16)
Status: ✅ COMPLETE (ScheduleV2, 9-phase CPM template, Gantt UI, MSP CSV export)

In-browser Gantt with CPM, all 4 dep types, resource views,
percentage-complete triggers. Replaces H4's table-only UI.
H4's ScheduleActivity data model carries forward.

Library recommendation: DHTMLX Gantt PRO ($699 perpetual)
  - Only library with Primavera P6 import/export
  - React wrapper for Next.js App Router ("use client")
  - Full CPM, resource histograms, drag-draw dependencies
  Fallback: Syncfusion Community License (free <$1M revenue)

Custom percentage-complete engine:
  - onAfterTaskUpdate callbacks for progress monitoring
  - Threshold-based successor activation
  - Zone-based floor-by-floor stacking
  - Weather day allowances per NOAA §15.1.6 baseline

Export via sidecar: MSP XML (MPXJ), P6 XER (PyP6XER), Procore (MPP/XML/XER)

When this ships, it ABSORBS these bid-dashboard deferrals:
  - H4: SS/FF/SF predecessors + lag → DHTMLX supports all 4 natively
  - H4: SVG Gantt visualization → DHTMLX renders the Gantt
  - H4: Procore schedule export → sidecar handles .xer/.mpp/.xml
  - Tier F4: Schedule push to Procore

#### Phase 5D: Meeting Intelligence Pipeline
Estimated: 100–140 hours (Weeks 17–22)
Status: ✅ COMPLETE (transcription, diarization, Claude analysis, action items; Teams Hybrid GPU pipeline added 2026-04-27)

Transcription → diarization → Claude analysis → structured output.
Settings toggle between cloud and local processing.

Options:
  Cloud: AssemblyAI ($0.15/hr, 2.9% DER, custom vocabulary, EU/HIPAA)
  Local: WhisperX (free, pyannote v4 diarization, full privacy)
  Existing: HuggingFace diarization on Windows rig (preserved as option)

Architecture:
  - Settings toggle: Cloud / Local / HuggingFace (existing Windows rig)
  - Normalized JSON output from any source
  - MEETING_ANALYSIS_RULES.md as Claude system prompt
  - Persistent speaker roster per project
  - Delta mode for recurring meetings
  - Voice split merging for single-mic artifacts

Hardware:
  Jabra Speak2 75 ($369) — job site trailers, portable
  Shure Stem Table ($999) — permanent installations, spatial separation

#### Phase 5E: Superintendent Briefing — Field Deliverable ✅ COMPLETE
Auto-assembled from all registers into a single PDF:
  - Schedule status (this week, behind, 2-week lookahead, critical path)
  - Active submittals (pending review, approaching deadlines)
  - Required inspections (scheduled, outstanding, acceptance criteria)
  - Warranty requirements per trade
  - Training requirements (BAS, fire alarm, elevator)
  - Risk flags from bid intelligence brief
  - Meeting action items (open commitments)
  - Weather impact (forecast + NOAA baseline comparison)

Generation: WeasyPrint + Jinja2 on sidecar. @react-pdf/renderer for preview.

#### Phase 5F: Drawing OCR & Quantity Takeoff (STRETCH)
Estimated: 160+ hours (Weeks 23+)
Status: STRETCH — validate Phases 5A–5E first

  Symbol detection: YOLOv8 — 500+ labeled images per class
  Room segmentation: Meta SAM + Hough Line Transform
  Scale detection: OCR title block + dimension annotation validation
  Commercial benchmark: Togal.AI ($300+/user/mo, 90–98% accuracy)

#### Phase 5G: Submittal Intelligence Layer
Estimated: 80–120 hours total (split across four sub-phases)
Status: ✅ 5G-1 through 5G-3.6 COMPLETE — bridges Phase 5A (AI extraction) into H3 (register)

The "moat feature" — turns the AI submittal extractions sitting in
SpecSection.aiExtractions into a live, schedule-aware register. Procore
charges thousands per project for this exact workflow.

BACKLOG IDEA (not required for v1) — Division 01 Submittal Policy:
  Section 01 33 00 (and 01 33 23, 01 77 00, 01 78 00) defines project-wide
  submittal procedures: format, numbering scheme, review duration, copies,
  resubmittal procedure, distribution requirements. A separate AI pass on
  these sections could populate a BidSubmittalPolicy row whose defaults
  feed reviewBufferDays (5G-2), distribution lists (5G-3), and workflow
  defaults (5G-4). Skip until 5G-1 through 5G-3 are in real use — risk of
  over-polishing before validating the basics.

##### 5G-1 — Spec Section Auto-Linkage (~10 hrs) ✅ COMPLETE
Bridge AI extractions → SubmittalItem records.
  - New column: SubmittalItem.specSectionId (FK to SpecSection)
  - New column: SubmittalItem.source ("ai_extraction" | "regex_seed" | "manual")
  - New action: "Generate Submittal Register from Spec Analysis" button on
    Submittals tab — reads every SpecSection.aiExtractions, creates one
    SubmittalItem per extracted submittal
  - Dedupe: skip if (csiNumber + type + similar description) already exists
  - "View Spec" link on each submittal opens the per-section PDF (already
    served at /api/bids/[id]/specbook/sections/[sectionId]/pdf)
  - Same pattern unlocks Warranty Register from extracted warranty[] data

##### 5G-2 — Schedule-Tied Due Dates (~30 hrs) ✅ COMPLETE
Backwards math from required-on-site → submit-by date.
  New SubmittalItem fields:
    leadTimeDays         — from approval to delivery (mfr promise)
    reviewBufferDays     — engineer/architect review (default 21 per A201)
    resubmitBufferDays   — slack for one resubmission cycle (default 7)
    linkedActivityId     — FK to ScheduleActivity (the install activity)
    requiredOnSiteDate   — derived: linkedActivity.startDate − leadTimeDays
    submitByDate         — derived: requiredOnSiteDate − reviewBuffer − resubmitBuffer

  - Schedule recalc trigger fires submittal date recalc (working-day math
    already exists in scheduleService.ts)
  - Late submittal pushes linkedActivity.startDate ("ball in court" days)
  - UI: dropdown on submittal form to pick the schedule activity it blocks
  - This must ship alongside Phase 5C (Gantt UI) — both touch schedule recalc

##### 5G-3.5 — Submittal Packages (~20 hrs) ✅ COMPLETE
First-class container for grouping submittals — matches Procore's
"Submittal Package" field on the import CSV.

  New model: SubmittalPackage
    packageNumber           "PKG-01", "PKG-02"
    name                    "Concrete", "Electrical"
    bidTradeId              optional FK (1:1 with trade in most cases)
    status                  DRAFT | OPEN | CLOSED
    responsibleContractor   package-level default
    submittalManager        package-level default
    defaultReviewers        Json — ["GC PM", "Architect"]
    defaultDistribution     Json — ["Owner Rep", "Inspector"]
    defaultWorkflowTemplate FK to SubmittalWorkflowTemplate (5G-4)

  SubmittalItem gets new column: packageId (FK, nullable)
  When item belongs to a package, package values become the form defaults
  (overridable per item).

  Auto-creation: when AI extraction runs (5G-1), one package is created
  per trade that has extracted submittals. Estimator can rename/merge.

  UI: Submittals tab groups by package with collapse/expand; bulk actions
  per package (assign sub, set due dates, mark received).

  Procore export: existing H3 CSV gains "Submittal Package" column —
  one line of code, makes the export Procore-import-ready end-to-end.

##### 5G-3.6 — Bulk-Edit Grid UI (~15 hrs) ✅ COMPLETE
The "easier than Procore + easier than Excel" experience. Replaces the
default Submittals tab with a package-grouped outline.

  Layout:
    - Top bar: [Generate from Spec Analysis] [Export Procore CSV] + filter chips
    - Each package renders as collapsible header with progress pill (●●●○○ 60%)
      and inline distribution preview ("GC PM, Architect, Structural Eng")
    - Items inside each package render as a dense grid:
        # | Title | Type | CSI | Sub | Due | Status
    - Inline cell editing — click cell, edit, Tab to next cell
    - No modal for routine edits; modal only for full item detail / attachments
    - Keyboard: Tab / Shift+Tab between cells, Enter saves, J/K row nav
    - Multi-row select (checkbox column + Shift+click range)
    - Bulk actions on selection: assign sub, set due dates, mark received,
      move between packages, delete

  Filter chips (top of view):
    Open · Overdue · Awaiting Review · CRITICAL · Mine
    Click chip to scope view; chips are additive

  Why this beats Procore:
    - Procore requires per-item modal clicks; this is one-screen scan + edit
    - Package as primary unit matches how estimators actually think
    - AI prefills mean you approve, not data-enter
    - Bulk operations are first-class (Procore charges extra for bulk edit)

  Why this beats Excel:
    - Real relationships (CSI, sub, schedule) preserved
    - Status lifecycle automation (overdue flagging, reminders)
    - Procore CSV export is one click, no manual reformatting

  Stack notes:
    - Native HTML table + contenteditable cells; no library dep
    - Server actions for save-on-blur (no batch save needed)
    - Optimistic UI for snappy feel

##### 5G-3 — Templated Distribution Lists (~25 hrs) ✅ COMPLETE
Per-trade routing rules so the form auto-fills.
  New model: SubmittalDistributionTemplate
    trade                 (e.g., Masonry)
    responsibleContractor → BidTrade.awardedTo (auto from H2 Buyout)
    submittalManager      → role/person at the awarded sub
    reviewers             → [GC PM, Architect, Structural Engineer]
    distribution          → [GC Super, Owner Rep, Inspector]

  - When user picks a CSI section on a submittal, division → trade →
    template auto-populates everyone
  - Bulk-edit screen for managing templates per project
  - Override per submittal allowed

##### 5G-Extension — Drawing Cross-Reference (~8 hrs) ✅ COMPLETE
Identifies submittal requirements visible in drawings that have no spec section coverage.
  - POST `/api/bids/[id]/submittals/generate-ai` — two-phase: (1) spec-only generation
    (local, synchronous), (2) drawing cross-reference job submitted to sidecar (async)
  - GET `/api/bids/[id]/submittals/generate-ai` — preflight metadata endpoint returns
    `{ analyzedSectionCount, hasSpecBook, hasDrawings }` for UI dependency check
  - Sidecar `submittal_intelligence.py` — cross-references covered CSI sections against
    drawing `analysisJson`; returns drawing-only submittal gaps (max 25 items)
  - Guard: if `specSections.length === 0`, skips drawing phase entirely (empty list
    would cause Claude to flag all drawing scope as "uncovered" — misleading result)
  - Drawing-sourced items stored with `source: "drawing_analysis"` on `SubmittalItem`
  - UI: dependency hint banner on Submittals tab when no analyzed sections exist

##### 5G-4 — Templated Workflows (~25 hrs) — DEFER
Submittal type → review path defaults.
  New model: SubmittalWorkflowTemplate
    type=PRODUCT_DATA   → GC → Architect (10d) → return
    type=SHOP_DRAWING   → GC → Architect → Engineer (15d) → return
    type=SAMPLE         → GC → Architect (5d) → return → resubmit if needed
    type=MOCKUP         → GC → Architect → Owner (mockup approval meeting)
    type=LEED           → GC → LEED consultant → Architect

  - Auto-populates default reviewers, review duration, resubmission allowance
  - Override per submittal
  - DEFER until Phases 5G-1 and 5G-2 are battle-tested in real workflow.
    Workflow engines are easy to over-engineer.

When this ships, it ABSORBS these bid-dashboard deferrals:
  - H3: AI-driven submittal extraction (5G-1 replaces regex seeder, refines 5B)
  - H3: Submittal attachments / file uploads (uses per-section PDFs from 5A)

Recommended sequence:
  5G-1   → ship right after Phase 5A AI analysis is verified (data bridge)
  5G-3.5 → ship immediately after 5G-1 (package container — no packages = flat list)
  5G-3.6 → ship immediately after 5G-3.5 (the grid UI is the real user value)
  5G-2   → ship as part of Phase 5C scheduling (both touch recalc)
  5G-3   → ship after 5C, once trade data settles (template distribution lists)
  5G-4   → defer to Phase 5E or beyond (workflow templates)

First deliverable worth shipping: 5G-1 + 5G-3.5 + 5G-3.6 as a bundle.
  Together = ~45 hrs = spec-driven submittal register with package grouping
  and bulk edit. That's the "easier than Procore + easier than Excel" MVP.
  5G-2 / 5G-3 / 5G-4 layer on additional intelligence afterward.

#### Phase 5H: Closeout Intelligence (ASPIRATIONAL — future direction)
Near-term derived views shipped: Warranty Register (5H), Training Register (5H-2), Inspections Register (5H-3), Closeout Checklist (5H-4).
Estimated: 80–120 hours
Status: ASPIRATIONAL — pivot target after 5G + real closeout data exists

AI works against INBOUND submittal PDFs (received from subs during
construction) rather than outbound spec analysis. Requires post-award data
flow that doesn't exist yet; re-evaluate once the first project has
submittals actually being submitted.

Potential sub-phases:
  5H-1: Spec-compliance check — compare submitted cut sheets against the spec
        paragraph that required them. Flag deviations pre-approval.
  5H-2: Warranty auto-extraction from received warranty certificates (duration,
        start date, manufacturer contact, exclusions).
  5H-3: O&M auto-compilation — reads every approved submittal PDF, extracts
        maintenance-relevant pages, assembles bound per-trade O&M book.
  5H-4: Closeout package generator — per-trade PDF (cover + spec + cut sheets
        + warranty + O&M) auto-assembled at substantial completion.

Why it's deferred:
  No inbound submittals exist yet (pre-award workflow only). Building 5H now
  is building against a scenario we can't validate. First awarded project
  that goes through closeout tells us the real pain points.

Near-term alternative (ships today):
  Warranty info extracted from the SPEC BOOK (which we already have via 5A
  AI analysis) gives pre-award visibility. Spec tells us what warranty is
  REQUIRED. Industry-standard tables fill in what's TYPICAL. Together they
  inform bid pricing without needing inbound PDFs.

### ━━━ STREAM C: Cross-cutting (either repo) ━━━

#### Database Migration: SQLite → PostgreSQL
Part of Phase 5A but benefits both repos.
When done in construction-dashboard, sync back to bid-dashboard.

Steps:
  1. Change provider in schema.prisma from sqlite to postgresql
  2. Update DATABASE_URL to PostgreSQL connection string
  3. Use pgloader to transfer existing data
  4. Fix type incompatibilities (dynamic → strict typing)
  5. Run prisma migrate dev for new migration files

Alternative: Turso (libSQL) — SQLite fork with replicas, Prisma support.
Experimental MVCC not production-ready. Worth monitoring.

#### Deployment Architecture
Docker Compose: Next.js (3000) + FastAPI sidecar (8001, internal) + PostgreSQL (5432)

| Platform | Cost | Best for |
|----------|------|----------|
| Render | $7–19/svc/mo | Managed Postgres, Blueprint YAML |
| Railway | Usage-based | Fastest MVP deploy |
| Hetzner VPS | $10–24/mo | Full control, cheapest |
| Vercel + sidecar | $20/mo + sidecar host | Best Next.js DX |

---

## COST SUMMARY (Phase 5, First Year)

| Item | Type | Cost |
|------|------|------|
| DHTMLX Gantt PRO | One-time | $699 |
| Jabra Speak2 75 | Hardware | $369 |
| AssemblyAI (~40 hrs/mo) | Monthly | $6–14/mo |
| Claude API (specs) | Per book | $2–4/book |
| Claude API (meetings) | Monthly | $5–15/mo |
| PostgreSQL hosting | Monthly | $7–19/mo |
| App hosting (2 services) | Monthly | $14/mo |
| **Total first year** | | **~$1,500–1,800** |

---

## BUILD SEQUENCE

### Stream A (bid-dashboard) — no fixed timeline, driven by live job needs
| Item | Sessions | Status |
|------|----------|--------|
| Tier F (F1–F3) | 5–8 | NEXT |
| Auth B+C | 4–6 | DEFERRED |
| Production Readiness | 3–4 | DEFERRED |
| Minor enhancements | 1 each | OPPORTUNISTIC |

### Stream B (construction-dashboard) — 22-week build sequence
| Weeks | Phase | Hours | Status |
|-------|-------|-------|--------|
| 1–4 | 5A: Python sidecar + spec parsing + Postgres | 80–120 | ✅ COMPLETE |
| 5–10 | 5B: Spec intelligence + five registers | 120–160 | ✅ COMPLETE |
| 11–16 | 5C: Scheduling module + DHTMLX + export | 120–160 | ✅ COMPLETE |
| 17–22 | 5D+5E: Meeting intelligence + super briefing | 100–140 | ✅ COMPLETE |
| — | 5G-1 through 5G-3.6: Submittal Intelligence | 80–120 | ✅ COMPLETE |
| — | 5H near-term: Warranty + Training + Inspections + Closeout | — | ✅ COMPLETE |
| 23+ | 5F: Drawing OCR + quantity takeoff | 160+ | STRETCH |

Priority override: if a pain point is actively costing money on a live job,
reprioritize that module to Week 1.

---

## AI BOUNDARY — NON-NEGOTIABLE

- pricingData NEVER returned to client, NEVER in any AI prompt
- Sub name and company NEVER in any AI prompt
- Subcontractor.isPreferred NEVER in any AI prompt or sub-facing export
- Owner-facing estimate shows aggregated trade totals only
- Email templates never include pricing data

---

## SESSION RULES

- New chat per module or major step
- New Claude Code session per build step
- Commit to GitHub at end of every session
- Update CURRENT_STATE.md at end of every session
- Update this ROADMAP.md when a status changes
- Sync bid-dashboard → construction-dashboard before starting Phase 5 work

---

## NEVER DO

- Return pricingData to client
- Include sub name or company in any AI prompt
- Include Subcontractor.isPreferred in any AI prompt or sub-facing export
- Mix planning and build execution in same Claude Code session
- Commit .claude/settings.local.json
- Recreate /bids/[id]/leveling as a standalone page — it is a redirect
- Build Phase 5 modules in bid-dashboard (they go in construction-dashboard)
- Build Tier F or auth fixes in construction-dashboard without syncing first

---

## VERSION HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-12 | Initial — 35 modules through Auth Wall A |
| 2.0 | 2026-04-12 | Added Phase 5 (6 sub-phases), Python sidecar, spec pipeline, scheduling, meeting intelligence, super briefing, drawing OCR, Postgres migration, deployment, costs |
| 2.1 | 2026-04-12 | Two-repo strategy (bid-dashboard + construction-dashboard), three parallel streams (A: completion, B: expansion, C: cross-cutting), sync protocol, carried-forward deferrals with ABSORBED tracking, minor enhancements inventory, "never do" rules for repo discipline |
| 2.2 | 2026-04-14 | Added Phase 5G — Submittal Intelligence Layer (4 sub-phases: spec auto-linkage, schedule-tied due dates, distribution templates, workflow templates). Bridges Phase 5A AI extractions into H3 register with backwards-from-required-on-site math |
| 2.3 | 2026-04-16 | Updated all phase statuses to COMPLETE (5A–5G, F1). Added 5H near-term Training Register. Training Register extends sidecar ANALYZE_SYSTEM to extract training[] per section. |
| 2.4 | 2026-04-16 | Phase 5H-3 (Inspections Register) and 5H-4 (Closeout Checklist) complete. All five Phase 5B extraction targets shipped. |
| 2.5 | 2026-04-17 | Tier F F2 complete — Procore REST API push (OAuth 2.0, vendors, contacts, submittals, budget). ProcorePush model, project search + linking, Settings → Procore Integration card. |
| 2.6 | 2026-04-17 | Tier F F3 complete — Bidirectional sync (RFI pull, submittal status sync, webhook receiver + registration). RfiItem + ProcoreWebhookEvent models, syncService, SyncCard + RfiList + WebhookPanel in ProcoreTab. |
| 2.7 | 2026-04-17 | Tier F F4 complete — Schedule push (MSP XML 2007 generator, Procore schedule import API, XML download). mspXmlExport.ts, procorePostFormData multipart helper, scheduleService.ts, SchedulePushCard in ProcoreTab Step 4. |
