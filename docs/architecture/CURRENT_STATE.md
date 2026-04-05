# Current State — Preconstruction Intelligence System
# Last Updated: End of Session — Tiers 1-3 Complete, Module 2b Queued

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
| **Module 2b** | **Subcontractor Intelligence Layer** | **⬜ NEXT** |
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
| Module 2b — Sub Intelligence | Preferred lists, RFQ tracker, CRM layer | ⬜ Next |
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
### Status: NEXT TO BUILD

### What It Adds
Turns the sub directory from a simple list into a relationship
management and RFQ tracking tool.

### Schema Changes Needed
```prisma
// Add to Subcontractor model:
tier            String?    // "preferred" | "approved" | "new" | "inactive"
projectTypes    String?    // comma-separated: "office,industrial,multifamily"
region          String?
lastBidDate     DateTime?
internalNotes   String?
doNotUse        Boolean    @default(false)
doNotUseReason  String?

// New model:
model PreferredSub {
  id              Int    @id @default(autoincrement())
  tradeId         Int
  subcontractorId Int
  projectType     String?
  addedBy         String?
  notes           String?
  createdAt       DateTime @default(now())

  trade         Trade         @relation(fields: [tradeId], references: [id])
  subcontractor Subcontractor @relation(fields: [subcontractorId], references: [id])

  @@unique([tradeId, subcontractorId, projectType])
}

// Add to BidInviteSelection:
rfqStatus           String    @default("invited")
invitedAt           DateTime?
estimateReceivedAt  DateTime?
estimateFileName    String?
followUpCount       Int       @default(0)
selectionNotes      String?
```

### RFQ Status Values
```
invited → received → reviewing → accepted → declined → no_response
```

### What Gets Built
1. Sub directory enrichment — tier, region, project types, internal notes
2. Preferred sub management — mark subs as preferred per trade
3. Auto-populate bid list from preferred subs on bid creation
4. RFQ status tracker on Subs tab — live status per sub per bid
5. Bid list view — grouped by trade, status dropdown per row

### Migration Name
add_sub_intelligence_layer

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

## Next Action
Build Module 2b — Subcontractor Intelligence Layer
Start new Claude chat with the RECALL BLOCK below
Start new Claude Code session with the SESSION STARTER below
