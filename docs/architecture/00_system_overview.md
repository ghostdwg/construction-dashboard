# System Overview — Preconstruction Intelligence System

## What This Is

A modular internal web application for commercial construction bid management.
Built solo, Claude Code assisted, GitHub tracked.

Not a general project management tool.
Not a replacement for Procore.
A purpose-built preconstruction intelligence layer that sits between your
estimating process and your subcontractor outreach.

---

## The Problem It Solves

| Today (Manual) | With This System |
|----------------|-----------------|
| Sub lists in spreadsheets | Filterable directory with trade mapping |
| Trades assigned by memory | Structured trade dictionary per bid |
| AI tools used on raw data | Cost-safe normalized export only |
| Scope gaps found after award | AI gap review before invite |
| Follow-up questions in email drafts | Generated, logged, tracked per trade |
| No record of who was invited | Full outreach and response audit trail |

---

## The Full Architecture — 9 Modules

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1 — FOUNDATION                                    │
│                                                         │
│  [1] Subcontractor Directory                            │
│      Standalone company + contact + trade map           │
│                                                         │
│  [2] Bid Management                                     │
│      Create bids, assign trades, track status           │
│                                                         │
│  [3] Sub Selection + Excel Export                       │
│      Pick subs per bid, export Outlook-ready Excel      │
│                                                         │
└─────────────────────────────────────────────────────────┘
         ↓ Tier 1 must be validated in real use ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 2 — INTELLIGENCE                                  │
│                                                         │
│  [4] Scope Normalization                                │
│      Structured scope items mapped to trades            │
│                                                         │
│  [5] Safe AI Export                                     │
│      Strip cost data, build JSON for AI review          │
│                                                         │
│  [6] AI Gap Review — Manual Pipeline                    │
│      Copy JSON to Claude, paste findings back           │
│                                                         │
└─────────────────────────────────────────────────────────┘
         ↓ Tier 2 must produce validated findings ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 3 — WORKFLOW                                      │
│                                                         │
│  [7] Question Generation                                │
│      Convert AI findings to sub-facing questions        │
│                                                         │
│  [8] Outreach + Response Logging                        │
│      Track who was sent what and what came back         │
│                                                         │
│  [9] Reporting Dashboard                                │
│      Coverage, response rates, gap counts               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Current State vs Target State

### What Is Built
- Next.js App Router + TypeScript + Tailwind ✅
- Prisma + SQLite ✅
- Schema v0.2 — Trade, Bid, BidTrade, Subcontractor, SubcontractorTrade, Contact, BidInviteSelection ✅
- Seed data — 7 trades, 5 subcontractors, 2 bids ✅
- GET + POST /api/bids ✅
- /bids list page with location and status ✅
- /bids/[id]/leveling page rebuilt for new schema ✅
- Committed and pushed to GitHub on main ✅

### What Is Being Built Next
- GET /api/subcontractors with trade + status + search filters
- /subcontractors list page
- /subcontractors/[id] detail page
- Add subcontractor form
- Add contact form

### What Comes After That
- Bid detail page — tabs for Overview, Trades, Subs, Documents
- Trade assignment UI on bid detail
- Sub selection per bid (filtered by bid trades)
- Excel export for Outlook

---

## Navigation Structure

```
/                          → redirects to /bids
/bids                      → Bid list ✅ built
/bids/[id]                 → Bid detail (tabs) — in progress
/bids/[id]/leveling        → Leveling view ✅ built
/subcontractors            → Sub directory — next to build
/subcontractors/[id]       → Sub detail
/trades                    → Trade dictionary (admin)
/exports                   → Export history
/ai-review                 → AI scope gap review
/questions                 → Generated questions queue
/reports                   → Dashboard
/admin                     → Config and settings
```

---

## Data Flow — How Everything Connects

```
Trade Dictionary
    │
    ├──→ BidTrade (assigned to Bid)
    │
    └──→ SubcontractorTrade (assigned to Subcontractor)
              │
              └──→ BidInviteSelection (sub selected for Bid)
                        │
                        └──→ ExportBatch (Excel export)
                                  │
                                  └──→ OutreachLog (sent/responded)

Bid
    │
    ├──→ ScopeItem (normalized scope)
    │         │
    │         └──→ AiExportBatch (safe JSON for AI)
    │                   │
    │                   └──→ AiGapFinding (AI returns findings)
    │                               │
    │                               └──→ GeneratedQuestion (follow-up)
    │
    └──→ AuditLog (everything logged)
```

---

## Security Rules — Non-Negotiable

1. `bidAmount` does not exist on any sub or contact record
2. Cost fields are never passed to AI — Safe AI Export is the only path
3. Every AI export requires user approval before generation
4. Every export is logged with batch ID, user, and timestamp
5. Restricted scope items are tagged at the database level, not filtered in UI

---

## Tech Stack — Confirmed

| Layer | Choice | Status |
|-------|--------|--------|
| Frontend | Next.js 14 App Router + TypeScript | ✅ Running |
| Styling | Tailwind CSS | ✅ Running |
| Components | shadcn/ui | Confirm installed |
| Tables | TanStack Table | Confirm installed |
| Forms | React Hook Form + Zod | Confirm installed |
| Backend | Next.js API Routes | ✅ Running |
| ORM | Prisma | ✅ Running |
| Database | SQLite (dev) → PostgreSQL (Tier 2) | ✅ Running |
| Excel | ExcelJS | Install at Tier 1 Step 3 |
| Auth | Deferred | Post-MVP |
| AI | Anthropic Claude API | Tier 2 |
| Repo | GitHub — main branch | ✅ Active |

---

## Definition of Done — Each Module

Before marking any module complete:
- [ ] Schema migrated and seeded
- [ ] API routes tested and returning correct shapes
- [ ] UI connected to live data
- [ ] Error states handled
- [ ] Committed to GitHub with descriptive message
- [ ] Tested against real or simulated bid data
