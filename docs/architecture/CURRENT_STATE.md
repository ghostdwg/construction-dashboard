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
| Module 14 | Document Intelligence (14a + 14b combined) | 🔄 In Progress |
| Module 5b | Estimate Sanitization — redaction engine | ⬜ Queued |
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
- Three-state CSI matching — covered / missing / unknown (in progress)

## Current Known State
- pdfjs-dist installed and working — pdf-parse removed
- SpecBook and SpecSection models in schema
- Three-state matching (tradeId / matchedTradeId) — schema
  change pending as part of Module 14 active session
- DrawingUpload and DrawingSheet models — pending Module 14
- Tab reorder pending — Documents moves to position 2

## Pricing / AI Boundary — Non-Negotiable
EstimateUpload.pricingData is never returned to client and
never included in any AI prompt. Only scopeLines go to AI.
