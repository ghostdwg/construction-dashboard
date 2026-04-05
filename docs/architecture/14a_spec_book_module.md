# Module 14a — Spec Book Upload + CSI Coverage Gap Report

## Purpose
Upload a project spec book PDF and automatically identify which CSI
sections have no assigned trade on the current bid. Surface gaps
before the bid invite goes out.

## Business Problem Solved
Estimators review spec books manually and miss sections.
A Division 08 11 13 hollow metal door spec with no door hardware
sub assigned becomes a change order after award.
This module catches it before the bid goes out.

## How It Works

### Step 1 — Upload
- User uploads spec book PDF on bid Documents tab
- File stored linked to bid
- Upload triggers CSI extraction job

### Step 2 — Extract
Service: lib/documents/specParser.ts

Pattern matching on spec section headers:
- "SECTION 03 30 00"
- "03 30 00 - CAST-IN-PLACE CONCRETE"
- "PART 1 - GENERAL" (section body marker)

Builds array:
{ csiCode: "03 30 00", title: "Cast-In-Place Concrete", rawText: "..." }

### Step 3 — Coverage Check
For each extracted section:
- Query trades on this bid
- Match bid trade csiCode against section csiCode
- Exact match → COVERED
- Division prefix match (03 vs 03 30 00) → PARTIAL
- No match → UNCOVERED

### Step 4 — Display
Spec Coverage panel on bid AI Review tab or dedicated Spec tab:

| CSI Code    | Section Title              | Status   | Trade Assigned |
|-------------|---------------------------|----------|----------------|
| 03 30 00    | Cast-In-Place Concrete    | ✅ Covered | Concrete — Foundations |
| 07 21 00    | Thermal Insulation        | ✅ Covered | Insulation |
| 08 71 00    | Door Hardware             | ❌ Missing | — Assign Trade |
| 10 14 00    | Signage                   | ⚠️ Partial | Signage |

### Step 5 — AI Review
"Send Uncovered to AI" button:
- Builds prompt with uncovered section titles and raw text snippets
- Sends to Claude via existing AI export infrastructure
- Returns findings into AiGapFinding workflow
- User reviews and approves

## Data Model

```prisma
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
```

## API Routes
- POST /api/bids/[id]/documents/spec — upload and trigger extraction
- GET /api/bids/[id]/spec-coverage — returns coverage report
- PATCH /api/spec-sections/[id] — assign trade to section
- POST /api/bids/[id]/spec-coverage/ai-review — send uncovered to Claude

## Install Required
```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

## Security Rules
- Raw spec text is NOT cost data — safe to send to AI
- No subcontractor pricing exists in spec books
- Standard AI export approval flow still applies

## Integration Points
- Feeds into AiGapFinding workflow (same as Step 6/7)
- Uses existing Trade dictionary for matching
- Uses existing AI Review tab infrastructure

## Build Prerequisites
- Step 6 Safe AI Export must be complete
- Step 7 AI Gap Findings must be complete
- Trade dictionary with csiCode populated (already done)

## Notes on CSI Matching Quality
Your trade dictionary already has CSI codes from the seed.
Match quality depends on spec book formatting consistency.
Most commercial specs follow MasterFormat — match rate is high.
Residential specs are less consistent — may need manual review.
