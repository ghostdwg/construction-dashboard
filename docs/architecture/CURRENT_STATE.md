# Current State — Preconstruction Intelligence System
# Last Updated: 2026-04-10 — Module RFQ1 (Resend email distribution) complete

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
| **Queued** | **Lifecycle expansion** | **🔜 Planned** |
| Module INT1 | Job Intake — Wing 1 project context capture | 🔜 Queued |
| Tier E (H1-H8) | Post-Award Handoff Layer | 🔜 Queued |
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

## Pricing / AI Boundary — Non-Negotiable
EstimateUpload.pricingData is never returned to client and
never included in any AI prompt. Only scopeLines go to AI.
