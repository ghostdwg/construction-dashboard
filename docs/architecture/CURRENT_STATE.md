# Current State — Preconstruction Intelligence System
# Last Updated: 2026-04-11 — Module H2 (Buyout Tracker) complete

## Repository
- GitHub: ghostdwg/bid-dashboard — main branch
- Local: c:/Users/jjcou/bid-dashboard
- Stack: Next.js 14, TypeScript, Tailwind v4, Prisma, SQLite

## Architecture — Three Wings + Lifecycle

The system is structured as three pursuit wings plus a post-award handoff layer:

- **Wing 1 — Job Intake (Module INT1, queued):** project context capture before AI runs
- **Wing 2 — Scope Intelligence (Modules 14, 15, 15a, 15b):** what specs require vs what subs cover
- **Wing 3 — Bid Leveling (Modules 6a-6c, Tier C, Tier D):** apples-to-apples comparison + post-bid analytics
- **Tier E — Post-Award Handoff (queued):** carry data forward into project execution
- **Tier F — Procore Bridge (queued):** CSV export then API integration

## Build Status

| Module | Description | Status |
|--------|-------------|--------|
| Tiers 1–3 | Foundation, Intelligence, Workflow | ✅ Complete |
| Module 2b | Subcontractor Intelligence Layer | ✅ Complete |
| Module 6a | Estimate Intake | ✅ Complete |
| Module 6b | Scope Leveling Engine | ✅ Complete |
| Module 6c | Leveling Questions + Export | ✅ Complete |
| Audit Session | Full workflow debug + error handling | ✅ Complete |
| Module 14 | Document Intelligence (14a + 14b combined) | ✅ Complete |
| Module 5b | Estimate Sanitization — redaction engine | ✅ Complete |
| Module 15 | AI Review + Gap Analysis (15a + 15b) | ✅ Complete |
| Module GNG1 | Go/No-Go Gate Widget | ✅ Complete |
| Module 16a | Addendum Delta Processing | ✅ Complete |
| **Tier A** | **All modules complete** | **✅ Complete** |
| Module P1 | Procurement Timeline Engine | ✅ Complete |
| Module P2 | Trade Tier Classification UI | ✅ Complete |
| Module P3 | RFI Register Upgrade | ✅ Complete |
| Module P4 | Public Bid Compliance Checklist | ✅ Complete |
| **Tier C** | **Estimate Intelligence Layer** | **✅ Complete** |
| Module C1 | Bid Spread Analysis | ✅ Complete |
| Module C2 | Scope-Cost Correlation | ✅ Complete |
| Module C3 | Estimate Intelligence Summary | ✅ Complete |
| **Tier D** | **Bid Assembly + Post-Bid Intelligence** | **✅ Complete** |
| Module D1 | Bid Submission Snapshot | ✅ Complete |
| Module D2 | Award Outcome Tracking | ✅ Complete |
| Module D3 | Post-Bid Analytics Dashboard | ✅ Complete |
| **Operations** | **Cross-cutting infrastructure** | **✅ Complete** |
| Procore CSV Import | Subcontractor import + isPreferred + dedup | ✅ Complete |
| AI Token Config | Per-call max_tokens UI with cost estimates | ✅ Complete |
| Editable Due Date | Click-to-edit on Overview, field on New Bid modal | ✅ Complete |
| Theme Toggle | Light/dark mode with full app dark coverage | ✅ Complete |
| Module RFQ1 | RFQ Email Distribution via Resend | ✅ Complete |
| Module INT1 | Job Intake — Wing 1 project context capture | ✅ Complete |
| **Tier E** | **Post-Award Handoff Layer** | **🏗️ In progress** |
| Module H1 | Handoff Packet — Tier E entry point | ✅ Complete |
| Module H2 | Buyout Tracker (sub contracts, POs, committed cost) | ✅ Complete |
| **Queued** | **Lifecycle expansion** | **🔜 Planned** |
| Modules H3–H8 | Submittal register, schedule seed, owner estimate, budget, contacts, notifications | 🔜 Queued |
| Tier F (F1-F3) | Procore Integration Bridge | 🔜 Queued |
| UI Nav Refactor | Sidebar with phase groupings + post-award shift | 🔜 Queued |

## What Is Built
- Subcontractor directory with trade filtering, tier system, single-sub form with isPreferred
- Procore CSV import — preview/conflict resolution/per-row Preferred/commit pipeline
- Bid management with tabbed detail view + editable due date
- Trade assignment from 46-trade dictionary with CSI codes
- Sub selection filtered by bid trades
- Excel export for Outlook distribution
- Scope normalization with trade assignment
- Safe AI export with redaction and approval flow
- AI gap findings import, review, and approval
- Question generation and status workflow (RFI register: numbering, priority, response, impact)
- Outreach and response logging
- Reporting dashboard with live KPIs + post-bid analytics dashboard
- Estimate intake with pricing boundary enforced
- Scope leveling — side by side, inline status and notes
- Leveling questions with AI draft + anonymized Excel export
- Spec book upload — CSI extraction via pdfjs-dist (working)
- Drawing sheet index upload — discipline parsing, trade mapping
- Three-state matching — covered / missing from bid / unknown
- Trade proposal UI — Add to Bid, manual assign, rematch trigger
- Documents tab at position 2 in tab order
- Bid submission snapshot + outcome tracking + cascading status updates
- Bid spread analysis, scope-cost correlation, estimate intelligence recommendations
- Public bid compliance checklist (PUBLIC bids only)
- Procurement timeline engine + trade tier classification + tier health panel
- Addendum delta processing — incremental, per-addendum JSON
- AI Token Config UI at /settings/ai-tokens — per-call max_tokens presets with live cost
- Light/dark theme toggle in top nav — persists to localStorage, full dark variant coverage across all pages
- RFQ Email Distribution (Module RFQ1) — Subs tab checkboxes + Send RFQ button → confirmation modal → Resend API → React Email template → OutreachLog tracking with delivery status badges
- Job Intake (Module INT1) — JobIntakePanel on Overview tab with 14 fields across 5 sections (delivery & ownership, project profile, public bid terms, site & constraints, estimator notes). Empty bids show prominent "Complete Project Intake" CTA. Intake fields feed into the brief prompt as a new "PROJECT INTAKE" section, and into a new GNG1 Project Readiness check.
- Handoff Packet (Module H1, Tier E entry point) — new Handoff tab on bid detail page (#10). Compiles project summary, trade awards, open items (RFIs + assumptions + risk flags), document inventory from existing captured data. XLSX export with 6 sheets (Project Summary, Trade Awards, Buyout Summary, Open Items, Contacts, Documents). "View Handoff Packet →" shortcut on SubmissionPanel when outcome=won. Works in preview mode for any bid status. Owner/architect contacts deferred pending ProjectContact model.
- Buyout Tracker (Module H2) — per-trade contract tracking rendered as a section on the Handoff tab directly below Trade Awards. Auto-creates one BuyoutItem per BidTrade on first load (via GET /api/bids/[id]/buyout). Each row is inline-editable: committed amount, PO#, contract status dropdown (7-stage lifecycle: PENDING → LOI_SENT → CONTRACT_SENT → CONTRACT_SIGNED → PO_ISSUED → ACTIVE → CLOSED), paid-to-date. Expandable detail row shows change orders, total w/COs, remaining, retainage held (percent stored, dollars computed on read), notes. Rollup card at the top surfaces total committed / paid / remaining / retainage held across all trades. BuyoutItem.subcontractorId seeded from BidInviteSelection where rfqStatus="accepted" on row creation — nullable so you can track trades before award. PATCH route validates numeric non-negativity and contractStatus membership. Trade Awards table and XLSX export now source committedAmount + contractStatus from BuyoutItem instead of hardcoded "PENDING" + null. New "Buyout Summary" XLSX sheet lists all rows with full financial breakdown + totals. Project Summary XLSX sheet gains a "Buyout Rollup" section.

## Current Known State
- pdfjs-dist installed and working — pdf-parse removed
- SpecBook, SpecSection, DrawingUpload, DrawingSheet models in schema
- Three-state matching live: tradeId (covered) / matchedTradeId (missing) / both null (unknown)
- ProjectType enum on Bid (PUBLIC / PRIVATE / NEGOTIATED)
- AiGapFinding with title, sourceRef, severity, sourceDocument, reviewNotes
- BidIntelligenceBrief with riskFlags, assumptionsToResolve, isStale, sourceContext, addendumDeltas
- AddendumUpload with deltaJson, deltaGeneratedAt, summary — delta stored per-addendum, brief untouched
- GAP_STUB_MODE, BRIEF_STUB_MODE, ADDENDUM_STUB_MODE env flags bypass Anthropic API for dev
- Go/No-Go widget on Overview tab — four gates scored from existing bid data, no AI call
- Addendum delta processing — incremental delta prompt, scope changes, new risks, actions required checklist
- Stale banner on Overview links to Documents tab (not regenerate) — delta processing clears stale flag
- BidTrade: tier (TIER1/TIER2/TIER3 string, default TIER2), leadTimeDays, rfqSentAt, quotesReceivedAt, rfqNotes
- calculateTimeline.ts — pure date logic, realistic 2-week offsets (T1=14d, T2=10d, T3=7d), leadTimeDays override
- GET /api/bids/[id]/procurement/timeline — per-trade timeline, urgency sort, summary block, daysUntilBid
- PATCH /api/bids/[id]/trades/[tradeId] — updates tier, leadTimeDays, rfqSentAt, rfqNotes
- Trades tab: tier selector, lead days input, status badge (On Track/At Risk/Overdue/Complete), RFQ date per row
- Subs tab: procurement timeline section — urgency banner, trade timeline table, Mark RFQ Sent, DBE compliance (PUBLIC)
- classifyTradeTier.ts — keyword-based rule classifier, TIER1/TIER2/TIER3 suggestion, reason, typicalLeadDays, criticalPathRisk
- Trades tab: auto-suggest hints when classifier disagrees with current tier, dismiss/apply buttons, lead time guidance below input
- Trades tab: tier health summary panel — three-column grid, color-coded by worst timeline status per tier
- Trades tab: untiered banner + bulk apply modal when suggestions exist, Critical Path badge on Tier 1 rows
- GNG1 Gate 2: Tier 1 critical path procurement check — OVERDUE → FAIL, AT_RISK → CAUTION
- Subcontractor.isPreferred — INTERNAL ONLY field (never in AI prompts, never in sub-facing exports)
- Subcontractor.procoreVendorId — unique external reference for re-import dedup
- BidSubmission model — frozen 6-field JSON snapshots + outcome fields, cascades Bid.status
- AiTokenConfig model — DB-backed per-call max_tokens overrides with in-process cache
- Legacy /bids/[id]/leveling route is a redirect to /bids/[id]?tab=leveling (do NOT recreate as a standalone page — landmine that confuses users into thinking tabs are missing)
- ThemeProvider uses React 19 useSyncExternalStore pattern (no setState-in-effect rule violations). Pre-hydration script in layout.tsx applies theme class on first paint to prevent flash.
- Tailwind v4 dark mode via @custom-variant in app/globals.css — explicit class on <html> is the only signal (no prefers-color-scheme media query)
- OutreachLog model extended with email tracking fields (Module RFQ1): emailMessageId (indexed), deliveryStatus (QUEUED/SENT/DELIVERED/OPENED/BOUNCED/FAILED), openedAt, bouncedAt, bounceReason. Existing channel/status columns reused — channel="email", status="sent" on successful queue. Custom message renders into email body but is NOT persisted (option b — discard after send).
- Resend integration is OPTIONAL — without RESEND_API_KEY + RESEND_FROM_EMAIL in .env.local, the send route returns 503 and the Subs tab "Send RFQ" button is disabled with a tooltip. Estimator name + email defaults from ESTIMATOR_NAME + ESTIMATOR_EMAIL env vars, fall back to localStorage, then to user input. Webhooks configured at /api/webhooks/resend — won't fire on localhost (need public URL).
- LIVE EMAIL SEND IS UNTESTED at commit time. Code paths verified by lint/build/typecheck. First test should be a self-send to verify Resend account, domain verification, and webhook delivery.
- INT1 schema additions on Bid (migration 20260410225347_int1_job_intake): deliveryMethod, ownerType, buildingType, approxSqft, stories, ldAmountPerDay, ldCapAmount, occupiedSpace, phasingRequired, siteConstraints, estimatorNotes, scopeBoundaryNotes, veInterest, dbeGoalPercent. String fields validated in API layer (POST /api/bids and PATCH /api/bids/[id]) rather than as Prisma enums (SQLite-friendly). Valid deliveryMethod: HARD_BID, DESIGN_BUILD, CM_AT_RISK, NEGOTIATED. Valid ownerType: PUBLIC_ENTITY, PRIVATE_OWNER, DEVELOPER, INSTITUTIONAL.
- INT1 brief prompt integration — assembleBriefPrompt.ts adds Section A2 "PROJECT INTAKE" between project identity and Division 1 sections. Only emits fields the estimator has populated (no padding "—" rows). Prompts the AI to factor intake constraints into risk flags and assumptions.
- INT1 GNG1 integration — go-no-go route adds a "Project intake captured" check to Project Readiness gate. Counts populated fields (booleans count when true). 0 fields → fail, <50% → caution, ≥50% → pass. Total field count varies by projectType (PUBLIC bids count 14, others count 11 — LD/DBE fields not counted on private/negotiated).
- H1 handoff packet assembles from existing pursuit data — never fabricates. Sources: Bid + intake fields (project/constraints), BidTrade (per-trade rows), BidInviteSelection with rfqStatus="accepted" (awarded subs), BidIntelligenceBrief.riskFlags + assumptionsToResolve (parsed JSON), GeneratedQuestion where status in ["OPEN","SENT"] (unresolved RFIs), SpecBook + DrawingUpload + AddendumUpload (documents inventory), BidSubmission.ourBidAmount (total bid — single field, not per-trade). As of H2, per-trade bidAmount and contractStatus come from BuyoutItem instead of being null/hardcoded. Boundary preserved: EstimateUpload.pricingData never touched, sub names ARE included (internal artifact only, never sent to AI).
- H1 deferred items still outstanding: owner/architect/internal-team contacts (source → future ProjectContact model).
- H2 BuyoutItem schema (migration 20260411014717_h2_buyout_tracker): one row per BidTrade (unique bidTradeId), nullable subcontractorId (cascading from accepted RFQ selection on creation, manually adjustable thereafter), committedAmount, originalBidAmount, contractStatus (string, validated in API), loiSentAt/contractSentAt/contractSignedAt/poIssuedAt, poNumber, changeOrderAmount (default 0), paidToDate (default 0), retainagePercent (default 5), notes. Indices on bidId and subcontractorId. Cascade delete when Bid or BidTrade is removed. Valid contractStatus: PENDING, LOI_SENT, CONTRACT_SENT, CONTRACT_SIGNED, PO_ISSUED, ACTIVE, CLOSED.
- H2 service layer: loadBuyoutItemsForBid auto-creates missing rows by diffing BidTrade vs BuyoutItem; computeBuyoutRollup returns trade counts + total committed/paid/remaining/retainage + status histogram; updateBuyoutItem enforces ownership (item.bidId === bidId), numeric non-negativity, contractStatus enum, and retainagePercent 0-100. Derived fields on each row (totalCommitted = committed + COs, remainingToPay = max(0, total - paid), retainageHeld = paid * pct/100) computed at read time, never stored.

## Pricing / AI Boundary — Non-Negotiable
EstimateUpload.pricingData is never returned to client and
never included in any AI prompt. Only scopeLines go to AI.
