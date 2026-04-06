# Roadmap — Preconstruction Intelligence System
# Last Updated: Workflow redesign — spec-driven bid setup

---

## MASTER WORKFLOW (Official)

This is the intended sequence for every bid:

  1. CREATE BID
     Project name, number, due date, location

  2. UPLOAD DOCUMENTS (Documents tab)
     Spec book and/or drawing sheet index — both optional
     System extracts CSI sections and drawing disciplines
     Supports three job types:
     - Full package: spec book + drawings
     - Drawings only
     - Neither: manual trade entry fallback always works

  3. CONFIRM TRADE LIST (Trades tab)
     System proposes trades from document extraction
     Estimator confirms, removes, or adds manual trades
     Confirmed trades write to BidTrade

  4. BUILD SUB LIST (Subs tab)
     System auto-populates from preferred subs per trade
     Estimator adds or removes as needed
     RFQ list is ready to send

  5. RECEIVE ESTIMATES (Leveling tab)
     Upload sub estimates as they arrive
     Scope lines extracted per sub per trade
     Pricing data stored separately — never touches AI

  6. SCOPE GAP ANALYSIS (AI Review tab)
     AI compares sub scope coverage against spec book
     and drawing requirements
     Gap = something required by documents that no sub covered
     Grounded in contract documents, not inference

  7. LEVELING + QUESTIONS (Leveling tab)
     Side-by-side comparison
     Gap-informed clarification questions sent to subs

  8. AWARD

---

## BID DETAIL TAB ORDER (Updated)

  1. Overview
  2. Documents   ← moved from last position
  3. Trades
  4. Scope
  5. Subs
  6. AI Review
  7. Questions
  8. Leveling
  9. Activity

---

## BUILD SEQUENCE

### Tiers 1–3 ✅ Complete
  All foundation, intelligence, and workflow modules built.
  See CURRENT_STATE.md for full list.

### Module 2b ✅ Complete
  Subcontractor Intelligence Layer
  Tier system, preferred subs, RFQ status tracking

### Module 6a ✅ Complete
  Estimate Intake
  Upload, parse, scope extraction, pricing boundary enforced

### Module 6b ✅ Complete
  Scope Leveling Engine
  LevelingSession, LevelingRow, side-by-side UI, inline editing

### Module 6c ✅ Complete
  Leveling Questions + Export
  AI question drafting, anonymized Excel export

### Audit Session ✅ Complete
  Full workflow debug — type errors, route hardening,
  fetch error states, outreach logging fix

### Module 14 ✅ Complete
  Document Intelligence — combined 14a + 14b

  Spec book upload (pdfjs-dist), CSI section extraction,
  drawing sheet index upload, discipline parsing.
  Three-state matching against full trade dictionary:
  covered / missing from bid / unknown.
  Trade proposal UI with Add to Bid, manual assign, rematch.
  Documents tab at position 2.

### Module 5b 🔄 In Progress
  Estimate Sanitization — redaction engine
  Strip sub identity and pricing from any estimate format
  before AI comparison. Anonymized tokens only.

### Module 15 ⬜ Queued
  AI Review Prompt Enhancement
  Feed spec sections and drawing disciplines into gap analysis
  as project document context. Gaps become grounded in actual
  contract documents rather than AI inference alone.
  This is additive — no schema changes required.

---

## NEVER DO
- Return pricingData to client
- Include sub name or company in any AI prompt
- Mix planning and build execution in same Claude Code session
- Commit .claude/settings.local.json
