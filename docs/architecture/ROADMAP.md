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

---

## STEP 5b — Estimate Import Pipeline
### Added based on workflow: estimates received as .docx, .pdf, .xlsx — standardized to PDF via Bluebeam

**Position in build order:** After Step 5 (Scope Normalization) is validated, before Step 6 (Safe AI Export) is heavily used.

**Goal:** Upload a Bluebeam-printed PDF estimate and have the system parse it into ScopeItems automatically, grouped by trade, ready for human review before AI export.

---

### Phase 1 — Your Own Estimate Format (Build First)
You control the format. Cost codes are known. Parser confidence is high.

What to build:
- PDF upload on the bid detail page (new Documents tab function)
- pdf-parse library extracts raw text from uploaded PDF
- Parser scans text for cost code patterns from cost_codes_full.ts
- Matched codes map to parent Trade via trade_seed.ts costCode field
- Creates ScopeItem draft records marked status: "imported" (not confirmed)
- Human review screen: confirm, edit, or reject each parsed item
- Confirmed items become live ScopeItems feeding into Safe AI Export

Install required:
- pdf-parse: PDF text extraction
- OR pdfjs-dist: more robust, handles more PDF types

Schema addition needed:
- Add importedFrom String? to ScopeItem (tracks which upload batch)
- Add importStatus String? to ScopeItem: "imported" | "confirmed" | "rejected"

---

### Phase 2 — Sub Estimate Parsing (Build Second)
Sub estimates have no standard format. Fuzzy matching required.

Matching strategy:
- First pass: exact cost code match (e.g. "3.013")
- Second pass: CSI code match (e.g. "03 30 00")  
- Third pass: keyword match against trade names and descriptions
- Unmatched lines flagged for manual assignment

---

### Parse Quality by Source
| Source | Method | Expected Quality |
|--------|--------|-----------------|
| Your Excel estimate → Bluebeam PDF | Cost code exact match | Very high |
| Sub Excel estimate → Bluebeam PDF | Fuzzy code + keyword | High |
| Word scope narrative → Bluebeam PDF | Keyword only | Medium |
| Scanned/image PDF | OCR required | Deferred |

---

### What Is Needed Before Building
One sample PDF export from your own estimate with dollar amounts 
removed or zeroed out. This confirms the layout before the parser is written.

Without a sample, the parser will be written generically and will need 
heavy tuning against your real format.

---

### Commit message when built:
`[Step 5b] Estimate import — PDF parser, draft scope items, human review screen`

---

## TIER 4 — DOCUMENT INTELLIGENCE
### Goal: Cross-reference spec books and drawings against bid scope to catch gaps before invite

---

### Step 14a — Spec Book Upload + CSI Coverage Gap Report
**Capability: High confidence — buildable now**

The spec book is a text document structured by CSI division.
Your trade dictionary already has CSI codes.
This module bridges the two.

What to build:

1. Spec book upload on bid detail Documents tab
   - Accept PDF only (Bluebeam-printed specs)
   - Store in /documents/specs/ folder linked to bid

2. CSI Section Extractor service
   - pdf-parse extracts full text
   - Parser identifies section headers by pattern:
     "SECTION 03 30 00" or "03 30 00 - CAST-IN-PLACE CONCRETE"
   - Builds array of: { csiCode, sectionTitle, rawText }

3. Coverage gap detection
   - For each extracted CSI section:
     - Check if bid has a trade assigned with matching csiCode
     - If no match: flag as UNCOVERED
     - If match exists: flag as COVERED
   - Output: { covered: [], uncovered: [], partial: [] }

4. Spec Coverage tab on bid detail (or section within AI Review tab)
   - Table showing every spec section found
   - Green = covered by assigned trade
   - Red = no trade assigned
   - Yellow = partial match (CSI prefix matches but not exact)
   - "Assign Trade" button on uncovered rows

5. Send uncovered sections to Claude
   - Builds prompt automatically:
     "These spec sections exist in the project spec book but have
      no assigned trade on this bid. For each section, identify
      what scope is required and which trade typically carries it."
   - Returns findings into AiGapFinding workflow

Schema additions needed:
model SpecSection {
  id          Int      @id @default(autoincrement())
  bidId       Int
  csiCode     String
  title       String
  rawText     String
  covered     Boolean  @default(false)
  tradeId     Int?
  createdAt   DateTime @default(now())

  bid   Bid    @relation(fields: [bidId], references: [id])
  trade Trade? @relation(fields: [tradeId], references: [id])
}

Install required: pdf-parse

Commit message: [Step 14a] Spec book upload — CSI extraction, coverage gap report

Done when:
- Upload a spec book PDF and see every CSI section listed
- Uncovered sections highlighted in red
- Can assign a trade to an uncovered section
- Can send uncovered sections to Claude for gap analysis

---

### Step 14b — Drawing Sheet Index Parsing + Trade Coverage Check
**Capability: High confidence — buildable now**

Drawing sheet indexes are consistent enough to parse reliably.
Sheet discipline codes (A, S, M, E, P, C, L) map directly to trades.

Sheet discipline → Trade mapping:
A  = Architectural        → Framing, Drywall, Doors, Glazing, Finishes
S  = Structural           → Structural Steel, Concrete, Rebar
C  = Civil                → Site Work, Paving, Site Utilities
L  = Landscape            → Landscaping, Grading
M  = Mechanical           → HVAC / Mechanical
P  = Plumbing             → Plumbing
E  = Electrical           → Electrical
FP = Fire Protection      → Fire Suppression
T  = Technology / Low V   → Low Voltage / Communications

What to build:

1. Drawing set upload on bid detail Documents tab
   - Accept PDF (full drawing set or sheet index only)
   - If full set: extract first 3 pages (usually sheet index)
   - If sheet index only: extract all pages

2. Sheet Index Parser service
   - Extract text from sheet index pages
   - Identify sheet entries by pattern: letter(s)-number description
     e.g. "A-101 First Floor Plan" or "M-201 Mechanical Plan Level 2"
   - Build array: { sheetNumber, discipline, title }

3. Discipline → Trade gap check
   - For each discipline found in drawing set:
     - Check if bid has corresponding trade assigned
     - If no match: flag as MISSING TRADE
   - Example: drawing set has M sheets but no HVAC trade assigned → flag

4. Drawing Coverage panel on bid detail
   - List of disciplines found in drawing set
   - Green = trade assigned
   - Red = no trade assigned for this discipline
   - "Add Trade" button on red rows

5. Feed gaps into AI Review
   - "Drawing set shows Plumbing discipline sheets but
      no Plumbing sub is selected — confirm scope coverage"

Schema additions needed:
model DrawingSet {
  id          Int      @id @default(autoincrement())
  bidId       Int
  fileName    String
  uploadedAt  DateTime @default(now())
  sheets      DrawingSheet[]

  bid Bid @relation(fields: [bidId], references: [id])
}

model DrawingSheet {
  id           Int    @id @default(autoincrement())
  drawingSetId Int
  sheetNumber  String
  discipline   String
  title        String
  covered      Boolean @default(false)

  drawingSet DrawingSet @relation(fields: [drawingSetId], references: [id])
}

Commit message: [Step 14b] Drawing sheet index — discipline parsing, trade coverage check

Done when:
- Upload a drawing set PDF and see sheet index parsed
- Each discipline shows whether a trade is assigned
- Missing trades flagged and actionable

---

### Step 14c — Drawing Content Review (Deferred)
**Capability: Medium confidence today — defer 12-18 months**

What this would do:
- Claude Vision API reviews individual drawing sheets
- Answers targeted questions per sheet type:
  Floor plans: "Does this plan show a mechanical room?"
  Reflected ceiling plans: "What ceiling types are shown?"
  MEP plans: "What systems are shown on this sheet?"
  Details: "What specialty items require coordination?"

Why deferred:
- Hallucination risk on technical drawings still too high
- 400-sheet set = 400 AI calls = slow and expensive
- Sheet index parsing (14b) catches 70% of gaps at 5% of the cost
- Claude Vision capability improving rapidly — revisit in 2026

Trigger to build:
- Claude Vision demonstrates reliable drawing interpretation
  on a test set of 20 real project sheets with < 5% error rate

---

### Step 5b — Estimate Sanitization Module
**Updated spec — not a cost code parser, a redaction engine**

What you receive: sub estimates in any format, any layout
What the system does: strips identity and money, preserves scope

Sanitization rules:
STRIP company identity:
- Company name, address, phone, email, contact name
- Replace with token: [SUBCONTRACTOR A], [SUBCONTRACTOR B]
- Store mapping internally: token → subcontractorId (never exported)

STRIP money patterns:
- Any value preceded by $
- Numbers with comma formatting: 1,250,000
- Numbers followed by /SF, /LF, /EA, /unit, /each
- Words: total, lump sum, LS, allowance, unit price, per unit, bid amount
- Column headers: price, cost, amount, rate, value, bid, fee, proposal

PRESERVE:
- All scope description text
- Inclusion and exclusion language
- Trade and CSI references
- Schedule and lead time notes
- Clarification notes
- "Per plans and specifications" language

Format handling:
| Format | Method | Quality |
|--------|--------|---------|
| Excel (.xlsx) | Strip money columns by header | Very high |
| Word (.docx) | Regex pass on paragraphs | High |
| Text PDF | Extract then regex | High |
| Scanned PDF | OCR required | Deferred |

Output:
- Anonymized text document attached to bid
- Internal mapping: SUBCONTRACTOR A = Apex Electrical (id: 3)
- Safe to send to Claude for scope comparison across multiple subs
- Safe to display in leveling meetings without exposing pricing

AI use case once sanitized:
"Here are three anonymized scope proposals for the Electrical trade.
Compare what each one includes and excludes.
What scope appears in none of the three proposals?"

Commit message: [Step 5b] Estimate sanitization — redaction engine, anonymization, AI-safe output

---

## FULL UPDATED BUILD SEQUENCE

### Tier 1 — Foundation ✅ Complete
Step 0  Schema v0.2 clean reset
Step 1  Subcontractor directory UI
Step 2  Bid detail page with tabs
Step 3  Sub selection per bid
Step 4  Excel export for Outlook
        Trade dictionary — 46 real trades seeded

### Tier 2 — Intelligence (In Progress)
Step 5  Scope normalization — ScopeItem, ScopeTradeAssignment
Step 5b Estimate sanitization — redaction engine (after Step 7)
Step 6  Safe AI export — redaction service, approval flow ✅ Built
Step 7  AI gap findings import + question generation

### Tier 3 — Workflow
Step 8  Outreach and response logging UI
Step 9  Reporting dashboard

### Tier 4 — Document Intelligence
Step 14a Spec book upload — CSI extraction, coverage gap report
Step 14b Drawing sheet index — discipline parsing, trade coverage
Step 14c Drawing content review — deferred, revisit 2026
