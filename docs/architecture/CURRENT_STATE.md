# Current State — Preconstruction Intelligence System
# Last Updated: Module 14 in progress — Document Intelligence

## Repository
- GitHub: ghostdwg/bid-dashboard — main branch
- Local: c:/Users/jjcou/bid-dashboard
- Stack: Next.js 14, TypeScript, Tailwind, Prisma, SQLite

## Build Status

| Module | Description | Status |
|--------|-------------|--------|
| Tiers 1–3 | Foundation, Intelligence, Workflow | ✅ Complete |
| Module 2b | Subcontractor Intelligence Layer | ✅ Complete |
| Module 6a | Estimate Intake | ✅ Complete |
| Module 6b | Scope Leveling Engine | ✅ Complete |
| Module 6c | Leveling Questions + Export | ✅ Complete |
| Audit Session | Full workflow debug + error handling | ✅ Complete |
| Module 14 | Document Intelligence (14a + 14b combined) | ✅ Complete |
| Module 5b | Estimate Sanitization — redaction engine | 🔄 In Progress |
| Module 15 | AI Review prompt enhancement | ⬜ Queued |

## What Is Built
- Subcontractor directory with trade filtering and tier system
- Bid management with tabbed detail view
- Trade assignment from 46-trade dictionary with CSI codes
- Sub selection filtered by bid trades
- Excel export for Outlook distribution
- Scope normalization with trade assignment
- Safe AI export with redaction and approval flow
- AI gap findings import, review, and approval
- Question generation and status workflow
- Outreach and response logging
- Reporting dashboard with live KPIs
- Estimate intake with pricing boundary enforced
- Scope leveling — side by side, inline status and notes
- Leveling questions with AI draft + anonymized Excel export
- Spec book upload — CSI extraction via pdfjs-dist (working)
- Drawing sheet index upload — discipline parsing, trade mapping
- Three-state matching — covered / missing from bid / unknown
- Trade proposal UI — Add to Bid, manual assign, rematch trigger
- Documents tab at position 2 in tab order

## Current Known State
- pdfjs-dist installed and working — pdf-parse removed
- SpecBook, SpecSection, DrawingUpload, DrawingSheet models in schema
- Three-state matching live: tradeId (covered) / matchedTradeId (missing) / both null (unknown)
- Module 5b in progress — redaction engine for estimate sanitization

## Pricing / AI Boundary — Non-Negotiable
EstimateUpload.pricingData is never returned to client and
never included in any AI prompt. Only scopeLines go to AI.
