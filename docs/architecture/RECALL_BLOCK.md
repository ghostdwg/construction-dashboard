# RECALL BLOCK
# Paste this at the top of any new Claude chat to resume instantly

---

I am building a modular preconstruction intelligence system for 
commercial construction bid management. Built solo with Claude Code 
in VS Code, GitHub tracked.

## Repo
Local: c:/Users/jjcou/bid-dashboard
Branch: main

## What Is Built — Tiers 1-3 Complete

Tier 1 — Foundation:
- Subcontractor directory with trade filtering
- Bid management with tabbed detail page
- Sub selection per bid filtered by bid trades
- Excel export for Outlook (ExcelJS)
- 46 real trades seeded from our internal cost code structure

Tier 2 — Intelligence:
- Scope normalization — ScopeItem with trade assignment
- Safe AI export — redaction service, second-pass validation, approval flow
- AI gap findings — paste findings, parse, review kanban, approve
- Question generation — draft questions from approved findings

Tier 3 — Workflow:
- Outreach and response logging with auto-log on export
- Reporting dashboard — KPIs, trade coverage, response rates, aging

## Tech Stack
Next.js 14 App Router, TypeScript, Tailwind CSS, Prisma ORM, 
SQLite (dev), ExcelJS, recharts

## Schema Models In DB
Trade, Bid, BidTrade, Subcontractor, SubcontractorTrade, Contact,
BidInviteSelection, ExportBatch, ScopeItem, ScopeTradeAssignment,
AiExportBatch, AiGapFinding, GeneratedQuestion, OutreachLog

## Current Bid Detail Tabs
Overview, Trades, Scope, Subs, AI Review, Questions, Activity, Documents

## Next To Build — Module 2b: Subcontractor Intelligence Layer
Adds to existing subcontractor directory:
- Tier field: preferred / approved / new / inactive
- Project type tagging per sub
- PreferredSub join table — preferred subs per trade
- Auto-populate bid list from preferred subs on bid creation
- RFQ status on BidInviteSelection: invited/received/reviewing/accepted/declined/no_response
- Subs tab becomes live RFQ tracker grouped by trade

## Key Docs In Repo
docs/architecture/CURRENT_STATE.md — full build status
docs/architecture/ROADMAP.md — full build sequence
docs/claude-code-briefs/ — session briefs for Claude Code
docs/schemas/master_schema.md — full Prisma schema target
docs/workflows/ai_review_prompts.md — AI scope review prompts

## After Module 2b
Tier 4 — Document Intelligence:
- Step 14a: Spec book upload, CSI section extraction, coverage gap report
- Step 14b: Drawing sheet index parsing, discipline to trade coverage check
- Step 5b: Estimate sanitization — strip company identity and money from any format

## Token Management Rules
- New Claude chat per build tier or major module
- New Claude Code session per step
- Always paste SESSION STARTER at top of each Claude Code session
- Commit to GitHub at end of every session
