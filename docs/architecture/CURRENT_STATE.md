# Current State — Preconstruction Intelligence System
# Last Updated: End of Session — Tiers 1-3 + Module 2b Complete, Module 6 Queued

---

## Repository
- GitHub: main branch
- Local: c:/Users/jjcou/bid-dashboard
- Stack: Next.js 14, TypeScript, Tailwind, Prisma, SQLite

---

## Build Status

| Step | Module | Status |
|------|--------|--------|
| Step 0 | Schema v0.2 clean reset | ✅ Complete |
| Step 1 | Subcontractor Directory UI | ✅ Complete |
| Step 2 | Bid Detail Page — tabs | ✅ Complete |
| Step 3 | Sub Selection per bid | ✅ Complete |
| Step 4 | Excel Export for Outlook | ✅ Complete |
| — | Trade Dictionary — 46 real trades | ✅ Seeded |
| Step 5 | Scope Normalization | ✅ Complete |
| Step 5b | Estimate Sanitization | ⬜ Queued — Tier 4 |
| Step 6 | Safe AI Export | ✅ Complete |
| Step 7 | AI Gap Findings + Question Generation | ✅ Complete |
| Step 8 | Outreach + Response Logging | ✅ Complete |
| Step 9 | Reporting Dashboard | ✅ Complete |
| Module 2b | Subcontractor Intelligence Layer | ✅ Complete |
| **Module 6** | **Bid Leveling Engine** | **⬜ NEXT** |
| Step 14a | Spec Book — CSI Coverage Gap | ⬜ Queued — Tier 4 |
| Step 14b | Drawing Sheet Index Parsing | ⬜ Queued — Tier 4 |
| Step 14c | Drawing Content Review | 🔴 Deferred — 2026 |

---

## Tiers Complete

| Tier | Description | Status |
|------|-------------|--------|
| Tier 1 — Foundation | Directory, bids, selection, export | ✅ Complete |
| Tier 2 — Intelligence | Scope, AI export, gap review, questions | ✅ Complete |
| Tier 3 — Workflow | Outreach logging, reporting dashboard | ✅ Complete |
| Module 2b — Sub Intelligence | Preferred lists, RFQ tracker, CRM layer | ✅ Complete |
| Module 6 — Leveling Engine | Estimate intake, scope matrix, leveling questions | ⬜ Next |
| Tier 4 — Document Intelligence | Spec book, drawings, estimate sanitization | ⬜ Queued |

---

## What Is Built and Working

### Pages
| Route | What It Does |
|-------|-------------|
| /bids | Bid list with filters |
| /bids/[id] | Bid detail — 8 tabs |
| /bids/[id]?tab=overview | Project name, location, status, due date |
| /bids/[id]?tab=trades | Assign/remove trades from shared dictionary |
| /bids/[id]?tab=scope | Scope items grouped by trade, add form |
| /bids/[id]?tab=subs | Suggested + selected subs per bid |
| /bids/[id]?tab=ai-review | Safe export, findings import, kanban review |
| /bids/[id]?tab=questions | Question cards, inline edit, status flow |
| /bids/[id]?tab=activity | Timeline audit log |
| /bids/[id]?tab=documents | Document stub |
| /subcontractors | Sub directory with trade/status filters |
| /subcontractors/[id] | Sub detail — company info, trades, contacts |
| /outreach | Outreach log — filters, summary cards, expandable rows |
| /reports | Dashboard — KPIs, charts, trade coverage, aging |

### API Routes Built
```
GET/POST   /api/bids
GET/PATCH  /api/bids/[id]
POST       /api/bids/[id]/trades
DELETE     /api/bids/[id]/trades/[tradeId]
GET/POST   /api/bids/[id]/scope
PATCH/DEL  /api/bids/[id]/scope/[scopeId]
GET/POST   /api/bids/[id]/selections
DELETE     /api/bids/[id]/selections/[id]
GET        /api/bids/[id]/suggestions
POST       /api/bids/[id]/export/recipients
POST       /api/bids/[id]/export/ai-safe
GET        /api/bids/[id]/outreach
POST       /api/bids/[id]/sync-preferred-subs
GET/POST   /api/subcontractors
GET/PATCH  /api/subcontractors/[id]
POST       /api/subcontractors/[id]/contacts
GET        /api/trades
GET/PATCH  /api/outreach
PATCH      /api/outreach/[id]
POST       /api/findings/[id]/generate-question
PATCH      /api/questions/[id]
GET        /api/reports/summary
GET        /api/reports/bids-by-status
GET        /api/reports/trade-coverage
GET        /api/reports/response-rates
GET        /api/reports/follow-up-aging
GET/POST   /api/preferred-subs
DELETE     /api/preferred-subs/[id]
PATCH      /api/bid-invite-selections/[id]
```

### Schema — Models In DB
```
Trade                 — 46 real trades with costCode and csiCode
Bid                   — core bid record
BidTrade              — join: Bid ↔ Trade
Subcontractor         — standalone directory
SubcontractorTrade    — join: Subcontractor ↔ Trade
Contact               — belongs to Subcontractor
BidInviteSelection    — sub selected for bid
ExportBatch           — Excel export record
ScopeItem             — normalized scope per bid
ScopeTradeAssignment  — scope item ↔ trade (many-to-many)
AiExportBatch         — safe AI export record
AiGapFinding          — findings from AI review
GeneratedQuestion     — questions from approved findings
OutreachLog           — outreach and response tracking
```

### Key Files
```
lib/exports/aiSafeExport.ts     — redaction service, second-pass validation
lib/exports/recipientExport.ts  — ExcelJS Outlook export
lib/logging/outreachLogger.ts   — logOutreachEvent utility
prisma/schema.prisma            — source of truth for all models
prisma/seed.ts                  — 46 trades, 5 subs, 2 bids
```

---

## Module 2b — Subcontractor Intelligence Layer
### Status: COMPLETE

### What Was Built
- **Schema:** `Subcontractor.tier`, `Subcontractor.projectTypes`, `Subcontractor.region`,
  `Subcontractor.internalNotes`, `Subcontractor.doNotUse`, `Subcontractor.doNotUseReason`,
  `BidInviteSelection.rfqStatus` and related fields, `PreferredSub` join table
- **Sub directory:** tier badges, tier filter dropdown on list page
- **Sub detail:** `SubIntelligencePanel` — edit tier, project types, region, internal notes,
  do-not-use flag; `TradesSection` — preferred star toggle per trade with optimistic UI
- **Subs tab:** RFQ tracker grouped by trade, color-coded status pills (gray/blue/amber/
  purple/green/red), inline status updates (optimistic), trade summary counts header
- **Auto-populate:** `lib/services/autoPopulateBidSubs.ts` service; wired into
  `POST /api/bids` and `POST /api/bids/[id]/trades`; idempotent (skips existing combos)
- **Sync button:** `POST /api/bids/[id]/sync-preferred-subs` on-demand endpoint;
  UI "Sync preferred subs" button updates client state inline from response
- **API routes:** `PATCH /api/subcontractors/[id]`, `GET+POST /api/preferred-subs`,
  `DELETE /api/preferred-subs/[id]`, `PATCH /api/bid-invite-selections/[id]`,
  `POST /api/bids/[id]/sync-preferred-subs`

---

## Docs in Repo
```
docs/architecture/
  CURRENT_STATE.md              ← this file
  ROADMAP.md                    ← full build sequence
  00_system_overview.md         ← system architecture
  5b_estimate_sanitization_module.md
  14a_spec_book_module.md
  14b_drawing_intelligence_module.md
docs/schemas/
  master_schema.md
  trade_seed.ts
  cost_codes_full.ts
docs/workflows/
  ai_review_prompts.md
docs/claude-code-briefs/
  SESSION_RULES.md
  SKILLS_REFERENCE.md
  brief_01 through brief_05
```

---

## Module 6 — Bid Leveling Engine
### Status: NEXT TO BUILD

### 6a — Estimate Intake
Upload sub estimates (PDF/Excel/DOCX), parse all formats, separate scope from
pricing, store both. Pricing data is never sent to AI.

### 6b — Scope Leveling Engine
Normalize scope across subs. Build a scope matrix comparing what each sub
included and excluded. Flag gaps and divergences against peer bids and the
project baseline (spec book or drawing index when available from Tier 4).

### 6c — Leveling Questions + Export
Generate per-sub clarification questions from leveling gaps. Export to email.
Optional push to the Questions tab for full tracking.

---

## Next Action
Build Module 6 — Bid Leveling Engine
Start with 6a (Estimate Intake) — establish upload pipeline and parsing
before building the leveling matrix in 6b.
