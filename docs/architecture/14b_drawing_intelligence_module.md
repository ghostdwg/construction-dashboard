# Module 14b — Drawing Sheet Index Parsing + Trade Coverage Check

## Purpose
Parse a drawing set sheet index to identify which engineering
disciplines are present, then cross-reference against assigned
trades to flag missing coverage before bid invite.

## Business Problem Solved
A drawing set with M-sheets (Mechanical) and no HVAC sub assigned
is a gap waiting to become a problem. The sheet index tells you
what disciplines exist in the design without reading a single drawing.

## Discipline → Trade Mapping

| Sheet Code | Discipline | Maps To Trade |
|------------|-----------|---------------|
| A | Architectural | Framing, Drywall, Doors, Glazing, Finishes |
| S | Structural | Structural Steel, Concrete, Rebar |
| C | Civil | Site Work, Paving, Site Utilities |
| L | Landscape | Landscaping, Grading / Sod |
| M | Mechanical | HVAC / Mechanical |
| P | Plumbing | Plumbing |
| E | Electrical | Electrical |
| FP | Fire Protection | Fire Suppression |
| T | Technology | Low Voltage / Communications |
| FA | Fire Alarm | Fire Alarm |
| G | General / Cover | General Conditions (internal) |

## How It Works

### Step 1 — Upload
- User uploads drawing set PDF on bid Documents tab
- System extracts first 5 pages (sheet index is always early)
- Alternatively: user uploads sheet index only

### Step 2 — Parse Sheet Index
Service: lib/documents/drawingParser.ts

Pattern matching for sheet entries:
- "A-101 First Floor Plan"
- "M-201 Mechanical Plan - Level 2"
- "E-001 Electrical Site Plan"

Regex: /^([A-Z]{1,2})-(\d+)\s+(.+)$/m

Builds array:
{ sheetNumber: "M-201", discipline: "M", title: "Mechanical Plan Level 2" }

### Step 3 — Coverage Check
For each discipline found:
- Map discipline code to expected trades
- Check if bid has those trades assigned
- Flag missing trades

Example:
Drawing set has: A, S, M, P, E, FP sheets
Bid has assigned: Framing, Electrical, Plumbing
Missing: HVAC / Mechanical, Fire Suppression, Structural Steel

### Step 4 — Display
Drawing Coverage panel on bid detail:

| Discipline | Sheets Found | Trade Required | Status |
|-----------|-------------|----------------|--------|
| A — Architectural | 24 sheets | Framing, Drywall, Doors | ✅ |
| M — Mechanical | 8 sheets | HVAC / Mechanical | ❌ Not assigned |
| E — Electrical | 12 sheets | Electrical | ✅ |
| FP — Fire Protection | 4 sheets | Fire Suppression | ❌ Not assigned |

"Add Missing Trades" button assigns them to the bid in one click.

## Data Model

```prisma
model DrawingSet {
  id          Int      @id @default(autoincrement())
  bidId       Int
  fileName    String
  pageCount   Int?
  uploadedAt  DateTime @default(now())
  sheets      DrawingSheet[]

  bid Bid @relation(fields: [bidId], references: [id])
}

model DrawingSheet {
  id           Int     @id @default(autoincrement())
  drawingSetId Int
  sheetNumber  String
  discipline   String
  title        String
  covered      Boolean @default(false)

  drawingSet DrawingSet @relation(fields: [drawingSetId], references: [id])
}
```

## API Routes
- POST /api/bids/[id]/documents/drawings — upload and parse
- GET /api/bids/[id]/drawing-coverage — returns discipline coverage
- POST /api/bids/[id]/drawing-coverage/add-missing — adds flagged trades

## Important Limitation
Sheet index parsing tells you what disciplines are designed.
It does not tell you what is on each sheet.
A floor plan could show a mechanical room that the M sheets don't cover.
That is Step 14c territory — deferred.

For now: sheet index coverage catches the obvious discipline gaps.
That alone prevents the most common missed-trade scenarios.

## Build Prerequisites
- Step 14a must be complete
- Trade dictionary with discipline mapping configured in admin

---

# Module 14c — Drawing Content Review (Deferred)

## Status: DEFERRED — Revisit 2026

## What This Would Do
Use Claude Vision API to review individual drawing sheets and answer
targeted questions about content:

Floor plans:
- "Does this plan show a mechanical/electrical room?"
- "Are there rated wall assemblies shown?"
- "What specialty rooms are on this level?"

Reflected ceiling plans:
- "What ceiling types are shown?"
- "Are there soffits or dropped ceilings requiring framing?"

MEP plans:
- "What systems are shown on this sheet?"
- "Are there equipment items requiring structural support?"

Details:
- "What specialty items require trade coordination?"
- "Are there penetrations requiring fire caulking?"

## Why Deferred

1. Hallucination risk on technical drawings is still too high
   for bid-critical decisions without heavy human review

2. Scale problem: 400-sheet drawing set = 400 Vision API calls
   Slow, expensive, and each call needs human validation

3. Sheet index parsing (14b) catches 70% of the value at 5% cost

4. Claude Vision capability improving rapidly
   The gap between today and "reliable enough to act on" is closing

## Trigger to Build
When Claude Vision can correctly identify:
- Room types from floor plans: 95%+ accuracy on test set
- System types from MEP plans: 90%+ accuracy on test set
- Specialty items from details: 85%+ accuracy on test set

Test against 20 real project sheets before building into workflow.

## Future Prompt Structure (for reference)
System prompt:
"You are reviewing construction drawings for a preconstruction manager.
Your job is to identify scope items that require subcontractor coverage.
Be specific. Do not hallucinate. If you cannot determine something with
confidence, say 'unclear from this sheet' rather than guessing."

Per-sheet prompt:
"Sheet [number]: [title]
What trades are required based on what you see on this sheet?
What items shown here are not typically covered by standard trade scopes
and may need explicit clarification in the bid package?"
