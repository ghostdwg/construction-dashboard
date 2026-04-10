# Roadmap — Preconstruction Intelligence System
# Last Updated: AI Token Config + Procore Import + Tier D complete

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

  8. SUBMIT (StatusButton → SubmitBidModal)
     Bid amount captured, snapshot frozen, status → submitted

  9. AWARD (OutcomeModal)
     Outcome recorded (won/lost/withdrawn) with reason, lessons learned
     Post-bid analytics dashboard tracks win rate, accuracy, gap to winner

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

## TIER C ✅ Complete

### Module C1 ✅ Complete
  Bid Spread Analysis
  parsePricingTotal.ts: extracts dollar amounts from pricingData JSON, heuristic total
  (grand total line > subtotal sum > line item sum). Caches parsedTotal on EstimateUpload.
  GET /api/bids/[id]/estimates/spread: per-trade min/median/max spread, outlier flagging.
  BidSpreadPanel on Leveling tab: horizontal spread bars, expandable per-trade detail table.
  pricingData raw JSON NEVER returned to client — only computed aggregates.

### Module C2 ✅ Complete
  Scope-Cost Correlation
  GET /api/bids/[id]/estimates/value-matrix: per-trade, per-estimate scope coverage %
  from LevelingRow status + cost position (low/median/high) + value flag
  (best_value/low_coverage/high_cost/ok).
  Integrated into BidSpreadPanel expanded view: coverage %, value badge per sub.

### Module C3 ✅ Complete
  Estimate Intelligence Summary
  GET /api/bids/[id]/estimates/intelligence: rule-based recommendations from spread + coverage.
  Types: outlier (>25% from median), coverage_gap (<70% on low bidder), best_value (>85% at median),
  missing_estimate (no estimates for trade), single_bid (no competition).
  EstimateIntelligenceCard on Leveling tab: severity-grouped findings, expandable detail.
  No AI — pure math, server-side only.

---

## TIER D ✅ Complete

### Module D1 ✅ Complete
  Bid Submission Snapshot
  New BidSubmission model: bidId (unique), submittedAt, submittedBy, ourBidAmount, notes,
  plus 6 frozen JSON snapshot fields (brief, questions, compliance, spread, gates, intelligence).
  captureBidSnapshot.ts: aggregates bid state into compact snapshot for archival.
  POST /api/bids/[id]/submit: validates not-already-submitted, captures snapshot,
  creates BidSubmission record, updates Bid.status to "submitted".
  GET /api/bids/[id]/submission: returns submission record or null.
  StatusButton: "submitted" status triggers SubmitBidModal (amount, by, notes).
  SubmissionPanel on Overview tab: timestamp, by, amount, snapshot summary (collapsed).
  Status flow: draft → active → leveling → submitted → awarded/lost/cancelled.

### Module D2 ✅ Complete
  Award Outcome Tracking
  Outcome fields on BidSubmission: outcome (won/lost/withdrawn/no_decision), outcomeAt,
  winningBidAmount, ourRank, totalBidders, lostReason, lostReasonNote, lessonsLearned.
  PATCH /api/bids/[id]/submission/outcome: updates outcome, cascades Bid.status
  (won → awarded, lost → lost, withdrawn → cancelled). Returns derived bidAccuracyPercent.
  OutcomeModal: outcome dropdown with conditional fields (winning amount, rank, lost reason).
  SubmissionPanel: outcome badge, lost detail (winning bid, gap, rank), lessons learned.

### Module D3 ✅ Complete
  Post-Bid Analytics Dashboard
  GET /api/reports/post-bid: aggregates all submissions into win rate / project type /
  lost reasons / recent submissions. Pure SQL, no AI.
  /reports/post-bid page: summary cards, by-project-type table, lost reasons bar chart,
  recent submissions table with outcome badges.
  Bid list page: status badges, our bid amount, submitted date columns.
  Summary banner on bid list: active / submitted / won / lost counts + win rate.

---

## OPERATIONS ✅ Complete
  Cross-cutting infrastructure that doesn't belong to a numbered tier.

### Procore CSV Import ✅ Complete
  Subcontractor import + isPreferred field + dedup by procoreVendorId.
  Schema: Subcontractor.isPreferred (INTERNAL ONLY — never in AI prompts or sub-facing
  exports), Subcontractor.procoreVendorId (unique, used for re-import dedup).
  parseProcoreCsv.ts: RFC-compliant CSV parser with header aliases, quoted multiline
  fields, BOM, CRLF; auto-detects Procore format via Entity Type column. Catches all
  diversity flags (MBE/WBE/DBE/HUB/etc.) via MWBE_FLAG_HEADERS array.
  matchTradeName.ts: fuzzy matcher (exact normalized → substring → token Jaccard ≥0.5).
  Strips stop words during tokenization.
  POST /api/subcontractors/import: preview with conflict detection (by procoreVendorId
  then by company name) and trade match indicators per row.
  POST /api/subcontractors/import/commit: persists rows in single transaction per row,
  handles create/update/skip actions.
  GET /api/subcontractors/import/template: sample CSV download.
  /subcontractors/import page: upload → preview (per-row Preferred toggle, conflict
  resolution dropdown, trade match green/amber/red indicators) → success.
  AddSubcontractorPanel: isPreferred checkbox on single-sub form.
  DELETE /api/subcontractors/[id]: referential integrity check, refuses if selections/
  estimates/outreachLogs exist (returns 409 with counts), cascades contacts/trades/joins.
  recipients export route hardened with explicit select clause (defensive boundary
  against accidental isPreferred leakage).

### AI Token Config ✅ Complete
  Per-call max_tokens UI with live cost estimates.
  Schema: AiTokenConfig model (callKey unique, maxTokens, updatedAt).
  lib/services/ai/aiTokenConfig.ts: single source of truth for AI call definitions
  (label, model, typical input tokens, default/min/max ceilings, presets, recommended
  preset) and pricing constants (Sonnet/Opus/Haiku). In-process cache with explicit
  invalidation on PATCH. Cost math accounts for both input and output, realistic
  (50% utilization) vs max (100% utilization).
  GET /api/settings/ai-tokens: returns all 5 call configs with current effective values
  + cost estimates per preset.
  PATCH /api/settings/ai-tokens: upserts override (or deletes to revert to default).
  /settings/ai-tokens page: per-call cards with header (label, model, description,
  typical input), current state line (cost realistic + max), 4 preset buttons
  (Minimal/Standard/Extended/Maximum) with token count + cost-per-call labels, REC
  badge on recommended preset, active preset highlighted, reset link if overridden,
  italic blurb describing trade-off. Top banner shows live monthly cost estimate
  (assumes 20 bids/mo, 25 trades each, 2 addendums, 50 leveling questions).
  Settings link added to top nav.
  All 5 AI call sites rewired to await getMaxTokens(callKey):
  - brief → generateBidIntelligenceBrief.ts
  - gap-analysis → app/api/bids/[id]/gap-analysis/generate/route.ts
  - addendum-delta → app/api/bids/[id]/addendums/[addendumId]/delta/route.ts
  - intelligence → app/api/bids/[id]/intelligence/generate/route.ts (legacy route)
  - leveling-question → app/api/bids/[id]/leveling/[rowId]/question/route.ts

### Editable Due Date ✅ Complete
  Click-to-edit on Overview tab via EditableDueDate component.
  Due date field added to NewBidButton modal.
  Drives the procurement timeline engine (no due date → no timeline).

### Legacy /leveling Redirect ✅ Complete
  app/bids/[id]/leveling/page.tsx is a SERVER-SIDE REDIRECT to /bids/[id]?tab=leveling.
  Originally a standalone v0.2 page predating the tabbed bid detail page. Stale links
  on the bid list ("Level →" button) and old bookmarks would land users on a tab-less
  page that looked like the bid detail had been gutted. Do NOT recreate this as a
  standalone page — keep it as a redirect.
  app/bids/page.tsx Level button now points directly at /bids/[id]?tab=leveling.

### Test Infrastructure ✅ Complete
  scripts/tests/ — node:test based, run with --experimental-strip-types.
  Unit tests: parsePricingTotal (14), parseProcoreCsv (19), matchTradeName (16).
  E2E API tests: import flow (50), bid submission (48). 147/147 passing.
  Fixtures: scripts/tests/fixtures/procore-sample.csv with edge cases (empty company,
  multiple diversity flags, embedded commas).

---

## NEVER DO
- Return pricingData to client
- Include sub name or company in any AI prompt
- Include Subcontractor.isPreferred in any AI prompt or sub-facing export
- Mix planning and build execution in same Claude Code session
- Commit .claude/settings.local.json
- Recreate /bids/[id]/leveling as a standalone page — it's a redirect (see Operations)
