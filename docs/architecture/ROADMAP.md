# Roadmap — Preconstruction Intelligence System
# Last Updated: 2026-04-10 — Module RFQ1 (Resend email distribution) complete

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

---

## QUEUED — BUILD SEQUENCE

### Module INT1 — Job Intake (Wing 1)
Priority: HIGH
Dependencies: None
Sessions: 1-2

Extended bid creation form with project context fields.
Delivery method, owner type, building type, SF, constraints.
Conditional field groups based on projectType.
Feeds into 15a prompt and GNG1 gates.

Schema additions on Bid model:
  deliveryMethod    DeliveryMethod?
  ownerType         OwnerType?
  buildingType      String?
  approxSqft        Int?
  stories           Int?
  ldAmountPerDay    Float?
  ldCapAmount       Float?
  occupiedSpace     Boolean   @default(false)
  phasingRequired   Boolean   @default(false)
  siteConstraints   String?
  estimatorNotes    String?
  scopeBoundaryNotes String?
  veInterest        Boolean   @default(false)
  dbeGoalPercent    Float?

  enum DeliveryMethod { HARD_BID  DESIGN_BUILD  CM_AT_RISK  NEGOTIATED }
  enum OwnerType { PUBLIC_ENTITY  PRIVATE_OWNER  DEVELOPER  INSTITUTIONAL }

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
Priority: MEDIUM
Sessions: 8-12 total

H1 Handoff packet — bid vs awarded scope delta
H2 Buyout tracker — sub contracts, POs, committed costs
H3 Submittal register — spec seed, schedule, Procore CSV
H4 Schedule seed — trade sequence to activity list
H5 Owner-facing estimate — high-level rollup export
H6 Budget creation — cost codes to budget lines
H7 Contact handoff — PM team + awarded subs export
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
