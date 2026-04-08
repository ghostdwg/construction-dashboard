# Current State — Preconstruction Intelligence System
# Last Updated: Module 16a complete — Addendum Delta Processing / Tier A complete

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
| Module 5b | Estimate Sanitization — redaction engine | ✅ Complete |
| Module 15 | AI Review + Gap Analysis (15a + 15b) | ✅ Complete |
| Module GNG1 | Go/No-Go Gate Widget | ✅ Complete |
| Module 16a | Addendum Delta Processing | ✅ Complete |
| **Tier A** | **All modules complete** | **✅ Complete** |
| Tier B — Module P1 | — | ⬜ Next |

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
- ProjectType enum on Bid (PUBLIC / PRIVATE / NEGOTIATED)
- AiGapFinding with title, sourceRef, severity, sourceDocument, reviewNotes
- BidIntelligenceBrief with riskFlags, assumptionsToResolve, isStale, sourceContext, addendumDeltas
- AddendumUpload with deltaJson, deltaGeneratedAt, summary — delta stored per-addendum, brief untouched
- GAP_STUB_MODE, BRIEF_STUB_MODE, ADDENDUM_STUB_MODE env flags bypass Anthropic API for dev
- Go/No-Go widget on Overview tab — four gates scored from existing bid data, no AI call
- Addendum delta processing — incremental delta prompt, scope changes, new risks, actions required checklist
- Stale banner on Overview links to Documents tab (not regenerate) — delta processing clears stale flag

## Pricing / AI Boundary — Non-Negotiable
EstimateUpload.pricingData is never returned to client and
never included in any AI prompt. Only scopeLines go to AI.
