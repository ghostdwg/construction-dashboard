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

### Pursuit + Core (bid-dashboard origin)
- Tiers 1–3: COMPLETE
- Module 2b — Subcontractor Intelligence Layer: COMPLETE
- Module 5b — Estimate Sanitization: COMPLETE
- Modules 6a-6c — Estimate Intake, Leveling Engine, Questions + Export: COMPLETE
- Module 14 — Document Intelligence: COMPLETE
- Modules 15/15a/15b — AI Review, Bid Intelligence Brief, Per-Trade Gap Analysis: COMPLETE
- Module GNG1 — Go/No-Go Gate Widget: COMPLETE
- Module 16a — Addendum Delta Processing: COMPLETE
- Tier A — AI Layer + Core Data Model: COMPLETE
- Tier B — Procurement Intelligence (P1–P4): COMPLETE
- Tier C — Estimate Intelligence (C1–C3): COMPLETE
- Tier D — Bid Assembly + Post-Bid Intelligence (D1–D3): COMPLETE
- Module RFQ1 — RFQ Email Distribution: COMPLETE
- Module INT1 — Job Intake (14-field project context capture): COMPLETE
- Operations: Procore CSV Import, AI Token Config, Editable Due Date, Dark Mode: COMPLETE

### Post-Award Handoff (Tier E) — ALL COMPLETE
- Module H1 — Handoff Packet (8-sheet XLSX, Handoff tab): COMPLETE
- Module H2 — Buyout Tracker (7-stage contract lifecycle, financial rollup): COMPLETE
- Module H3 — Submittal Register (SubmittalItem, lifecycle, Procore CSV export): COMPLETE
- Module H4 — Schedule Seed (CSI sequence, FS chain, MSP CSV export): COMPLETE
- Module H5 — Owner-Facing Estimate (trade-level XLSX with GC markup): COMPLETE
- Module H6 — Budget Creation (GC overhead lines, budget XLSX): COMPLETE
- Module H7 — Contact Handoff (Outlook CSV, Google CSV, vCard): COMPLETE
- Module H8 — Award Notifications (sub award + internal team emails): COMPLETE

### Procore Bridge (Tier F)
- Tier F F1 — Procore Import Package (vendor, budget, contact, submittal CSVs + Procore tab): COMPLETE
- Tier F F2–F5: NOT STARTED

### Infrastructure
- Auth Wall Level A (email/password login, JWT sessions, route protection): COMPLETE
- UI Nav Refactor (two-level sidebar, Pursuit/Post-Award groupings): COMPLETE

### Phase 5 — Construction Intelligence (construction-dashboard)
- Phase 5A — Python Sidecar + AI Spec Intelligence (FastAPI sidecar, spec parsing, per-section analysis): COMPLETE
- Phase 5B — Spec Splitting, CSI MasterFormat, Submittal Generation from Specs: COMPLETE
  - CsiMasterformat model, spec PDF splitter, SpecSection.csiCanonicalTitle, SubmittalItem.source
  - generateFromAiAnalysis.ts — AI-driven submittal register generation
- Phase 5C — Schedule Builder (ScheduleV2, 9-phase CPM template, full dependency engine, Gantt UI): COMPLETE
- Phase 5D — Meeting Intelligence Pipeline (transcription, diarization, Claude analysis, action items): COMPLETE
- Phase 5E — Superintendent Briefing (auto-assembled PDF field report): COMPLETE
- Phase 5G-1 — Spec Section Auto-Linkage (SubmittalItem.specSectionId, source field): COMPLETE
- Phase 5G-2 — Schedule-Tied Due Dates (leadTime/reviewBuffer/submitByDate backward math): COMPLETE
- Phase 5G-3 — Templated Distribution Lists (SubmittalDistributionTemplate, routing panel): COMPLETE
- Phase 5G-3.5 — Submittal Packages (SubmittalPackage model, package-grouped register): COMPLETE
- Phase 5G-3.6 — Bulk-Edit Grid UI (package-grouped Submittals tab with inline editing): COMPLETE
- Phase 5H (near-term) — Warranty Register (spec-derived, read-only, from aiExtractions): COMPLETE

## What Is Queued
- Phase 5F — Drawing OCR + Quantity Takeoff (STRETCH — requires GPU hardware)
- Phase 5G-4 — Submittal Workflow Templates (DEFERRED)
- Phase 5H continuation — Closeout Intelligence (ASPIRATIONAL — needs inbound submittal data)
- Tier F F2–F5 — Procore REST API, sync, schedule push
- Full roadmap: docs/architecture/ROADMAP.md
