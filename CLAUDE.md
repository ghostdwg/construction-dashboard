@AGENTS.md

# Construction Intelligence Platform — Session Guide

---

## CONSTRAINTS

### Never Do
- Return `pricingData` to client or include it in any AI prompt
- Include sub name, company, or `isPreferred` in any AI prompt or sub-facing export
- Build Phase 5 modules in bid-dashboard — they belong in construction-dashboard
- Build Tier F or auth fixes in construction-dashboard without syncing from bid-dashboard first
- Mix planning and build execution in the same Claude Code session
- Recreate `/bids/[id]/leveling` as a standalone page — it is a redirect
- Commit `.claude/settings.local.json`

### Every Session
- One Claude Code session per build step — new session when the step changes
- Commit to GitHub at end of session
- Update `docs/architecture/CURRENT_STATE.md` at end of session
- Update `docs/architecture/ROADMAP.md` when any status changes

---

## CURRENT STATE

**Repo:** `construction-dashboard` — github.com/ghostdwg/construction-dashboard
**Parallel repo:** `bid-dashboard` — github.com/ghostdwg/bid-dashboard (stable, used on live bids)

**Last completed:** Drawing cross-reference for submittal generation (Phase 5G extension) + CLAUDE.md restructure

**System stage:** All planned phases complete. Working in maintenance and targeted refinement mode.

---

## TWO-REPO RULES

| | bid-dashboard | construction-dashboard |
|---|---|---|
| **Purpose** | Stable preconstruction tool, live bids | Phase 5 construction intelligence expansion |
| **Rule** | Never break what works. Test on real jobs. | Experimental. Break freely. |
| **Receives** | Tier F, auth fixes, bug fixes | Phase 5 modules + all bid-dashboard updates via sync |

**Before starting any Phase 5 session** — pull bid-dashboard into construction-dashboard:
```
git fetch bid-dashboard main && git merge bid-dashboard/main --no-edit
```
Full sync protocol: `docs/architecture/ROADMAP.md` → Two-Repo Strategy

---

## WHAT'S IN PLAY

### Queued
| Item | Repo | Priority |
|------|------|----------|
| Tier F — F5: Daily Log weather claim integration | bid-dashboard | NOT STARTED |
| Auth B+C — Per-user isolation + RBAC | bid-dashboard | DEFERRED (needs real second user) |
| Production Readiness — Postgres migration, HTTPS, deploy | both | DEFERRED (pre-deploy) |
| Phase 5F — Drawing OCR + Quantity Takeoff | construction-dashboard | STRETCH (GPU hardware required) |
| Phase 5G-4 — Submittal Workflow Templates | construction-dashboard | DEFERRED |

### Minor Enhancements
Pick up opportunistically when already touching the relevant module — don't build sessions around them.

- H2: Auto-populate `originalBidAmount` from leveling data
- H2: PO issuance to sub via email (reuses RFQ1 infra)
- H3: Submittal attachments / file uploads
- H3: Review round tracking
- SET1: Per-bid cost ledger view (currently global only)
- SET1: Budget alerts ("spent $X, set a cap?")
- SET1: Real Anthropic tokenizer (replace chars/4 estimate)

---

## REFERENCE ARCHIVE

### ID Glossary
Three naming systems appear across historical docs — all refer to features in this codebase:

| System | Examples | Used For |
|--------|---------|---------|
| **Module IDs** | INT1, H1–H8, GNG1, RFQ1, P1–P4 | Pursuit + post-award feature modules |
| **Tier labels** | Tier A – Tier F | Capability layers (A=AI core, B=procurement, C=estimate, D=assembly, E=handoff, F=Procore) |
| **Phase 5 sub-phases** | 5A – 5H, 5G-1 – 5G-4 | Construction intelligence expansion (construction-dashboard only) |

### Completed — Pursuit + Core (bid-dashboard origin)
Tiers 1–3 (core schema, UI, nav), Tier A (AI/data model), Tier B (procurement P1–P4), Tier C (estimate C1–C3), Tier D (bid assembly + post-bid D1–D3). Modules: 2b (sub intelligence), 5b (estimate sanitization), 6a-6c (estimate intake + leveling + questions), 14 (document intelligence), 15/15a/15b (AI review, bid brief, per-trade gap analysis), GNG1 (go/no-go gate), 16a (addendum delta), RFQ1 (RFQ email distribution), INT1 (14-field job intake). Infrastructure: Procore CSV import, AI token config, dark mode, Auth Wall A, UI nav refactor.

### Completed — Post-Award Handoff (Tier E)
H1 (handoff packet, 8-sheet XLSX), H2 (buyout tracker, 7-stage lifecycle, financial rollup), H3 (submittal register, Procore CSV export), H4 (schedule seed, CSI sequence, MSP CSV), H5 (owner-facing estimate, trade-level XLSX), H6 (budget creation, GC overhead lines), H7 (contact handoff — Outlook/Google/vCard), H8 (award notifications — sub + internal emails).

### Completed — Procore Bridge (Tier F)
F1 (CSV/XLSX export package — vendor, budget, submittal, contact), F2 (REST API — OAuth 2.0, vendor/contact/budget/submittal push), F3 (bidirectional sync — RFI pull, submittal status sync, webhook receiver), F4 (schedule push — MSP XML 2007 generator, Procore schedule import API). F5 (Daily Log weather claims) not started.

### Completed — Phase 5 Construction Intelligence
5A (Python FastAPI sidecar at :8001, spec parsing via PyMuPDF4LLM, per-section AI analysis), 5B (spec splitting, CSI MasterFormat model, `SubmittalItem.source`, `generateFromAiAnalysis.ts`), 5C (ScheduleV2, 9-phase CPM template, full dependency engine, Gantt UI, MSP CSV export), 5D (meeting intelligence — transcription, diarization, Claude analysis, action items), 5E (superintendent briefing — auto-assembled PDF field report via WeasyPrint), 5G-1 (`SubmittalItem.specSectionId` auto-linkage), 5G-2 (schedule-tied due dates, backward math from install activity), 5G-3 (distribution templates, routing panel), 5G-3.5 (SubmittalPackage model, package-grouped register), 5G-3.6 (bulk-edit grid UI with inline editing), 5H near-term (warranty, training, inspections, and closeout registers from `aiExtractions`). Drawing cross-reference for submittal generation (drawing `analysisJson` → sidecar → `source: "drawing_analysis"` items).

Full detail on any module or phase: `docs/architecture/ROADMAP.md`
