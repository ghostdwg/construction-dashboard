@AGENTS.md

# System Overview

A modular preconstruction intelligence platform covering the full project lifecycle —
from bid intake through post-award handoff. Designed for a solo estimator managing
multiple bids simultaneously.

## Three-Wing Pursuit Architecture

- **Wing 1 — Job Intake (Module INT1, queued):** Project context capture before AI runs
  (delivery method, owner type, building type, constraints). Branches risk and compliance.
- **Wing 2 — Scope Intelligence (Modules 14, 15, 15a, 15b):** What specs require vs what
  subs cover. Document ingestion, brief generation, per-trade gap analysis.
- **Wing 3 — Bid Leveling (Modules 6a-6c, Tier C, Tier D):** Apples-to-apples comparison,
  estimate intelligence, bid assembly, post-bid analytics.

After award, the UI shifts from pursuit modules to post-award handoff (Tier E queued),
with all pursuit data carrying forward. Procore export bridge (Tier F queued) follows.

## Framework Phases

| Phase | Coverage |
|-------|----------|
| 0 — Job intake | Module INT1 (queued) |
| 1 — Document ingestion | Module 14, 15a |
| 2 — Quantity takeoff | Tier C — Module Q1 (future) |
| 3 — Risk assessment | Module 15a + GNG1 |
| 4 — Procurement strategy | Tier B — Modules P1-P4 |
| 4a — RFQ distribution | Module RFQ1 (queued) |
| 5 — RFI management | Questions tab + Module P3 |
| 6 — Estimate development | Modules 6a-6c + Tier C |
| 7 — Bid assembly | Tier D |
| 8 — Post-bid management | Tier D |
| Post-award — Handoff | Tier E (queued) |
| Post-award — Procore bridge | Tier F (queued) |

# Build State

## Current Build State
- Tiers 1–3: COMPLETE
- Module 2b — Subcontractor Intelligence Layer: COMPLETE
- Module 5b — Estimate Sanitization: COMPLETE
- Module 6a — Estimate Intake: COMPLETE
- Module 6b — Scope Leveling Engine: COMPLETE
- Module 6c — Leveling Questions + Export: COMPLETE
- Audit Session: COMPLETE
- Module 14 — Document Intelligence: COMPLETE
- Module 15 — AI Review + Gap Analysis: COMPLETE
- Module 15a — Bid Intelligence Brief: COMPLETE
- Module 15b — Per-Trade Scope Gap Analysis: COMPLETE
- Module GNG1 — Go/No-Go Gate Widget: COMPLETE
- Module 16a — Addendum Delta Processing: COMPLETE
- Tier A — AI Layer + Core Data Model: COMPLETE
- Module P1 — Procurement Timeline Engine: COMPLETE
- Module P2 — Trade Tier Classification UI: COMPLETE
- Module P3 — RFI Register Upgrade: COMPLETE
- Module P4 — Public Bid Compliance Checklist: COMPLETE
- Tier B — Procurement Intelligence Layer: COMPLETE
- Tier C — Estimate Intelligence Layer: COMPLETE
  - Module C1 — Bid Spread Analysis: COMPLETE
  - Module C2 — Scope-Cost Correlation: COMPLETE
  - Module C3 — Estimate Intelligence Summary: COMPLETE
- Tier D — Bid Assembly + Post-Bid Intelligence: COMPLETE
  - Module D1 — Bid Submission Snapshot: COMPLETE
  - Module D2 — Award Outcome Tracking: COMPLETE
  - Module D3 — Post-Bid Analytics Dashboard: COMPLETE
- Operations:
  - Procore CSV Import + isPreferred + DELETE: COMPLETE
  - AI Token Config (per-call max_tokens UI with cost estimates): COMPLETE
  - Editable Due Date: COMPLETE
  - Light/Dark Theme Toggle (full app dark mode coverage): COMPLETE

## What Is Queued
- Module INT1 — Job Intake (Wing 1)
- Module RFQ1 — RFQ Email Distribution via Resend
- Tier E — Post-Award Handoff Layer (H1-H8)
- Tier F — Procore Integration Bridge (F1-F3)
- UI Nav Refactor — sidebar with phase groupings, post-award shift
- Full roadmap: docs/architecture/ROADMAP.md
- Authoritative status: docs/architecture/CURRENT_STATE.md and ROADMAP.md
