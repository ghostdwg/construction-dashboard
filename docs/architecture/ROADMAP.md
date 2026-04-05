# Build Roadmap — From Here to Done

## How to Read This

Each step is a single Claude Code session.
Complete one step fully before starting the next.
Commit to GitHub at the end of every step.

---

## WHERE YOU ARE NOW

```
✅ Step 0 — Schema v0.2 clean reset
           Trade dictionary, standalone sub directory,
           join tables, seed data, pushed to GitHub main
```

---

## TIER 1 — FOUNDATION
### Goal: A working bid tool that saves real time today

---

### Step 1 — Subcontractor Directory UI
**Session goal:** A real, usable subcontractor directory

What to build:
- GET /api/subcontractors (with trade, status, search filters)
- /subcontractors list page (filterable table)
- /subcontractors/[id] detail page (company info, trades, contacts)
- Add Subcontractor form (slide-out panel)
- Add Contact form (on detail page)

Brief to use: `docs/claude-code-briefs/brief_01_setup_and_directory.md`
(skip the project setup section — jump to Step 3 API Routes)

Commit message: `[Module 1] Subcontractor directory — list, detail, add forms`

Done when:
- You can add a new subcontractor with trades and contacts
- You can filter the list by trade, status, and company name
- Each sub has a detail page showing all their info

---

### Step 2 — Bid Detail Page
**Session goal:** A bid detail page with tabs

What to build:
- /bids/[id] page with shadcn Tabs
- Tab 1: Overview (project name, location, description, status, due date)
- Tab 2: Trades (list assigned trades, add/remove trades from bid)
- Tab 3: Subs (stub — placeholder only)
- Tab 4: Documents (stub — placeholder only)
- Status change button on Overview tab

Brief to use: `docs/claude-code-briefs/brief_02_bid_creation.md`
(skip schema migration — schema already done)

Commit message: `[Module 2] Bid detail page — overview and trades tabs`

Done when:
- Bid detail page loads with real data
- You can assign and remove trades on a bid
- Status can be changed from the detail page

---

### Step 3 — Sub Selection Per Bid
**Session goal:** Pick subs for a bid filtered by bid trades

What to build:
- Build out the Subs tab on /bids/[id]
- Suggested subs panel (filtered by bid's assigned trades)
- Selected subs panel (current BidInviteSelections)
- Add to bid / remove from bid actions

Brief to use: `docs/claude-code-briefs/brief_03_selection_and_export.md`
(Steps 2 and 3 only — skip schema migration)

Commit message: `[Module 3a] Sub selection per bid — suggested and selected panels`

Done when:
- Opening a bid shows relevant subs filtered by its trades
- You can add and remove subs from a bid
- Selected subs show company, trade, and primary contact

---

### Step 4 — Excel Export
**Session goal:** One-click Outlook-ready export

What to build:
- Install ExcelJS: `npm install exceljs`
- POST /api/bids/[id]/export/recipients
- ExportBatch record created on every export
- Export button on Subs tab
- File downloads with correct columns and formatting

Brief to use: `docs/claude-code-briefs/brief_03_selection_and_export.md`
(Steps 4 and 5)

Commit message: `[Module 3b] Excel export — Outlook-ready recipient list`

Done when:
- Clicking Export downloads an Excel file
- File has correct columns: Company, Trade, Contact, Email, Phone
- Header row is bold, top row frozen, auto-filter on
- ExportBatch record appears in database

---

**TIER 1 CHECKPOINT**
Before moving to Tier 2 — run the system on a real bid.
Add real subcontractors. Assign real trades. Export the list.
Does it save time? Is the data clean? Fix what's wrong before building more.

---

## TIER 2 — INTELLIGENCE
### Goal: AI-assisted scope gap review with cost data fully isolated

---

### Step 5 — Scope Normalization
**Session goal:** Structured scope items per bid mapped to trades

What to build:
- ScopeItem and ScopeTradeAssignment schema migration
- GET + POST /api/bids/[id]/scope
- Scope Breakdown tab on /bids/[id]
- Scope items grouped by trade
- Add scope item form

Brief to use: `docs/claude-code-briefs/brief_04_scope_and_ai_export.md`
(Steps 1, 2, and 3 only)

Commit message: `[Module 4] Scope normalization — items, trade assignment, breakdown tab`

Done when:
- Scope items can be added to a bid
- Items are grouped by assigned trade
- Restricted flag exists but is not editable in UI

---

### Step 6 — Safe AI Export
**Session goal:** JSON export with all cost data stripped, ready for Claude

What to build:
- AiExportBatch schema migration
- Safe AI Export service (redaction-first, second-pass validation)
- POST /api/bids/[id]/export/ai-safe
- AI Review tab on /bids/[id]
- Confirmation checklist before export
- Copy JSON and Download JSON buttons

Brief to use: `docs/claude-code-briefs/brief_04_scope_and_ai_export.md`
(Steps 4 and 5)

Commit message: `[Module 5] Safe AI export — redaction service, confirmation flow, JSON output`

Done when:
- Export strips all restricted items
- User must confirm checklist before generating
- AuditLog entry created for every export
- JSON is correct and copyable

---

### Step 7 — AI Gap Review + Question Generation
**Session goal:** Full loop from scope to findings to questions

What to build:
- AiGapFinding and GeneratedQuestion schema migration
- Findings import (paste AI output, parse, confirm)
- Finding review (approve / dismiss)
- Question generation from approved findings
- Questions tab on /bids/[id]
- Outreach log stubs

Brief to use: `docs/claude-code-briefs/brief_05_findings_and_questions.md`

Commit message: `[Module 6-7] AI findings import, question generation, questions tab`

Done when:
- Full loop works: scope → export JSON → paste to Claude → import findings → approve → generate question
- Questions can be edited and moved through status flow
- OutreachLog entries created on export and question send

---

**TIER 2 CHECKPOINT**
Run a real AI scope review on a real bid.
Is the JSON clean? Are the findings useful?
Are the generated questions something you'd actually send?
Fix prompt templates and question drafting before building Tier 3.

---

## TIER 3 — WORKFLOW
### Goal: Full audit trail and reporting

---

### Step 8 — Outreach + Response Logging UI
Full outreach lifecycle tracking per bid and sub.
Brief: Build from scratch — no existing brief, describe to Claude Code directly.

### Step 9 — Reporting Dashboard
KPIs: bids by status, trades with no coverage, response rates, gap counts.
Brief: Build from scratch after real data exists.

---

## DEFERRED — Do Not Build Yet

- Spec PDF parsing
- Procore submittal integration  
- Microsoft Graph / Outlook automation
- PostgreSQL migration (do before Tier 2 if JSON fields needed)
- Authentication and user roles
- Workflow rules engine
- Learning engine / predictive coverage

---

## Commit Discipline

Every session ends with:
```bash
git add .
git commit -m "[Module X] Description of what was built"
git push
```

Never leave a session without committing working code.
If something is broken at end of session, commit anyway with message:
`[Module X] WIP — [describe what is broken]`
