# Current State — Last Updated After Schema v0.2 Reset

## Branch
- main (pushed to GitHub)

## What Is In The Repo Right Now

### Files Confirmed Built
| File | What It Does |
|------|-------------|
| app/page.tsx | Redirects to /bids |
| app/bids/page.tsx | Bid list — shows projectName, location, status |
| app/bids/NewBidButton.tsx | Inline new bid form |
| app/bids/[id]/leveling/page.tsx | Leveling view — trades, subs, contacts per trade |
| app/api/bids/route.ts | GET (list) + POST (create) — handles dueDate |
| app/api/bids/[id]/leveling/route.ts | Returns bidTrades→trade + selections→sub→contacts |
| prisma/schema.prisma | v0.2 — see schema below |
| prisma/seed.ts | 7 trades, 5 subs, 2 bids with selections |
| lib/prisma.ts | Prisma client singleton |
| prisma.config.ts | Prisma config (handles DATABASE_URL) |

### Schema v0.2 — Confirmed Live
```
Trade                 — shared dictionary, 7 seeded records
Bid                   — 2 seeded records
BidTrade              — join: Bid ↔ Trade
Subcontractor         — standalone directory, 5 seeded records
SubcontractorTrade    — join: Subcontractor ↔ Trade
Contact               — belongs to Subcontractor, not Trade
BidInviteSelection    — join: Bid ↔ Subcontractor (with optional tradeId)
```

### Seed Data
| Table | Count | Records |
|-------|-------|---------|
| Trade | 7 | Electrical, Mechanical, Plumbing, Framing, Roofing, Drywall, Concrete |
| Subcontractor | 5 | Apex Electrical, Summit Mechanical, Ironclad Framing, Peak Roofing, Cornerstone Concrete |
| Contact | 6 | 1-2 per subcontractor, isPrimary set |
| Bid | 2 | Riverside Office Park, Ankeny Logistics Center |
| BidTrade | 6 | 3 trades per bid |
| BidInviteSelection | 6 | 3 subs per bid |

---

## What Does NOT Exist Yet

### API Routes Not Built
- GET /api/subcontractors
- POST /api/subcontractors
- GET /api/subcontractors/[id]
- POST /api/subcontractors/[id]/contacts
- GET /api/trades
- POST /api/bids/[id]/trades
- DELETE /api/bids/[id]/trades/[tradeId]
- POST /api/bids/[id]/selections
- DELETE /api/bids/[id]/selections/[id]
- GET /api/bids/[id]/suggestions
- POST /api/bids/[id]/export/recipients
- POST /api/bids/[id]/export/ai-safe

### Pages Not Built
- /subcontractors (list)
- /subcontractors/[id] (detail)
- /bids/[id] (detail with tabs)
- /trades (admin dictionary)
- /exports (history)
- /ai-review
- /questions
- /reports
- /admin

### Schema Models Not Yet Added
- ScopeItem
- ScopeTradeAssignment
- ExportBatch
- AiExportBatch
- AiGapFinding
- GeneratedQuestion
- OutreachLog
- AuditLog

---

## Next Action

Build Step 1 from ROADMAP.md:
Subcontractor Directory UI

Start Claude Code session with brief_01_setup_and_directory.md
Skip to Step 3 (API Routes) — project setup already done
