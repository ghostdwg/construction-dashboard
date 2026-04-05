# Module 5b — Estimate Sanitization Module

## Purpose
Accept a subcontractor estimate in any format, strip all company
identity and money data, and produce an anonymized scope document
safe for AI review and leveling meetings.

## Business Problem Solved
Sub estimates contain pricing you cannot share with other subs
or send to AI tools. But the scope language inside those estimates
is exactly what you need for gap analysis and leveling.
This module separates the two.

## Key Design Decision
This is NOT a cost code parser.
Sub estimates have no standard format — "per plans and addendum"
is as common as a detailed line item list.
The goal is sanitization and anonymization, not structured parsing.

## What Gets Stripped

### Company Identity
| What | Replaced With |
|------|--------------|
| Company name | [SUBCONTRACTOR A] |
| Address | [REDACTED] |
| Phone number | [REDACTED] |
| Email address | [REDACTED] |
| Contact name | [REDACTED] |
| License number | [REDACTED] |

Internal mapping stored in database:
{ token: "SUBCONTRACTOR A", subcontractorId: 12, bidId: 3 }
This mapping never leaves the system.

### Money Patterns
| Pattern | Example | Action |
|---------|---------|--------|
| Dollar sign values | $1,250,000 | → [AMOUNT REDACTED] |
| Comma-formatted numbers | 1,250,000.00 | → [AMOUNT REDACTED] |
| Unit prices | 45.00/SF | → [AMOUNT REDACTED] |
| Lump sum notation | LS, L.S. | → [AMOUNT REDACTED] |
| Money keywords in headers | Price, Cost, Amount, Rate, Value, Bid, Fee, Total, Proposal | Strip entire column (xlsx) or line (pdf/docx) |
| Allowance language | "$50,000 allowance" | → "[AMOUNT REDACTED] allowance" |

## What Gets Preserved
- All scope description text
- Inclusion language ("includes...", "scope includes...")
- Exclusion language ("excludes...", "not included...", "NIC")
- "Per plans and specifications" language
- Trade and CSI references
- Schedule and lead time notes ("16-20 week lead time")
- Clarification notes and qualifications
- Division and section headers

## Format Handling

### Excel (.xlsx) — Highest Quality
Strategy: column-based
1. Read all column headers
2. Identify money columns: Price, Cost, Amount, Unit, Total, Bid
3. Delete entire money columns
4. Keep description columns
5. Scan remaining cells for money patterns — strip any found
6. Replace company info in header rows

### Word (.docx) — High Quality
Strategy: paragraph-based
1. Extract all paragraphs
2. Run regex pass on each paragraph
3. Replace money patterns with [AMOUNT REDACTED]
4. Replace company patterns with [SUBCONTRACTOR X]
5. Preserve paragraph structure

### PDF (Bluebeam-printed) — High Quality for text PDF
Strategy: text extraction then regex
1. pdf-parse extracts raw text
2. Same regex passes as Word
3. Note: scanned PDFs require OCR — flag for manual review

### Scanned PDF — Deferred
OCR required. Flag these for manual review rather than attempting
automated sanitization. User can manually redact in Bluebeam.

## Output
Sanitized text document stored in database linked to bid.
Displayed in system as anonymized scope for review.
Safe to:
- Send to Claude for scope gap analysis
- Display in leveling meetings
- Compare across multiple subs side by side

## AI Use Case After Sanitization

Single sub review:
"Review this subcontractor scope proposal for the Electrical trade.
What scope is included? What appears to be excluded?
What is ambiguous or missing that should be clarified?"

Multi-sub comparison (most valuable):
"Here are three anonymized scope proposals for the Electrical trade.
Compare what each one includes and excludes.
What scope appears in none of the three proposals?
What scope does only one of the three include?"

## Data Model

```prisma
model EstimateUpload {
  id              Int      @id @default(autoincrement())
  bidId           Int
  subcontractorId Int?
  tradeId         Int?
  originalFileName String
  fileType        String   // "xlsx" | "docx" | "pdf" | "pdf-scanned"
  sanitizedText   String   // stored after processing
  anonToken       String   // "SUBCONTRACTOR A"
  status          String   @default("pending") // pending | sanitized | reviewed | rejected
  reviewedBy      String?
  createdAt       DateTime @default(now())

  bid           Bid            @relation(fields: [bidId], references: [id])
  subcontractor Subcontractor? @relation(fields: [subcontractorId], references: [id])
}
```

## API Routes
- POST /api/bids/[id]/estimates/upload — upload and queue sanitization
- GET /api/bids/[id]/estimates — list all uploaded estimates with status
- GET /api/bids/[id]/estimates/[id]/sanitized — view sanitized text
- POST /api/bids/[id]/estimates/compare — send multiple to AI for comparison

## Install Required
```bash
npm install pdf-parse mammoth
npm install --save-dev @types/pdf-parse
```
mammoth handles .docx extraction.
pdf-parse handles text PDFs.
xlsx (already used for export) handles Excel files.

## Human Review Step
After sanitization, user sees:
- Side by side: original filename vs anonymized token
- Sanitized text with [REDACTED] markers visible
- Count of items redacted
- Any lines flagged as "may contain pricing — review manually"
- Approve or reject before text is used in AI workflow

## Build Prerequisites
- Step 7 AI Gap Findings must be complete
- Subcontractor directory must have real subs entered
- At least one real estimate uploaded for testing

## Important Note on "Per Plans and Addendum"
This is valid scope language — it means the sub is including
everything shown on the drawings. The system should preserve it
exactly as written and flag it in the AI review prompt as:
"This proposal uses summary language — confirm scope coverage
in a follow-up question."
