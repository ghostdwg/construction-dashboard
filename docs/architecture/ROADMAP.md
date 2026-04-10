# Roadmap — Preconstruction Intelligence System
# Last Updated: Module P2 complete — Trade Tier Classification UI

---

## MASTER WORKFLOW (Official)

This is the intended sequence for every bid:

  1. CREATE BID
     Project name, number, due date, location

  2. UPLOAD DOCUMENTS (Documents tab)
     Spec book and/or drawing sheet index — both optional
     System extracts CSI sections and drawing disciplines
     Supports three job types:
     - Full package: spec book + drawings
     - Drawings only
     - Neither: manual trade entry fallback always works

  3. CONFIRM TRADE LIST (Trades tab)
     System proposes trades from document extraction
     Estimator confirms, removes, or adds manual trades
     Confirmed trades write to BidTrade

  4. BUILD SUB LIST (Subs tab)
     System auto-populates from preferred subs per trade
     Estimator adds or removes as needed
     RFQ list is ready to send

  5. RECEIVE ESTIMATES (Leveling tab)
     Upload sub estimates as they arrive
     Scope lines extracted per sub per trade
     Pricing data stored separately — never touches AI

  6. SCOPE GAP ANALYSIS (AI Review tab)
     AI compares sub scope coverage against spec book
     and drawing requirements
     Gap = something required by documents that no sub covered
     Grounded in contract documents, not inference

  7. LEVELING + QUESTIONS (Leveling tab)
     Side-by-side comparison
     Gap-informed clarification questions sent to subs

  8. AWARD

---

## BID DETAIL TAB ORDER (Updated)

  1. Overview
  2. Documents   ← moved from last position
  3. Trades
  4. Scope
  5. Subs
  6. AI Review
  7. Questions
  8. Leveling
  9. Activity

---

## BUILD SEQUENCE

### Tiers 1–3 ✅ Complete
  All foundation, intelligence, and workflow modules built.
  See CURRENT_STATE.md for full list.

### Module 2b ✅ Complete
  Subcontractor Intelligence Layer
  Tier system, preferred subs, RFQ status tracking

### Module 6a ✅ Complete
  Estimate Intake
  Upload, parse, scope extraction, pricing boundary enforced

### Module 6b ✅ Complete
  Scope Leveling Engine
  LevelingSession, LevelingRow, side-by-side UI, inline editing

### Module 6c ✅ Complete
  Leveling Questions + Export
  AI question drafting, anonymized Excel export

### Audit Session ✅ Complete
  Full workflow debug — type errors, route hardening,
  fetch error states, outreach logging fix

### Module 14 ✅ Complete
  Document Intelligence — combined 14a + 14b

  Spec book upload (pdfjs-dist), CSI section extraction,
  drawing sheet index upload, discipline parsing.
  Three-state matching against full trade dictionary:
  covered / missing from bid / unknown.
  Trade proposal UI with Add to Bid, manual assign, rematch.
  Documents tab at position 2.

### Module 5b ✅ Complete
  Estimate Sanitization — redaction engine
  Strip sub identity and pricing from any estimate format
  before AI comparison. Anonymized tokens only.

### Module 15 ✅ Complete
  AI Review + Gap Analysis (15a + 15b combined)
  15a — Bid Intelligence Brief: AI-generated project brief with
  risk flags, assumptions, addendum summary. BRIEF_STUB_MODE for dev.
  15b — Per-trade scope gap analysis grounded in spec/drawing docs.
  Trade-aware stub generator. GAP_STUB_MODE for dev.
  Add to Questions flow from gap finding cards.

### Module GNG1 ✅ Complete
  Go/No-Go Gate Widget
  Four gates auto-scored from existing bid data — no AI call.
  Project Readiness / Procurement Health / Scope Confidence / Bid Deadline.
  Overall GO / CAUTION / NO-GO banner. Expandable gate cards with
  check-level detail and actionable tab links. Sits above Intelligence Brief
  on Overview tab. Refresh button. Skeleton loading state.

### Module 16a ✅ Complete
  Addendum Delta Processing
  Incremental delta analysis when addendum uploaded after brief exists.
  Original brief stays intact — delta stored per-addendum as JSON on AddendumUpload.
  Delta includes: scope changes (type/cost/schedule impact), new risks (severity),
  clarifications, resolved items, net cost/schedule direction, actions required checklist.
  POST /api/bids/[id]/addendums/[addendumId]/delta — validates brief ready, loads
  previousDeltas for context, stub mode (ADDENDUM_STUB_MODE), live Anthropic call.
  DocumentsTab: card layout per addendum, status badges, Process Addendum button,
  expandable delta detail panel with interactive actions checklist.
  Stale banner on Overview links to Documents tab. Delta processing clears isStale.

---

## TIER A ✅ Complete
  All modules in Tier A are complete.

---

## TIER B

### Module P1 ✅ Complete
  Procurement Timeline Engine
  Pure date-math, no AI calls. calculateTimeline.ts works backward
  from bid.dueDate using 2-week-max offsets per tier:
  T1=14d RFQ, T2=10d, T3=7d. leadTimeDays per trade overrides default.
  PUBLIC bids add 3 days to all offsets.
  Status: ON_TRACK / AT_RISK (≤3d) / OVERDUE (past, unsent) / COMPLETE.
  Urgency: IMMEDIATE / THIS_WEEK / UPCOMING / OK.
  GET /api/bids/[id]/procurement/timeline — sorted by urgency → tier → date.
  PATCH /api/bids/[id]/trades/[tradeId] — tier, leadTimeDays, rfqSentAt, rfqNotes.
  Trades tab: tier selector, lead days input, status badge + RFQ date per row.
  Subs tab: urgency summary banner, trade timeline table, Mark RFQ Sent,
  DBE outreach compliance column (PUBLIC bids only).

### Module P2 ✅ Complete
  Trade Tier Classification UI
  Rule-based keyword classifier — no AI calls, no DB.
  classifyTradeTier.ts: TIER1/TIER2/TIER3 suggestion, reason, typicalLeadDays, criticalPathRisk.
  Auto-suggest hints in Trades tab when classifier disagrees with current tier.
  Dismiss/Apply buttons per hint; dismisses on manual dropdown change too.
  Lead time guidance below input: overdue warning, custom lead note, typical RFQ date.
  Tier health summary panel: three-column grid, color by worst status (red/amber/green/gray).
  Untiered warning banner + bulk apply modal for unreviewed suggestions.
  Critical Path badge on Tier 1 trade rows.
  GNG1 Gate 2 (Procurement Health): new Tier 1 check — OVERDUE → FAIL, AT_RISK → CAUTION.

### Module P3 ✅ Complete
  RFI Register Upgrade
  Schema: RfiStatus enum (OPEN/SENT/ANSWERED/CLOSED/NO_RESPONSE), RfiPriority enum (CRITICAL/HIGH/MEDIUM/LOW).
  New fields on GeneratedQuestion: rfiNumber, priority, responseText, respondedAt, respondedBy, impactFlag, impactNote, sourceRef, dueDate.
  Auto-incrementing RFI numbers per bid (RFI-001, RFI-002…).
  GET /api/bids/[id]/questions: filterable by status/priority, returns summary counts.
  POST /api/bids/[id]/questions: manual question creation with auto-RFI numbering.
  PATCH /api/bids/[id]/questions/[questionId]: status transitions, priority changes, response recording, impact flagging. Ownership-verified before update.
  QuestionsTab UI: summary bar, filter bar (status/priority/trade/search), question cards with inline priority editing.
  Bulk select + bulk actions (Mark Sent, Mark No Response, Close).
  Overdue detection: SENT items past due date or 5+ days without response highlighted with orange border + badge.
  CSV export of filtered question list.
  Migration converts old lowercase status values to new enum format.

### Module P4 ✅ Complete
  Public Bid Compliance Checklist
  Schema: complianceChecklist JSON field on Bid model (nullable String).
  Default 11-item checklist seeded on first access: bonding (bid/performance/payment bond),
  labor (prevailing wage, certified payroll), DBE (goal, good faith, sub listing),
  documentation (insurance, license, pre-qual, non-collusion).
  GET /api/bids/[id]/compliance: returns checklist + summary, seeds defaults if null.
  PATCH /api/bids/[id]/compliance: toggle items, add notes per item.
  ComplianceWidget on Overview tab: category-grouped cards, progress badge, inline notes.
  Only renders for PUBLIC bids; PRIVATE/NEGOTIATED bids see nothing.
  Go/No-Go Gate 5 (Compliance): PUBLIC bids only — all checked → pass, >50% → caution,
  ≤50% → fail. Specific checks for bid bond (fail if unchecked) and DBE goal (caution).

---

## NEVER DO
- Return pricingData to client
- Include sub name or company in any AI prompt
- Mix planning and build execution in same Claude Code session
- Commit .claude/settings.local.json
