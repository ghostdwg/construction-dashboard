# Current State — Last Updated After Step 6

## Branch
- main (pushed to GitHub — `1679b4a`)

## Steps Complete
| Step | Description |
|------|-------------|
| 1 | Subcontractor Directory UI |
| 2 | Bid List + New Bid form |
| 3 | Bid detail page with tabs (Overview, Trades, Subs) |
| 4 | Leveling view |
| 5 | Scope Normalization — ScopeItem schema, grouped API, ScopeTab UI |
| 6 | Safe AI Export — redaction service, approval flow, AI Review tab |

---

## Files Confirmed Built

### Core
| File | What It Does |
|------|-------------|
| app/page.tsx | Redirects to /bids |
| app/bids/page.tsx | Bid list — projectName, location, status |
| app/bids/NewBidButton.tsx | Inline new bid form |
| app/bids/[id]/page.tsx | Bid detail — tab router |
| app/bids/[id]/TabBar.tsx | Overview, Trades, Scope, Subs, AI Review, Documents |
| app/bids/[id]/StatusButton.tsx | Status cycle button |
| app/bids/[id]/TradesTab.tsx | Manage trades on a bid |
| app/bids/[id]/SubsTab.tsx | Leveling view — trades, subs, contacts |
| app/bids/[id]/ScopeTab.tsx | Per-trade scope sections, add/remove items, summary bar |
| app/bids/[id]/AiReviewTab.tsx | Three-checkbox confirmation, JSON display, copy + download |
| app/bids/[id]/leveling/page.tsx | Standalone leveling view |
| lib/prisma.ts | Prisma client singleton |
| lib/exports/aiSafeExport.ts | buildAiSafePayload — strips restricted items, second-pass safety check |
| prisma/schema.prisma | v0.3 — see schema below |
| prisma/seed.ts | 46 trades, 5 subs, 2 bids, 6 scope items on bid 1 |
| prisma.config.ts | Prisma config (handles DATABASE_URL) |

### API Routes
| Route | Methods | Notes |
|-------|---------|-------|
| /api/bids | GET, POST | List + create bids |
| /api/bids/[id] | GET, PATCH | Bid detail + status update |
| /api/bids/[id]/trades | POST, DELETE | Add/remove trades from bid |
| /api/bids/[id]/scope | GET, POST | Grouped scope items; restricted not settable via POST |
| /api/bids/[id]/scope/[itemId] | PATCH, DELETE | Update/delete scope item; restricted not patchable |
| /api/bids/[id]/export/ai-safe | POST | Requires `{ approved: true }`; creates AiExportBatch; returns downloadable JSON |
| /api/bids/[id]/leveling | GET | Leveling data |
| /api/bids/[id]/selections | POST, DELETE | Manage sub selections |
| /api/bids/[id]/suggestions | GET | Sub suggestions by trade |

---

## Schema v0.3 — Confirmed Live
```
Trade                 — 46 seeded records (CSI-aligned)
Bid                   — 2 seeded records
BidTrade              — join: Bid ↔ Trade
Subcontractor         — standalone directory, 5 seeded records
SubcontractorTrade    — join: Subcontractor ↔ Trade
Contact               — belongs to Subcontractor
BidInviteSelection    — join: Bid ↔ Subcontractor (with optional tradeId)
ScopeItem             — bidId, tradeId?, description, inclusion, specSection,
                        drawingRef, notes, riskFlag, restricted
ScopeTradeAssignment  — scopeItemId ↔ tradeId (isPrimary, notes)
ExportBatch           — legacy export audit record
AiExportBatch         — per-run audit: bidId, restrictedCount, status
AiGapFinding          — AI-returned findings (stub, Step 7)
GeneratedQuestion     — questions from findings (stub, Step 7)
```

### Seed Data
| Table | Count | Notes |
|-------|-------|-------|
| Trade | 46 | Full CSI-aligned cost code structure |
| Subcontractor | 5 | Apex, Summit, Ironclad, Peak, Cornerstone |
| Contact | 6 | 1–2 per sub, isPrimary set |
| Bid | 2 | Riverside Office Park, Ankeny Logistics Center |
| BidTrade | 6 | 3 trades per bid |
| BidInviteSelection | 6 | 3 subs per bid |
| ScopeItem | 6 | Bid 1 only — mix of included/excluded, 1 riskFlag, 1 restricted |

---

## Key Constraints / Safety Rules
- `restricted: true` scope items are never settable via POST or PATCH routes
- `buildAiSafePayload` strips restricted items and runs a second-pass check that throws `"SAFETY VIOLATION: ..."` if any slip through
- Export payload never includes: budget, estimate, cost, price, amount, target, buyout, contingency, margin, fee, subcontractor names/contacts, internal user fields
- AI Review tab requires all three confirmation checkboxes before export button enables

---

## Next Action
**Step 7 — AI Gap Findings Import and Question Generation**
- Import findings JSON into AiGapFinding records
- Generate questions from findings into GeneratedQuestion
- Surface in the "Paste AI findings here" stub in AiReviewTab
