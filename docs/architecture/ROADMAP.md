# Roadmap — Preconstruction Intelligence System
# Last Updated: 2026-04-11 — Module H4 (Schedule Seed) complete

---

## SYSTEM MISSION

A modular preconstruction intelligence platform that covers the full
project lifecycle — from bid intake through post-award handoff.

Three wings drive the pursuit phase. Post-award modules carry
ingested data forward into project execution without re-entry.

The system is designed for a solo estimator managing multiple bids
simultaneously. Every feature earns its place by removing manual work
or catching something that would otherwise be missed.

---

## ARCHITECTURE — THREE WINGS + LIFECYCLE

### Phase 1 — Pursuit (bid management)

  Wing 1: JOB INTAKE
  What kind of job is this? Public or private? Design-build or hard bid?
  Capture project context before any AI analysis runs.
  Branches risk and compliance based on projectType.
  Everything downstream depends on this being right.

  Wing 2: SCOPE INTELLIGENCE
  What does the spec book actually require?
  What are subs including and excluding?
  Flag gaps between spec requirements and sub proposals.
  Catch exclusions that need to raise flags.

  Wing 3: BID LEVELING
  Make proposals comparable — apples to apples.
  Normalize scope coverage across subs per trade.
  Support the award decision with structured data.

### Phase 2 — Award Gate

  Bid status transitions to AWARDED.
  UI shifts from pursuit modules to post-award modules.
  All pursuit data carries forward — nothing lost at transition.

### Phase 3 — Post-Award / Handoff

  Awarded projects get a different module set.
  Goal: eliminate re-entry of data that was already captured
  during pursuit. Roll ingested material into project execution tools.

---

## FRAMEWORK REFERENCE

Every module maps to a phase in the Universal Bid Analysis Framework.

| Framework Phase | Coverage |
|----------------|----------|
| Phase 0 — Job intake | Module INT1 (NEW) |
| Phase 1 — Document ingestion | Module 14 + 15a |
| Phase 2 — Quantity takeoff | Tier C — Module Q1 |
| Phase 3 — Risk assessment | Module 15a risk flags + GNG1 |
| Phase 4 — Procurement strategy | Tier B — Modules P1-P4 |
| Phase 4a — RFQ distribution | Module RFQ1 (NEW) |
| Phase 5 — RFI management | Questions tab + Module P3 |
| Phase 6 — Estimate development | Modules 6a-6c + Tier C |
| Phase 7 — Bid assembly | Tier D — Module BA1 |
| Phase 8 — Post-bid management | Tier D — Modules PB1-PB3 |
| Post-award — Handoff | Tier E (NEW) |
| Post-award — Procore bridge | Tier F (NEW) |
| Addendum processing | Module 16a |
| Go/no-go gates | Module GNG1 |

---

## MASTER WORKFLOW

Every bid follows this sequence:

  1. CREATE BID + JOB INTAKE (Module INT1)
     Project name, number, due date, location
     projectType: PUBLIC / PRIVATE / NEGOTIATED
     Delivery method: hard bid / design-build / CM-at-risk / negotiated
     Structured intake branches by project type

  2. UPLOAD DOCUMENTS (Documents tab)
     Spec book and/or drawing sheet index
     Addendums uploaded as issued
     Document upload triggers Module 15a brief automatically

  3. GENERATE PROJECT BRIEF (Overview tab — automatic)
     Module 15a reads Division 1, spec sections, drawing disciplines
     Produces four-section brief: what, how, risk, assumptions

  4. CONFIRM TRADE LIST (Trades tab)
     System proposes trades from document parsing
     Estimator confirms, removes, or adds trades manually

  5. BUILD SUB LIST (Subs tab)
     Auto-populated from preferred subs per trade
     Procurement timeline auto-calculated

  6. SEND RFQs (Module RFQ1)
     Select subs to invite per trade
     System generates professional RFQ email per sub
     Sends via Resend API — logs in OutreachLog

  7. RECEIVE ESTIMATES (Leveling tab)
     Upload sub estimates — sanitized automatically

  8. PER-TRADE SCOPE GAP ANALYSIS (AI Review tab)
     Module 15b compares sub scope per trade against documents

  9. LEVELING + QUESTIONS (Leveling + Questions tabs)
     Side-by-side comparison with gap-informed questions

 10. GO/NO-GO DECISION (Overview tab)
     Five gates: timeline, coverage, documents, risk, compliance

 11. AWARD DECISION
     Status to AWARDED — UI transitions to post-award modules

 12. POST-AWARD HANDOFF (Tier E)
     Handoff packet, buyout tracking, submittal register,
     schedule seed, budget creation, contact handoff

 13. PROCORE EXPORT (Tier F)
     CSV export (F1) then API integration (F2)

---

## COMPLETED MODULES

| Module | Description | Status |
|--------|-------------|--------|
| Tiers 1-3 | Core schema, UI, navigation | COMPLETE |
| Module 2b | Subcontractor Intelligence Layer | COMPLETE |
| Module 5b | Estimate Sanitization | COMPLETE |
| Module 6a | Estimate Intake | COMPLETE |
| Module 6b | Scope Leveling Engine | COMPLETE |
| Module 6c | Leveling Questions + Export | COMPLETE |
| Audit | Full workflow debug session | COMPLETE |
| Module 14 | Document Intelligence | COMPLETE |
| Module 15 | AI Review + Gap Analysis | COMPLETE |
| Module 15a | Bid Intelligence Brief | COMPLETE |
| Module 15b | Per-Trade Scope Gap Analysis | COMPLETE |
| Module GNG1 | Go/No-Go Gate Widget | COMPLETE |
| Module 16a | Addendum Delta Processing | COMPLETE |
| Tier A | AI Layer + Core Data Model | COMPLETE |
| Modules P1-P4 | Procurement (timeline, tiers, RFI, compliance) | COMPLETE |
| Tier B | Procurement Intelligence Layer | COMPLETE |
| Tier C | Estimate Intelligence (C1-C3) | COMPLETE |
| Tier D | Bid Assembly + Post-Bid (D1-D3) | COMPLETE |
| Procore Import | CSV import + isPreferred + DELETE | COMPLETE |
| AI Token Config | Per-call token management + presets | COMPLETE |
| Theme Toggle | Light/dark mode with full app dark coverage | COMPLETE |
| Module RFQ1 | RFQ Email Distribution via Resend | COMPLETE |
| Module INT1 | Job Intake — Wing 1 project context capture | COMPLETE |
| Module H1   | Handoff Packet — Tier E entry point | COMPLETE |
| Module H1+  | Project Contacts — owner/architect/engineer/internal team | COMPLETE |
| Module H2   | Buyout Tracker — per-trade contracts + rollup | COMPLETE |
| Module H3   | Submittal Register — regex seeder, lifecycle, Procore CSV export | COMPLETE |
| Module H4   | Schedule Seed — canonical CSI sequence, FS chain, MSP CSV export | COMPLETE |

---

## QUEUED — BUILD SEQUENCE

### Module INT1 — Job Intake (Wing 1) ✅ COMPLETE (2026-04-10)
Priority: shipped

Captures project context after bid creation via an editable card on the Overview tab.
14 fields across 5 sections branching downstream AI analysis, GNG1 gates, and post-award handoff.

Schema additions (migration 20260410225347_int1_job_intake) on Bid model:
  deliveryMethod     String?  // HARD_BID, DESIGN_BUILD, CM_AT_RISK, NEGOTIATED — validated in API
  ownerType          String?  // PUBLIC_ENTITY, PRIVATE_OWNER, DEVELOPER, INSTITUTIONAL — validated in API
  buildingType       String?
  approxSqft         Int?
  stories            Int?
  ldAmountPerDay     Float?
  ldCapAmount        Float?
  occupiedSpace      Boolean   @default(false)
  phasingRequired    Boolean   @default(false)
  siteConstraints    String?
  estimatorNotes     String?
  scopeBoundaryNotes String?
  veInterest         Boolean   @default(false)
  dbeGoalPercent     Float?

String fields validated in API layer (POST /api/bids and PATCH /api/bids/[id])
rather than as Prisma enums (SQLite-friendly).

UI: app/bids/[id]/JobIntakePanel.tsx
- Empty state: prominent dashed-border CTA "Complete Project Intake → Start Intake"
- Edit state: 5 collapsible sections with text/number/select/checkbox/textarea fields
  - Section 3 (Public Bid Terms — LD/DBE) only renders when projectType === PUBLIC
- Summary state: 2-column grid showing populated fields, Edit link in header
- Auto-collapses to summary after save

Brief prompt integration: assembleBriefPrompt.ts adds Section A2 "PROJECT INTAKE"
between project identity and Division 1. Only emits populated fields. Prompts the
AI to factor intake constraints into risk flags and assumptions.

GNG1 integration: go-no-go route adds "Project intake captured" check to
Project Readiness gate. 0 fields → fail, <50% → caution, ≥50% → pass.
PUBLIC bids count 14 total fields, others count 11 (LD/DBE not counted).

Files shipped:
  prisma/migrations/20260410225347_int1_job_intake/migration.sql
  prisma/schema.prisma (Bid model extended)
  app/api/bids/route.ts (POST validates intake fields)
  app/api/bids/[id]/route.ts (PATCH validates + applies intake fields)
  app/bids/[id]/JobIntakePanel.tsx (NEW — editable card with 5 sections)
  app/bids/[id]/page.tsx (mounts JobIntakePanel above SubmissionPanel)
  lib/services/ai/assembleBriefPrompt.ts (Section A2 PROJECT INTAKE)
  app/api/bids/[id]/go-no-go/route.ts (Project intake captured check)

### Module RFQ1 — RFQ Email Distribution ✅ COMPLETE (2026-04-10)
Priority: shipped
Dependencies: Resend account + domain verification (operational, not code)
Status: build complete; LIVE EMAIL SEND PENDING USER TEST

Send RFQ emails from Subs tab via Resend API.
React Email template with project details + scope summary.
Delivery/open/bounce tracking via webhooks (no-op on localhost).
OutreachLog status updates with delivery lifecycle independent of higher-level outreach status.

Dependencies installed: resend, @react-email/components
New env (optional — code degrades gracefully if absent):
  RESEND_API_KEY      — required to send mail; absent → 503 from /api/bids/[id]/rfq/send
  RESEND_FROM_EMAIL   — required, must be a verified sender domain in Resend
  ESTIMATOR_NAME      — default for the Send RFQ confirmation modal
  ESTIMATOR_EMAIL     — default reply-to for the Send RFQ confirmation modal

OutreachLog extensions (added in migration 20260410222200_add_email_tracking):
  emailMessageId String?  @indexed
  deliveryStatus String?  // QUEUED, SENT, DELIVERED, OPENED, BOUNCED, FAILED
  openedAt       DateTime?
  bouncedAt      DateTime?
  bounceReason   String?

Files shipped:
  lib/services/email/resendClient.ts — singleton client + sendRfqEmail()
  lib/emails/RfqInvitation.tsx — React Email template, no pricing, sub identity OK
  app/api/bids/[id]/rfq/send/route.ts — POST: sends batch, creates OutreachLog rows
  app/api/bids/[id]/rfq/status/route.ts — GET: per-sub delivery status + emailConfigured flag
  app/api/webhooks/resend/route.ts — POST: receives Resend events, updates OutreachLog
  app/bids/[id]/RfqSendModal.tsx — confirmation modal with recipient list + estimator inputs
  app/bids/[id]/SubsTab.tsx — checkboxes per row, Select All per trade group, Send RFQ button,
                              delivery badge per row, banner showing batch result

Boundary preserved: no pricing data anywhere in the email pipeline. Custom message
renders into the email body but is NOT persisted to OutreachLog (option b — discard).

LIVE TEST PENDING: verify with self-send once RESEND_API_KEY + RESEND_FROM_EMAIL are
added to .env.local and a domain is verified in the Resend dashboard.

### Tier E — Post-Award Handoff Layer (H1-H8)
Priority: IN PROGRESS
Status: H1 shipped 2026-04-10. H1+ / H2 / H3 / H4 all shipped 2026-04-11. H5-H8 queued.

### Module H1 — Handoff Packet ✅ COMPLETE (2026-04-10)

Tier E entry point. Compiles the bid + intake + awarded subs + open items +
risk flags + document inventory into a single packet. JSON API for UI, XLSX
export for sending to PMs. Works for any bid status — preview mode shows a
banner when not awarded.

Architecture: pure data aggregation. No new schema, no re-entry of data.
Reads from existing pursuit-phase tables (Bid, BidTrade, BidInviteSelection,
GeneratedQuestion, BidIntelligenceBrief, SpecBook, DrawingUpload,
AddendumUpload, BidSubmission).

Awarded-sub detection: BidInviteSelection.rfqStatus === "accepted" is the
award signal. If multiple are accepted for a trade, first wins; if none,
awarded fields are null.

Files shipped:
  lib/services/handoff/assembleHandoffPacket.ts — pure aggregation service
  app/api/bids/[id]/handoff/route.ts — GET: returns JSON packet
  app/api/bids/[id]/handoff/export/route.ts — POST: returns 5-sheet XLSX
  app/bids/[id]/HandoffTab.tsx — new bid detail tab (#10)
  app/bids/[id]/TabBar.tsx — Handoff tab added at position 10
  app/bids/[id]/page.tsx — HandoffTab mounted
  app/bids/[id]/SubmissionPanel.tsx — "View Handoff Packet →" link when outcome=won

XLSX sheets:
  1. Project Summary — identity, profile, constraints, compliance (PUBLIC only)
  2. Trade Awards — trade/CSI/tier/sub/contact/amount(empty)/status
  3. Open Items — open RFIs + unresolved assumptions + risk flags
  4. Contacts — awarded sub contacts (owner/architect deferred)
  5. Documents — spec/drawing/addendum inventory

UI sections on the Handoff tab:
  1. Project Summary card — intake context + total bid amount
  2. Trade Awards table — per-trade with awarded sub + contact + status badge
     (Amount column omitted — deferred to H2)
  3. Open Items — count badges with expandable detail panels for RFIs,
     assumptions, risk flags
  4. Document Inventory — spec/drawing/addendum table with type badges

Boundary preserved:
- EstimateUpload.pricingData NEVER touched
- Sub names ARE included (packet is internal, never sent to AI)
- Per-trade dollar amounts left null with a footnote pointing to H2

Explicit deferrals (tracked for follow-up modules):
- Per-trade buyout amounts → Module H2 (Buyout Tracker) — DONE
- Contract status beyond PENDING → Module H2 (BuyoutItem.contractStatus) — DONE
- Owner, architect, internal team contacts → ProjectContact model — DONE (2026-04-11)
- "Copy to Clipboard" text summary → follow-up if XLSX proves insufficient

### Module H1+ — Project Contacts ✅ COMPLETE (2026-04-11)

Cleared the H1 deferred owner/architect/internal-team contacts loose end. Also
front-loads the data H7 (Contact Handoff) will need so that module becomes
mostly export work.

Schema additions (migration 20260411153143_h1_project_contacts):

  model ProjectContact {
    id, bidId,
    role (default "OTHER"),
    name (required), company?, title?, email?, phone?, notes?,
    isPrimary (default false),
    createdAt, updatedAt,
    @@index([bidId]), @@index([bidId, role])
  }

Valid role values (validated in API, not enum for SQLite):
  OWNER, OWNER_REP, ARCHITECT, ENGINEER,
  INTERNAL_PM, INTERNAL_ESTIMATOR, INTERNAL_SUPER, OTHER

Multiple primaries per role allowed (no demote-when-promote logic) — primaries
just sort first within their role group.

Service layer (lib/services/contacts/projectContactService.ts):
- loadProjectContactsForBid: returns rows sorted by role > primary > name
- createProjectContact: validates role + non-empty name, checks bid exists
- updateProjectContact: ownership check, role + name validation
- deleteProjectContact: ownership check

API routes:
- GET    /api/bids/[id]/contacts                → { items }
- POST   /api/bids/[id]/contacts                → creates a contact
- PATCH  /api/bids/[id]/contacts/[contactId]    → updates a contact
- DELETE /api/bids/[id]/contacts/[contactId]    → deletes a contact

UI (app/bids/[id]/ProjectContactsPanel.tsx):
- Reusable, self-contained component. Mounted on BOTH the Overview tab
  (between JobIntakePanel and SubmissionPanel) and the Handoff tab
  (between Project Summary and Trade Awards). Same data source.
- Click-to-edit rows with full form (role, name, title, company, email, phone,
  notes, isPrimary). New rows open in edit mode.
- Empty state with "Add your first contact →" CTA.
- Optional onChanged callback so parents can refetch dependent data.

H1 integration:
- HandoffPacket.projectContacts added as top-level field
- assembleHandoffPacket reads via loadProjectContactsForBid
- Contacts XLSX sheet rebuilt: "Owner & Project Team" section above
  "Awarded Subcontractors" — replaces the deferred-note placeholder.
  Primary contacts marked with ★ in the Name column.

Files shipped:
  prisma/migrations/20260411153143_h1_project_contacts/migration.sql
  prisma/schema.prisma (ProjectContact model + Bid relation)
  lib/services/contacts/projectContactService.ts (NEW)
  app/api/bids/[id]/contacts/route.ts (NEW — GET + POST)
  app/api/bids/[id]/contacts/[contactId]/route.ts (NEW — PATCH + DELETE)
  app/bids/[id]/ProjectContactsPanel.tsx (NEW)
  app/bids/[id]/page.tsx (mount on Overview)
  app/bids/[id]/HandoffTab.tsx (mount on Handoff tab)
  lib/services/handoff/assembleHandoffPacket.ts (projectContacts integration)
  app/api/bids/[id]/handoff/export/route.ts (rebuilt Contacts sheet)

### Module H2 — Buyout Tracker ✅ COMPLETE (2026-04-11)

Per-trade contract tracking. Populates the Trade Awards `bidAmount` +
`contractStatus` columns that H1 left blank/hardcoded. One BuyoutItem per
BidTrade, auto-created on first GET, inline-editable on the Handoff tab.

Schema additions (migration 20260411014717_h2_buyout_tracker):

  model BuyoutItem {
    id, bidId, bidTradeId (unique), subcontractorId?,
    committedAmount?, originalBidAmount?,
    contractStatus (default "PENDING"),
    loiSentAt?, contractSentAt?, contractSignedAt?,
    poNumber?, poIssuedAt?,
    changeOrderAmount (default 0), paidToDate (default 0),
    retainagePercent (default 5),
    notes?, createdAt, updatedAt,
    @@index([bidId]), @@index([subcontractorId])
  }

Valid contractStatus values (validated in API layer, not enum for SQLite):
  PENDING, LOI_SENT, CONTRACT_SENT, CONTRACT_SIGNED, PO_ISSUED, ACTIVE, CLOSED

Service layer (lib/services/buyout/buyoutService.ts):
- loadBuyoutItemsForBid: auto-creates missing rows, returns full rows with
  derived fields (totalCommitted, remainingToPay, retainageHeld)
- computeBuyoutRollup: total committed/paid/remaining/retainage + status histogram
- updateBuyoutItem: ownership check, numeric non-negativity, status enum,
  retainagePercent 0-100

API routes:
- GET  /api/bids/[id]/buyout           → { items, rollup }
- PATCH /api/bids/[id]/buyout/[itemId] → updates one row

UI (app/bids/[id]/BuyoutTracker.tsx):
- Rollup card at top (committed / paid / remaining / retainage)
- One editable row per trade with: committed amount, PO#, status dropdown,
  paid-to-date, expandable detail panel (COs, totals, retainage, notes)
- Save button appears only when row is dirty
- After save: reloads local state AND bumps parent's packetReloadTick to
  refresh the Trade Awards table above

H1 integration:
- assembleHandoffPacket reads BuyoutItem.totalCommitted into TradeAward.bidAmount
- Per-sub contractStatus on AwardedSub uses "weakest link" (earliest-stage)
  across all trades that sub is awarded on
- HandoffPacket.buyoutRollup added as top-level field

XLSX export changes:
- Trade Awards sheet: "Committed" column now shows real amounts + total row
- NEW sheet "Buyout Summary" (position 3): per-trade committed/COs/total/paid/
  remaining/retainage with totals row
- Project Summary sheet: new "Buyout Rollup" section

Files shipped:
  prisma/migrations/20260411014717_h2_buyout_tracker/migration.sql
  prisma/schema.prisma (BuyoutItem model + relations on Bid/BidTrade/Subcontractor)
  lib/services/buyout/buyoutService.ts (NEW)
  lib/services/handoff/assembleHandoffPacket.ts (buyout integration)
  app/api/bids/[id]/buyout/route.ts (NEW — GET)
  app/api/bids/[id]/buyout/[itemId]/route.ts (NEW — PATCH)
  app/api/bids/[id]/handoff/export/route.ts (Buyout Summary sheet + rollup)
  app/bids/[id]/BuyoutTracker.tsx (NEW)
  app/bids/[id]/HandoffTab.tsx (BuyoutTracker mount + packet refetch on change)

Explicit deferrals:
- Automatic originalBidAmount population from leveling data → future module
- AIA-style pay-app tracking (line item breakdown per payment) → out of scope
- PO issuance to sub via email → future (reuses RFQ1 Resend infrastructure)

### Module H3 — Submittal Register ✅ COMPLETE (2026-04-11)

Full lifecycle submittal register. Extracts required submittals from spec
book rawText via regex, then manages them through the 8-stage lifecycle.
Exports to Procore's submittal import CSV format — first piece of Tier F.

Schema additions (migration 20260411031055_h3_submittal_register):

  model SubmittalItem {
    id, bidId, bidTradeId?, specSectionId?,
    submittalNumber?, title, description?, type (default "OTHER"),
    status (default "PENDING"),
    requiredBy?, requestedAt?, receivedAt?, reviewedAt?, approvedAt?,
    responsibleSubId?, reviewer?, notes?,
    createdAt, updatedAt,
    @@index([bidId]), @@index([specSectionId]), @@index([status])
  }

Valid type values (validated in API, not enum for SQLite):
  PRODUCT_DATA, SHOP_DRAWING, SAMPLE, MOCKUP, WARRANTY, O_AND_M, LEED, CERT, OTHER

Valid status values:
  PENDING, REQUESTED, RECEIVED, UNDER_REVIEW, APPROVED, APPROVED_AS_NOTED, REJECTED, RESUBMIT

Services (lib/services/submittal/):
- seedSubmittalRegister.ts — regex-based extraction from SpecSection.rawText.
  Idempotent (skips existing items by specSectionId + normalized title).
  Classifies lines into types via ordered TYPE_KEYWORDS patterns.
  Auto-links responsibleSub from accepted RFQ selection.
- submittalService.ts — CRUD + rollup. loadSubmittalsForBid computes
  `isOverdue` server-side (avoids Date.now() in React render per React 19
  purity rule). updateSubmittal auto-advances lifecycle timestamps when
  status changes.

API routes:
- GET    /api/bids/[id]/submittals              → { items, rollup } with status/type/bidTradeId filters
- POST   /api/bids/[id]/submittals              → manually add a row
- POST   /api/bids/[id]/submittals/seed         → runs regex seeder, returns counts
- POST   /api/bids/[id]/submittals/export       → downloads Procore-compatible CSV
- PATCH  /api/bids/[id]/submittals/[itemId]     → update one row
- DELETE /api/bids/[id]/submittals/[itemId]     → delete one row

UI (app/bids/[id]/SubmittalsTab.tsx):
- New tab at position 11 "Submittals"
- Rollup card (total, pending, in-review, approved, overdue)
- Seed from Specs / + Add Submittal / Export Procore CSV action buttons
- Status + Type filters
- Table with inline status dropdown per row, expandable detail editor
- Overdue rows highlighted with red background + bold requiredBy
- Empty state shows "Seed from Specs" prompt

H1 integration:
- HandoffPacket.submittalRollup added as top-level field
- HandoffTab gains a compact Submittal Register summary card below Buyout Tracker
  with a "Open Submittals tab →" link
- XLSX export adds "Submittals" sheet at position 4 (sheets are now 7 total)
- Project Summary sheet gains a "Submittal Register" rollup section

Procore CSV export format:
- Columns: Number, Title, Spec Section, Responsible Contractor, Submittal
  Manager, Received From, Type, Status, Required On-Site Date, Description
- Types mapped to Procore vocabulary (e.g. SHOP_DRAWING → "Shop Drawings",
  PRODUCT_DATA → "Product Data", O_AND_M → "Operation and Maintenance Manual")
- Statuses compressed to Procore's 4-state model (Draft, Open, Closed,
  Revise and Resubmit)
- This is the first piece of Tier F (Procore integration). Full Tier F1
  will extend this pattern to vendors, budget, and contacts.

Files shipped:
  prisma/migrations/20260411031055_h3_submittal_register/migration.sql
  prisma/schema.prisma (SubmittalItem model + relations on Bid/BidTrade/Subcontractor/SpecSection)
  lib/services/submittal/seedSubmittalRegister.ts (NEW)
  lib/services/submittal/submittalService.ts (NEW)
  lib/services/handoff/assembleHandoffPacket.ts (submittalRollup integration)
  app/api/bids/[id]/submittals/route.ts (NEW — GET + POST)
  app/api/bids/[id]/submittals/[itemId]/route.ts (NEW — PATCH + DELETE)
  app/api/bids/[id]/submittals/seed/route.ts (NEW)
  app/api/bids/[id]/submittals/export/route.ts (NEW — Procore CSV)
  app/api/bids/[id]/handoff/export/route.ts (Submittals sheet + rollup section)
  app/bids/[id]/SubmittalsTab.tsx (NEW)
  app/bids/[id]/TabBar.tsx (Submittals tab at position 11)
  app/bids/[id]/page.tsx (SubmittalsTab mount)
  app/bids/[id]/HandoffTab.tsx (Submittal Register summary card)

Explicit deferrals:
- AI-driven submittal extraction (Option B from planning) — regex-first works
  for 70% of cases; AI upgrade deferred pending real-world accuracy signal
- Submittal attachments / file uploads → future module
- Review round tracking (1st submission, resubmission, re-resubmission) → future
- Email-based submittal distribution → reuses RFQ1 Resend infra when added

### Module H4 — Schedule Seed ✅ COMPLETE (2026-04-11)

Turns the bid's trade list into a starter construction schedule — sequenced
activities with durations, start/finish dates, and predecessors. Exports to
MS Project CSV so the PM's day 1 isn't "retype every trade into P6/MSP".

Schema additions (migration 20260411154112_h4_schedule_seed):

  Bid model — 2 new fields:
    constructionStartDate DateTime?
    projectDurationDays   Int?

  model ScheduleActivity {
    id, bidId, bidTradeId?,
    activityId (Primavera-style, e.g. "A1010"),
    name, kind (default "CONSTRUCTION"), sequence (default 0),
    durationDays (default 5), startDate?, finishDate?, predecessorIds?,
    notes?, createdAt, updatedAt,
    @@index([bidId]), @@index([bidId, sequence])
  }

Valid kind values (validated in API, not enum for SQLite):
  CONSTRUCTION, MILESTONE

v1 design decisions (from planning session):
- One CONSTRUCTION activity per BidTrade (procurement stays on Subs tab)
- Canonical CSI division sequence as seed; estimator reorders manually
- Duration defaults hardcoded in lib/services/schedule/durationDefaults.ts
- FS predecessors only, chained sequentially (no SS/FF/SF or lag)
- Mon-Fri working days, no holidays (MSP tracks those after import)
- MSP CSV only for v1 export (Procore schedule is .xer/.mpp territory)
- Table-only UI for v1 (SVG Gantt deferred to v1.5)
- constructionStartDate lives on Job Intake, not a separate schedule field

Services (lib/services/schedule/):
- durationDefaults.ts — CSI_DIVISION_SEQUENCE (ordered array),
  DIVISION_DURATION_DAYS lookup, csiDivision() normalizer,
  defaultDurationFor() + compareByDivisionOrder() helpers
- scheduleService.ts — seedScheduleActivities, recalculateSchedule,
  loadScheduleForBid, createScheduleActivity, updateScheduleActivity,
  deleteScheduleActivity. All mutations auto-recalc the schedule so
  start/finish dates stay in sync with duration + predecessor chain.

API routes:
- GET    /api/bids/[id]/schedule                 → { activities, summary }
- POST   /api/bids/[id]/schedule                 → manually add activity
- POST   /api/bids/[id]/schedule/seed            → runs seeder, returns counts
- POST   /api/bids/[id]/schedule/recalculate     → forward-walks all dates
- POST   /api/bids/[id]/schedule/export          → MSP CSV download
- PATCH  /api/bids/[id]/schedule/[activityId]    → update one row
- DELETE /api/bids/[id]/schedule/[activityId]    → delete one row

UI (app/bids/[id]/ScheduleTab.tsx):
- New tab at position 12 "Schedule"
- Project summary card (construction start, substantial completion, total
  duration, activity counts)
- Action bar: Seed from Trades / Recalculate Dates / + Add Activity / Export MSP CSV
- Inline-editable table: ID | Activity | Duration | Start | Finish | Predecessors
- Save button appears per-row only when dirty; delete × per row
- Missing-start-date warning banner when activities exist but constructionStartDate is null

JobIntakePanel extension:
- New Construction Start Date field in Project Profile section
- Pulls from / writes to Bid.constructionStartDate via the existing PATCH route
- New DateField helper component added to the form library
- API PATCH route calls recalculateSchedule when the field changes

H1 integration:
- HandoffPacket.scheduleSummary added as top-level field
- assembleHandoffPacket reads via loadScheduleForBid (summary only)
- HandoffTab UI gains a Project Schedule summary card with "Open Schedule tab →" link
- XLSX export adds "Schedule" sheet at position 5 (sheets are now 8 total)
- Project Summary XLSX sheet gains a "Project Schedule" section

Files shipped:
  prisma/migrations/20260411154112_h4_schedule_seed/migration.sql
  prisma/schema.prisma (ScheduleActivity model + 2 Bid fields + relations)
  lib/services/schedule/durationDefaults.ts (NEW)
  lib/services/schedule/scheduleService.ts (NEW)
  lib/services/handoff/assembleHandoffPacket.ts (scheduleSummary integration)
  app/api/bids/[id]/route.ts (constructionStartDate handling + recalc trigger)
  app/api/bids/[id]/schedule/route.ts (NEW — GET + POST)
  app/api/bids/[id]/schedule/[activityId]/route.ts (NEW — PATCH + DELETE)
  app/api/bids/[id]/schedule/seed/route.ts (NEW)
  app/api/bids/[id]/schedule/recalculate/route.ts (NEW)
  app/api/bids/[id]/schedule/export/route.ts (NEW — MSP CSV)
  app/api/bids/[id]/handoff/export/route.ts (Schedule sheet + rollup section)
  app/bids/[id]/ScheduleTab.tsx (NEW)
  app/bids/[id]/TabBar.tsx (Schedule tab at position 12)
  app/bids/[id]/page.tsx (ScheduleTab mount + constructionStartDate in initial prop)
  app/bids/[id]/JobIntakePanel.tsx (constructionStartDate field + DateField helper)
  app/bids/[id]/HandoffTab.tsx (Project Schedule summary card)

Explicit deferrals:
- SVG Gantt visualization → v1.5 (CSV is primary delivery)
- Drag-to-reorder activities → v1.5 (sequence editable via PATCH today)
- SS/FF/SF predecessors + lag → future (this is a seed, not a CPM engine)
- Holiday calendar → never (MSP tracks these after import)
- Procore schedule format → future (Procore uses .xer/.mpp primarily)
- Procurement activities in the schedule → never (P1 timeline is the source)

### Queued — H5 through H8

H5 Owner-facing estimate — high-level rollup export
H6 Budget creation — cost codes to budget lines
H7 Contact handoff — PM team + awarded subs export (ProjectContact model already exists from H1+ cleanup; H7 is mostly export work)
H8 Award notifications — via Resend (reuses RFQ1 infra)

### Tier F — Procore Integration Bridge
Priority: LOW
Sessions: 5-8 total

F1 CSV/XLSX export — vendor, budget, submittal, contact imports
F2 REST API — OAuth 2.0, project/vendor/budget/submittal push
F3 Bidirectional sync — webhooks, RFI sync (future)

### UI Nav Refactor
Priority: AFTER Tier E stable
Sessions: 2-3

Sidebar nav with phase groupings.
Pursuit tabs vs post-award modules based on bid status.
All pursuit data stays accessible in collapsed section.

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
- Update project instructions at end of every module

---

## NEVER DO

- Return pricingData to client
- Include sub name or company in any AI prompt
- Include Subcontractor.isPreferred in any AI prompt or sub-facing export
- Mix planning and build execution in same Claude Code session
- Commit .claude/settings.local.json
- Recreate /bids/[id]/leveling as a standalone page — it is a redirect
