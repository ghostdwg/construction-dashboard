# Pain-Management Roadmap — GC Preconstruction/PM Tool

- **Status:** Draft for operator review. Nothing in this document authorizes
  execution; every work package below requires future human (operator)
  approval before it runs, per the GroundWorX gate model
  (`docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §6).
- **Evidence base:** repo at `2d207672e6b89a155e8426d3d2abbc91673352f2`
  (worktree `gwx-fable-handoff`). Claims tagged `[V]` (source-verified, with
  file:line), `[INF]` (inference from verified source), `[UNK]` (unknown /
  unproven).
- **Shared spine:** this roadmap assumes the RequirementCandidate/citation
  spine described in `docs/architecture/SPEC-INTELLIGENCE-PIPELINE.md`
  (being authored in parallel; not present at this SHA `[V]` — file absent).
  Where an item says "spine," it means that document's requirement/evidence
  model. This roadmap references the spine; it does not redefine it.
- **AI-output-quality caveat (applies globally):** no real-provider
  validation of any document-AI output has occurred on the current line.
  Q03.3 (provider validation) is PENDING
  (`docs/release/FABLE-FINAL-OPERATIONAL-HANDOFF.md:42`, §4 `[V]`). Every
  statement below about extraction quality is therefore `[UNK]` until Q03.3
  executes. "Exists" means code + unit tests exist, not "proven live."
- **Honesty rules honored here:** no dollar figures, no timeline promises,
  no approval claims. ADR 0003 is cited as an existing recorded decision
  (`docs/architecture/adr/0003-document-ai-enrichment-admin-control.md`
  `[V]`), not as approval for anything in this document.

---

## Part 1 — Ten problem areas, evaluated against the repo

### 1. AI-assisted submittal extraction with source citations + trade routing

- **User pain solved:** manually combing a spec book to build the submittal
  register, then re-deriving who is responsible and who reviews each item.
- **Expected operational value:** the register is the backbone of post-award
  execution; missed submittals cascade into schedule slips. Auto-seeding with
  verifiable provenance removes the highest-tedium precon task.
- **What already exists `[V]`:**
  - Models: `SubmittalItem` (prisma/schema.prisma:776) with provenance
    `source` ("manual" | "regex_seed" | "ai_extraction", :789),
    `specSectionId` FK (:780), audit `sourceJobId` → `BackgroundJob` (:816);
    `SubmittalPackage` (:720); `SubmittalDistributionTemplate` per-trade
    routing (reviewers/distribution JSON, :850); `CsiMasterformat` reference
    (:767).
  - Services: `lib/services/submittal/generateFromAiAnalysis.ts` (reads
    `SpecSection.aiExtractions`, idempotent, filters generic boilerplate),
    `organizeWithAi.ts`, `csiBaselineSeeder.ts`, `seedSubmittalRegister.ts`.
  - Routes: `app/api/bids/[id]/submittals/` — `route.ts`, `generate-ai`
    (two-phase: local spec pass + sidecar drawing cross-reference job),
    `generate-from-specs`, `organize-ai`, `packages`, `seed`,
    `distribution-templates`, `export`.
  - UI: `app/bids/[id]/SubmittalsTab.tsx`; portfolio view
    `app/submittals/page.tsx`; "View source section" wired via
    `lib/services/specbook/sourceSectionLink.ts` `[V]` (per
    `docs/architecture/specbook-source-evidence-gaps.md`).
- **Gap:** citations are **section-level only** — `SubmittalItem.specSectionId`
  is the sole forward FK from an AI-derived item into `SpecSection`
  (`docs/architecture/specbook-source-evidence-gaps.md` `[V]`). `SpecSection`
  carries `pdfPath`/`pageStart`/`pageEnd` (:611–:614 area `[V]`), so
  page-anchored evidence display is possible without new extraction. No
  paragraph-level citation exists. Extraction quality: `[UNK]` until Q03.3.
- **Spine dependency:** high — this is the spine's flagship consumer; the
  RequirementCandidate model should subsume "AI said this section requires X."
- **AI / deterministic / manual split:** AI proposes items (draft rows with
  `source:"ai_extraction"`); deterministic: CSI matching, idempotent
  dedupe, boilerplate filter, backward date math; manual: acceptance/edit of
  every row, routing template edits.
- **Source of truth + approval:** spec text is truth; `SubmittalItem` rows
  are operator-owned once edited. AI writes are draft-first, attributed via
  `sourceJobId`; human review is the promotion step.
- **Data/API/UI impact:** all core surfaces exist `[V]`; delta is evidence
  display (page-anchored deep link) + provenance badges — no new models
  required for the first slice.
- **Failure modes & guardrails:** hallucinated requirements (mitigate:
  citation-required display, draft status, Q03.3 validation before quality
  claims); silent overwrite of manual edits (existing wipe is scoped to
  AI-source rows only, generateFromAiAnalysis.ts:145–149 `[V]`); provider
  cost (admin-gated per ADR 0003; automation default OFF `[V]`).
- **Priority: NOW** — the vertical slice is code-complete enough that
  hardening citations + provenance is the cheapest high-value move (WP1).

### 2. Long-lead / procurement / owner-selection deadline tracking

- **User pain solved:** long-lead buys discovered too late; owner finish/
  allowance selections with no tracked decision date stall procurement.
- **Expected operational value:** converts "we forgot to order the switchgear"
  into a dated, visible countdown.
- **What already exists `[V]`:** `BidTrade.tier` (default TIER2,
  prisma/schema.prisma:200) + `leadTimeDays` (:201) + RFQ timestamps;
  `lib/services/procurement/classifyTradeTier.ts` (rule-based, no AI) and
  `calculateTimeline.ts` (pure date math); routes
  `app/api/bids/[id]/procurement/{summary,timeline,orchestrate}`;
  `BuyoutItem` contract lifecycle (:222); `BuyoutTracker.tsx`.
- **Gap:** owner-selection tracking is **absent**. The `selections` route is
  `BidInviteSelection` (sub bid invites, :317 + route `[V]`) — not owner
  selections. No model carries "owner must select X by date Y."
  `BidDecision` (:1214) has `madeAt`/`status` but **no `dueDate`** `[V]`.
- **Spine dependency:** medium — owner-selection candidates ("Owner to
  select from manufacturer's full range") are extractable via the spine, but
  the deadline register itself is deterministic.
- **Split:** AI (later, spine): propose selection items from spec text.
  Deterministic: countdowns, tier suggestions, timeline math. Manual: dates,
  decisions, tier overrides.
- **Source of truth + approval:** operator-entered dates are truth; AI only
  proposes candidates, never sets deadlines.
- **Data/API/UI impact:** additive `dueDate` (+ decision categories) on
  `BidDecision`, or a small new selection-item model; surface in
  `procurement/timeline` response and `TradesTab.tsx`/`DecisionLogTab.tsx`
  `[V]` existing tabs.
- **Failure modes & guardrails:** date math drifting from reality (keep the
  pure-function idiom of `calculateTimeline.ts` with unit tests); double
  registers (extend `BidDecision`, don't fork a parallel decision store).
- **Priority: NEXT** — engine exists; the missing owner-selection register is
  a small additive change (WP4) sequenced after the NOW hardening work.

### 3. Schedule-linked submittal & procurement gates

- **User pain solved:** submittal due dates disconnected from the schedule;
  no early warning that an activity will start before its material can exist.
- **Expected operational value:** backward-derived submit-by dates and
  at-risk flags are the difference between precon paperwork and actual
  schedule protection.
- **What already exists `[V]`:** `SubmittalItem.linkedActivityId` +
  documented backward math `submitByDate = activity.start − leadTimeDays −
  reviewBufferDays − resubmitBufferDays` (prisma/schema.prisma:819–:825,
  review buffer default 21d per AIA A201 §4.2.7 comment :822);
  `SubmittalPackage.riskStatus` NONE|AT_RISK|BLOCKED (:743) and
  `readyForExport` (:744); orchestrator route
  `app/api/bids/[id]/procurement/orchestrate/route.ts` (auto-link by
  CSI/trade, working-day math, dry-run mode `[V]`); full CPM-ish schedule
  layer `Schedule`/`ScheduleActivityV2`/`ScheduleDependency`/
  `ScheduleVersion` (:948–:1043) with `requiresInspection` flag (:987).
- **Gap:** linkage is one-directional (schedule → dates). Nothing surfaces
  "these activities are jeopardized by unapproved submittals / unbought
  trades" on the schedule side, and nothing recomputes on schedule change
  `[INF]` (no recompute trigger found in schedule routes).
- **Spine dependency:** low — deterministic date math over existing rows.
- **Split:** deterministic entirely (derived risk view). AI: none required.
  Manual: linking overrides, buffer edits.
- **Source of truth + approval:** schedule dates are truth; risk flags are
  derived and recomputable, never hand-edited state.
- **Data/API/UI impact:** extend orchestrate output + a derived
  "gated activities" read endpoint; chips in `ScheduleTab.tsx` and
  `SubmittalsTab.tsx` `[V]` existing tabs. Likely zero migration.
- **Failure modes & guardrails:** stale derived dates after schedule edits
  (recompute-on-read or explicit re-orchestrate; never persist as if
  authoritative); false BLOCKED noise (keep `riskWindowDays` operator-tunable
  as orchestrate already does `[V]`).
- **Priority: NEXT** — high leverage, near-zero schema risk, builds directly
  on shipped Phase 5G-2/5G-3.5 code (WP5).

### 4. Scope reconciliation: spec vs drawings vs bid scope/exclusions

- **User pain solved:** scope gaps between spec sections, drawing scope, and
  what subs actually included/excluded — the classic buyout-day surprise.
- **Expected operational value:** catching one uncovered scope item per bid
  typically pays for the feature; it is the estimator's core anxiety.
- **What already exists `[V]`:** `ScopeItem` with `inclusion`, `specSection`,
  `drawingRef`, `riskFlag`, `restricted` (prisma/schema.prisma:348–:358) +
  `ScopeTradeAssignment` (:367); `AiGapFinding` with `sourceRef`,
  `confidence`, `severity`, `status:"pending_review"` (:405–:418) fed by
  `lib/services/ai/assembleGapPrompt.ts` and
  `app/api/bids/[id]/gap-analysis/`; `SpecSection.covered` flag (:600 area);
  drawing layer `DrawingUpload`/`DrawingSheet` (:626, :692) with module doc
  `docs/architecture/14b_drawing_intelligence_module.md`; leveling
  (`LevelingSession`/`LevelingRow` :547–:558, `LevelingTab.tsx`) for
  sub-quote comparison; the submittal drawing cross-reference job already
  compares covered CSI sections against drawing scope
  (`app/api/bids/[id]/submittals/generate-ai/route.ts` header `[V]`).
- **Gap:** the three sources are never reconciled in one view; gap findings
  are AI-narrative, not joined to `ScopeItem`/`SpecSection` rows by FK
  (`AiGapFinding.sourceRef` is a free string `[V]` :412). No per-sub
  exclusion-vs-spec diff.
- **Spine dependency:** **high** — this is exactly what a
  RequirementCandidate/citation spine exists for; do not build a bespoke
  reconciliation join before the spine lands.
- **Split:** AI: propose gap candidates (already the pattern). Deterministic:
  coverage matrix (section ↔ trade ↔ scope item joins). Manual: dispositioning
  every finding (existing `pending_review` workflow `[V]`).
- **Source of truth + approval:** contract documents are truth; findings are
  candidates until an operator accepts/rejects (existing status field).
- **Data/API/UI impact:** new derived reconciliation endpoint + view on
  `ScopeTab.tsx`; later, FK-ify finding→section via the spine (additive).
- **Failure modes & guardrails:** confidently-wrong AI gap claims (citation
  required, quality `[UNK]` until Q03.3); sub-pricing leakage into prompts —
  prohibited (`pricingData`/`rawPriceText`/sub names never in prompts, repo
  rule; leveling data stays out of any AI path).
- **Priority: NEXT** — deterministic coverage matrix first (WP6), full
  citation-grade reconciliation only after the spine.

### 5. Testing/inspections & "do not cover" field gates

- **User pain solved:** required special/AHJ inspections discovered from a
  failed cover-up; QC requirements buried in Division 01 and section Part 3.
- **Expected operational value:** an inspection register per bid; eventually
  hold-point awareness in the schedule.
- **What already exists `[V]`:** derived read-only inspections register —
  `app/api/bids/[id]/inspections/route.ts` flattens
  `SpecSection.aiExtractions.inspections[]` ("No new DB model … Read-only",
  header comment `[V]`); `InspectionsTab.tsx`;
  `ScheduleActivityV2.requiresInspection` (prisma/schema.prisma:987);
  hold-points exist only as a comment
  (`lib/services/schedule/scheduleV2Service.ts:446` `[V]`).
- **Gap:** register is ephemeral (recomputed from JSON, no status, no
  scheduling linkage). No "do not cover" workflow, no field-gate enforcement
  anywhere `[V]` (grep for hold-point/do-not-cover found only that comment).
- **Spine dependency:** high for persistence (inspection rows should be spine
  requirement candidates); enforcement is schedule-side and deterministic.
- **Split:** AI: extraction (exists, quality `[UNK]`). Deterministic:
  linking register rows to `requiresInspection` activities. Manual:
  scheduling, passing/failing, any hold decision — always human.
- **Source of truth + approval:** the AHJ/spec is truth; the tool records,
  never certifies. A software "gate" must never claim an inspection passed.
- **Data/API/UI impact:** persistence = spine-backed register rows (WP2);
  enforcement = LATER, and only ever advisory (badges on activities), not
  blocking writes.
- **Failure modes & guardrails:** the tool implying inspection compliance
  (never claim enforcement — same claim-discipline family as the P2-A0
  shadow-only rule); missed extraction treated as "no inspections required"
  (register must state it is AI-derived and non-exhaustive).
- **Priority: NEXT (persist the register, inside WP2) / LATER (advisory
  do-not-cover surfacing) / DO-NOT-BUILD (blocking field-gate enforcement)** —
  a solo-GC tool has no field-crew users to gate; enforcement theater would
  create liability-shaped claims the Ledger's claim discipline forbids.

### 6. Warranty, training, O&M, attic-stock, closeout tracking

- **User pain solved:** closeout requirements (extended warranties, owner
  training, O&M manuals, attic stock) surface at month 11 instead of day 1.
- **Expected operational value:** these registers already read out of spec
  intelligence; persisting them turns a report into a tracker.
- **What already exists `[V]`:** derived read-only registers, all built on
  `SpecSection.aiExtractions` (:606) with explicit "No new DB model"
  headers: `app/api/bids/[id]/warranties/route.ts` (Phase 5H),
  `training/route.ts` (5H-2), `closeout/route.ts` (5H-4, includes
  `quantity` — attic-stock-shaped `[INF]`); tabs `WarrantiesTab.tsx`,
  `TrainingTab.tsx`, `CloseoutTab.tsx` in the CONSTRUCTION tab group
  (`app/bids/[id]/tabConfig.ts:43–:47 `[V]`). O&M and CERT/LEED extractions
  are deliberately excluded from the submittal register and reserved "so
  Closeout module can pick them up"
  (`lib/services/submittal/generateFromAiAnalysis.ts:33–:37` `[V]`).
- **Gap:** zero persistence — no status, no responsible party, no dates, no
  completion state. Recomputed on every GET; edits impossible.
  `docs/architecture/specbook-source-evidence-gaps.md` explicitly lists
  these as "no safe relationship exists yet" `[V]`.
- **Spine dependency:** **highest of all ten** — these registers are the
  canonical RequirementCandidate consumers; persist them as spine rows, not
  as four bespoke tables.
- **Split:** AI: extraction (exists; `[UNK]` quality). Deterministic:
  flatten/normalize (exists). Manual: status transitions, assignments.
- **Source of truth + approval:** spec text is truth for the requirement;
  operator-owned rows are truth for tracking state after promotion.
- **Data/API/UI impact:** one additive spine-aligned table (or per the spine
  doc's model) + PATCH endpoints; tabs upgrade from read-only lists to
  editable registers. Migration: additive-only, via
  `scripts/apply-turso-migrations.mjs`, human-gated.
- **Failure modes & guardrails:** re-analysis clobbering tracked state
  (promotion copies data out of the JSON; re-derive only draft candidates —
  same pattern generateFromAiAnalysis already uses for submittals `[V]`);
  treating the register as exhaustive (label AI-derived, non-exhaustive).
- **Priority: NEXT** — first spine consumer after submittals; WP2.

### 7. RFI/ASI/bulletin change-impact & decision-deadline tracking

- **User pain solved:** addenda/ASIs change scope mid-bid; decisions with
  expiry (accept/quote/rebid) have no tracked deadline; RFIs live in Procore
  only.
- **Expected operational value:** one register of "open changes and the
  decisions they demand, each with a date."
- **What already exists `[V]`:** `AddendumUpload` with `extractedText`,
  `deltaJson`, `summary` (prisma/schema.prisma:651–:663) and an AI delta
  pipeline (`lib/services/ai/assembleAddendumDeltaPrompt.ts`,
  `app/api/bids/[id]/addendums/[addendumId]/delta/route.ts`); `RfiItem`
  pulled from Procore with `dueDate` (:1265, :1276) via
  `lib/services/procore/syncService.ts` `pullRfis`; `BidDecision` register
  (:1214) + `DecisionLogTab.tsx`; `GeneratedQuestion` has `sourceRef` and
  `dueDate` (:443–:444).
- **Gap:** no ASI/bulletin concept post-award (AddendumUpload is bid-phase
  `[INF]` from its bid-centric shape); `BidDecision` lacks `dueDate` `[V]`;
  addendum deltas don't create decision/scope tasks — the impact analysis is
  narrative, unlinked.
- **Spine dependency:** medium — deltas should eventually emit requirement
  candidates; the decision-deadline register itself is deterministic.
- **Split:** AI: delta summarization (exists; quality `[UNK]`).
  Deterministic: deadline countdowns, register joins. Manual: every decision
  and its date.
- **Source of truth + approval:** the issued document is truth; AI deltas are
  advisory drafts; decisions are operator-only writes.
- **Data/API/UI impact:** additive `dueDate` (+ optional `sourceKind`/
  `sourceId`) on `BidDecision`; a combined "open changes" read across
  addendum deltas, RFIs, decisions; surfaced in `DecisionLogTab.tsx` and the
  briefing. Migration: additive-only, gated runner.
- **Failure modes & guardrails:** AI delta missing a change (never present
  the delta as complete; link to source pages); duplicate registers (extend
  `BidDecision`, reuse `RfiItem` — don't mint a third change table).
- **Priority: NEXT** — small additive schema, big anxiety relief; WP7.

### 8. Superintendent day-one + weekly field briefing

- **User pain solved:** the super starts with tribal knowledge instead of a
  packet; weekly "what matters this week" is re-assembled by hand.
- **Expected operational value:** day-one packet already implemented; weekly
  variant reuses the same assembly.
- **What already exists `[V]`:** Phase 5E Superintendent Initial Assessment —
  `app/api/bids/[id]/briefing/route.ts` (assembles risk flags, inspections,
  warranties, training, closeout, long-lead submittals, schedule lookahead
  with a `lookaheadDays` parameter, open action items; renders PDF via
  sidecar POST) + `BriefingTab.tsx`; internal Handoff packet
  (`lib/services/handoff/assembleHandoffPacket.ts`, H1/H2, with explicit
  sub-confidentiality header: packet is internal, "NEVER sent to AI" `[V]`)
  + `HandoffTab.tsx` and `app/api/bids/[id]/handoff/export`.
- **Gap:** no recurring/weekly variant; briefing content is only as alive as
  the underlying registers, which are unpersisted (items 5/6) and schedule
  progress fields (`percentComplete`, `actualStart` :998 area) that a solo
  precon-phase user is not yet updating `[INF]`.
- **Spine dependency:** indirect — quality follows the persisted registers.
- **Split:** deterministic assembly (existing pattern); AI: none required
  (the brief aggregates; it need not generate prose). Manual: as-of date,
  lookahead window (existing UI controls `[V]`).
- **Source of truth + approval:** the packet is a derived artifact; it must
  carry its as-of date and provenance labels, never masquerade as live.
- **Data/API/UI impact:** none for day-one (exists); weekly = parameterized
  re-run + persisted-register deltas. No migration.
- **Failure modes & guardrails:** stale-data brief presented as current
  (stamp as-of + data-freshness per section); sub pricing/names in any
  AI-rendered path (sidecar PDF render must remain layout-only `[INF]` —
  verify before extending).
- **Priority: NOW = keep/verify day-one (already built) · LATER = weekly
  variant** — weekly only pays off once registers persist and schedule
  status is actually updated (WP8, last).

### 9. Closeout readiness / deficiency burn-down

- **User pain solved:** "are we actually done?" — closeout deliverables and
  punch items tracked to zero.
- **Expected operational value:** real, but it is the last phase of a
  project lifecycle this tool's user hasn't reached with live data `[INF]`.
- **What already exists `[V]`:** derived closeout checklist (item 6);
  `SubmittalPackage.releasePhase` includes "Closeout" (:747 comment area);
  CERT/LEED extractions parked for a "future module"
  (generateFromAiAnalysis.ts:33 `[V]`). No deficiency/punch model exists
  anywhere in `prisma/schema.prisma` `[V]` (model list reviewed).
- **Gap:** everything stateful: readiness scoring, deficiency items,
  burn-down. Depends on item 6 persistence.
- **Spine dependency:** high via item 6 (readiness = spine rows with
  status); punch items are field observations, outside the spine.
- **Split:** deterministic: readiness = count of persisted closeout rows by
  status. Manual: deficiency entry and closure. AI: none needed initially.
- **Source of truth + approval:** operator marks completion; the tool never
  infers "done."
- **Data/API/UI impact:** readiness rollup on `CloseoutTab.tsx` after WP2; a
  punch-item model is a LATER additive migration.
- **Failure modes & guardrails:** declaring readiness from AI-derived,
  non-exhaustive lists (readiness must display its denominator's provenance).
- **Priority: LATER** — blocked by WP2 and by real project phase; a
  burn-down over unpersisted derived rows would be fiction.

### 10. Procore export/import sequencing WITHOUT premature bidirectional sync

- **User pain solved:** re-keying precon data into Procore; conversely, the
  fear of a background sync silently mutating either system.
- **Expected operational value:** keep the awarded-bid → Procore handoff
  one-directional and explicit; prevent sync drift before there is any
  operational need for it.
- **What already exists `[V]`:** substantial — and already **more** than
  one-way in code: CSV/readiness export
  (`app/api/bids/[id]/procore-export/route.ts` — readiness summary for
  vendors/budget/contacts); REST push with history
  (`ProcorePush` :1243, pushTypes vendors|contacts|submittals|budget,
  `lib/services/procore/pushService.ts`, `app/api/bids/[id]/procore-push/`);
  pull (`syncService.ts` header: "bidirectional … pullRfis,
  syncSubmittalStatuses" `[V]`); webhook receiver
  `app/api/procore/webhook/route.ts` — **ingest-only**: secret-checked,
  fails closed without a configured secret, stores `ProcoreWebhookEvent`
  (:1365) and `processWebhookEvent` only marks it processed
  (syncService.ts:196–:216 `[V]` — no data mutation); `ProcoreTab.tsx`;
  `SubmittalPackage.readyForExport` gate flag (:744).
- **Gap:** the safe posture (explicit push, explicit pull, webhook =
  inbox-only) exists by implementation but is **nowhere stated as policy**
  `[V]` (no doc found asserting it); nothing stops a future card from
  "finishing" `processWebhookEvent` into auto-apply.
- **Spine dependency:** none.
- **Split:** deterministic entirely. AI: none — keep AI out of the sync
  boundary permanently.
- **Source of truth + approval:** this tool is truth for precon data until
  push; Procore is truth for RFIs/submittal statuses after pull; every
  cross-system write is an explicit operator click, recorded
  (`ProcorePush` history rows `[V]`).
- **Data/API/UI impact:** no new models. A policy doc + regression tests
  pinning: webhook handler never writes domain tables; pull never fires
  except from an explicit route call; push routes remain per-type, explicit.
- **Failure modes & guardrails:** silent auto-apply (test-pinned
  prohibition); duplicate pushes (existing `@@unique([bidId, procoreRfiId])`
  :1284 and skip counts `[V]`); credential handling is human-owned
  (secrets rule — key names only, never values).
- **Priority: NOW (codify + pin the one-way posture) · DO-NOT-BUILD
  (webhook auto-apply / continuous two-way sync)** — the code is one
  refactor away from premature bidirectionality; lock the door now (WP3).

---

## Priority verdict summary

| # | Area | Verdict |
|---|------|---------|
| 1 | Submittal extraction + citations + routing | **NOW** — vertical slice exists; harden citations/provenance (WP1) |
| 2 | Long-lead / procurement / owner-selection deadlines | **NEXT** — engine exists; owner-selection register is small + additive (WP4) |
| 3 | Schedule-linked submittal/procurement gates | **NEXT** — backward math shipped; add derived risk surfacing, no enforcement (WP5) |
| 4 | Scope reconciliation (spec/drawings/scope) | **NEXT** — deterministic coverage matrix first; citation-grade recon waits for the spine (WP6) |
| 5 | Inspections + do-not-cover gates | **NEXT** (persist register, in WP2) / **LATER** (advisory surfacing) / **DO-NOT-BUILD** (blocking enforcement) |
| 6 | Warranty/training/O&M/attic-stock/closeout registers | **NEXT** — persist existing derived registers on the spine (WP2) |
| 7 | RFI/ASI change-impact + decision deadlines | **NEXT** — additive `dueDate` + unified open-changes view (WP7) |
| 8 | Superintendent day-one + weekly briefing | **NOW** = keep/verify day-one (built); **LATER** = weekly variant (WP8) |
| 9 | Closeout readiness / deficiency burn-down | **LATER** — blocked by WP2 persistence and project phase |
| 10 | Procore sequencing w/o premature bidirectional sync | **NOW** — codify + test-pin the existing one-way posture; **DO-NOT-BUILD** auto-apply sync (WP3) |

---

## Part 2 — Work packages (WP1–WP8, dependency-ordered)

Shared constraints (apply to every WP; restated once):

- **Migrations:** additive-only, forward-only, applied ONLY via
  `scripts/apply-turso-migrations.mjs`, never auto-run, never on model
  authority — human-gated per `.claude/rules/migrations-checkpoints.md`.
- **Provider/cost policy:** all document-AI automation is admin-gated,
  default OFF, per ADR 0003
  (`docs/architecture/adr/0003-document-ai-enrichment-admin-control.md`
  `[V]`). All AI writes are draft-first. Local work uses stub modes. Any
  real provider call — including validating extraction quality — requires
  operator approval per invocation; **budget is an operator decision, never
  model-invented**. AI quality claims stay `[UNK]` until Q03.3.
- **Test idiom:** vitest with fully mocked Prisma via
  `vi.hoisted` + `vi.mock("@/lib/prisma", …)` — the convention documented in
  `lib/services/submittal/__tests__/submittalService.test.ts` header `[V]`.
  Never a real `DATABASE_URL`.
- **Rollout (every WP):** local branch + unit tests → reviewed candidate
  commit on the GroundWorX line → ships only in a future human-gated staging
  image (Q03-class build/pin/deploy) → staging verification is
  operator-executed. Nothing here schedules or authorizes those gates.

### WP1 — Submittal evidence & citation hardening (vertical slice)

- **Objective / user outcome:** every AI-derived submittal row shows *where
  it came from* — provenance badge (`source`, `sourceJobId`) and a
  page-anchored link into the split section PDF — so the operator can trust
  or reject each row in seconds. Code evidence supports this as WP1: models,
  generation services, routes, tab, and section-link plumbing all exist
  `[V]` (Part 1 §1).
- **Scope:** provenance badges in `SubmittalsTab.tsx` and
  `app/submittals/page.tsx`; extend `sourceSectionLink.ts` consumers to
  carry `pdfPath`/`pageStart`/`pageEnd` for page-anchored viewing; honest
  empty/unavailable states (reuse `lib/services/specbook/fileAvailability.ts`
  pattern `[V]`); unit tests for link assembly and provenance mapping.
- **Exclusions:** no paragraph-level citation, no new extraction prompts, no
  RequirementCandidate table (spine's job), no provider calls, no schema
  change, no changes to generation/wipe semantics.
- **Files/models/routes:** `app/bids/[id]/SubmittalsTab.tsx`,
  `app/submittals/page.tsx`, `lib/services/specbook/sourceSectionLink.ts`,
  `app/api/bids/[id]/submittals/route.ts` + `packages/route.ts` (read-shape
  only). Models: `SubmittalItem`, `SpecSection` (read-only).
- **Migration:** none.
- **Test plan:** mocked-Prisma unit tests for the enriched link payload
  (section present / section deleted (`SetNull`) / pdf missing / pages
  null); snapshot of provenance label mapping for all `source` values.
- **Provider/cost:** zero provider calls.
- **Acceptance:** every register row displays its provenance; AI rows with a
  live section link open the section PDF at its page range; rows with no
  evidence say so explicitly; `npx vitest run lib/services/specbook
  lib/services/submittal` green.
- **Dependencies:** none. First.
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP1 submittal citation/provenance hardening.
  Anchor: git rev-parse HEAD must equal the SHA named in your card; record it.
  Allowed files: app/bids/[id]/SubmittalsTab.tsx, app/submittals/page.tsx,
  lib/services/specbook/sourceSectionLink.ts (+ its __tests__),
  app/api/bids/[id]/submittals/route.ts, app/api/bids/[id]/submittals/packages/route.ts.
  Task: surface SubmittalItem.source/sourceJobId as provenance badges and
  extend the existing source-section link payload with pdfPath/pageStart/pageEnd
  so the UI can deep-link the split section PDF. Honest states when evidence
  is missing (follow lib/services/specbook/fileAvailability.ts).
  Forbidden: schema changes, migrations, new AI prompts or provider calls,
  editing generateFromAiAnalysis.ts wipe semantics, Docker/HTTP/DB, touching
  any file outside the allowed list.
  Stop condition: if the change appears to require a schema column or a
  provider call, STOP and report.
  Verify: npx vitest run lib/services/specbook lib/services/submittal
  (report exact commands + summary lines). Commit with trailer
  Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>.
  ```

### WP2 — Persisted requirement registers on the spine (warranty / training / inspections / closeout)

- **Objective / user outcome:** the four derived read-only registers become
  editable, trackable rows (status, assignee, dates) without losing their
  link back to the source spec section — closing the biggest gap named in
  `docs/architecture/specbook-source-evidence-gaps.md` `[V]`.
- **Scope:** one additive table (or exactly the model the spine doc
  specifies — defer naming to `SPEC-INTELLIGENCE-PIPELINE.md`) holding
  promoted requirement rows with `specSectionId`, kind
  (WARRANTY|TRAINING|INSPECTION|CLOSEOUT), normalized fields, `status`,
  `source`, `sourceJobId`; promotion endpoint that copies candidates out of
  `SpecSection.aiExtractions`; PATCH endpoints; upgrade the four tabs from
  lists to registers. Re-analysis regenerates *candidates* only — promoted
  rows are never clobbered (mirror generateFromAiAnalysis's scoped-wipe
  pattern `[V]` :145–:149).
- **Exclusions:** no schedule enforcement (item 5 DO-NOT-BUILD), no punch
  list (item 9), no new extraction prompts, no changes to the existing GET
  registers' derivation logic beyond sourcing.
- **Files/models/routes:** `prisma/schema.prisma` (additive);
  `app/api/bids/[id]/{warranties,training,inspections,closeout}/route.ts`;
  new sibling PATCH routes; `app/bids/[id]/{WarrantiesTab,TrainingTab,
  InspectionsTab,CloseoutTab}.tsx`; new `lib/services/` register service
  with `__tests__`.
- **Migration:** one additive migration, gated runner only, applied by a
  human after review — the WP delivers the migration file + preflight notes,
  never applies it.
- **Test plan:** mocked-Prisma tests — promotion idempotency, scoped
  re-derive never touching promoted rows, status transition validation,
  cross-bid `specSectionId` validation (copy the guard tested in
  `submittalService.test.ts` `[V]`).
- **Provider/cost:** zero new provider calls (consumes existing
  `aiExtractions` JSON). Extraction refresh remains behind the ADR 0003
  admin gate.
- **Acceptance:** promote → edit → re-analyze → edits intact; every
  register row links to its section; unpromoted candidates clearly labeled
  AI-derived/non-exhaustive; targeted vitest green.
- **Dependencies:** `SPEC-INTELLIGENCE-PIPELINE.md` merged (model shape);
  WP1 (evidence-display pattern).
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP2 persisted requirement registers.
  Prereq gate: docs/architecture/SPEC-INTELLIGENCE-PIPELINE.md must exist at
  your anchor SHA and define the requirement-row model; if absent, STOP.
  Anchor: git rev-parse HEAD; record it.
  Allowed: prisma/schema.prisma (ADDITIVE model per the spine doc only),
  one new migration folder under prisma/migrations (never applied),
  app/api/bids/[id]/{warranties,training,inspections,closeout}/**,
  app/bids/[id]/{WarrantiesTab,TrainingTab,InspectionsTab,CloseoutTab}.tsx,
  new lib/services/requirements/** (+ __tests__).
  Task: promotion of aiExtractions candidates into persisted rows with
  status/assignee/date fields and specSectionId provenance; PATCH endpoints;
  editable tabs. Re-derivation must never modify promoted rows — mirror the
  scoped-wipe pattern in lib/services/submittal/generateFromAiAnalysis.ts.
  Forbidden: applying migrations, prisma CLI against any real DB, provider
  calls, schedule-side enforcement, renaming/dropping anything, weakening
  the ADR 0003 gate.
  Stop condition: any need for a destructive or non-additive schema change.
  Verify: npx vitest run lib/services/requirements lib/services/submittal;
  report commands + summary lines. Commit with the NeuroGlitch trailer.
  ```

### WP3 — Procore one-way sequencing policy + guardrail tests

- **Objective / user outcome:** the currently-safe posture (explicit push,
  explicit pull, ingest-only webhooks `[V]` syncService.ts:196–:216) becomes
  written policy pinned by regression tests, so no future card drifts into
  premature bidirectional sync.
- **Scope:** a short policy section in `docs/architecture/` (sequencing:
  export-readiness → explicit per-type push → explicit pull; webhook =
  inbox only); unit tests asserting `processWebhookEvent` performs no
  domain-table writes and that pull functions are invoked from explicit
  routes only; surface `readyForExport` (:744) as the stated pre-push
  checklist in `ProcoreTab.tsx` copy.
- **Exclusions:** no new sync features, no webhook auto-apply (permanent
  DO-NOT-BUILD marker), no credential work (human-owned), no changes to
  push/pull behavior.
- **Files/models/routes:** `lib/services/procore/syncService.ts`
  (+ new `__tests__`), `app/api/procore/webhook/route.ts` (tests only),
  `app/bids/[id]/ProcoreTab.tsx` (copy), new doc
  `docs/architecture/procore-sequencing-policy.md`.
- **Migration:** none.
- **Test plan:** mocked-Prisma tests: webhook event create + mark-processed
  writes ONLY `procoreWebhookEvent`; fail-closed secret behavior (503 when
  unset, 401 on mismatch — pin existing behavior `[V]` webhook/route.ts:33–:39).
- **Provider/cost:** none (Procore is not an AI provider; no calls made in
  tests — client fully mocked).
- **Acceptance:** policy doc merged; guardrail tests fail if anyone adds a
  domain write to the webhook path; vitest green.
- **Dependencies:** none — may run parallel to WP1/WP2.
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP3 Procore one-way posture pinning.
  Anchor: git rev-parse HEAD; record it.
  Allowed: lib/services/procore/__tests__/** (new),
  docs/architecture/procore-sequencing-policy.md (new),
  app/bids/[id]/ProcoreTab.tsx (explanatory copy only).
  Task: write the sequencing policy doc (readiness → explicit push →
  explicit pull; webhook ingest-only; auto-apply = DO-NOT-BUILD) grounded in
  current code, and add mocked-Prisma regression tests pinning that
  processWebhookEvent writes only procoreWebhookEvent rows and the webhook
  route fails closed without a configured secret.
  Forbidden: modifying syncService.ts/pushService.ts/client.ts behavior,
  any HTTP call, credentials in any form, new sync features.
  Stop condition: if pinning requires a production-code change, STOP and
  report the exact line instead of changing it.
  Verify: npx vitest run lib/services/procore. Commit with the NeuroGlitch
  trailer.
  ```

### WP4 — Owner-selection & decision-deadline register

- **Objective / user outcome:** owner selections and expiring decisions get
  dated rows with countdowns beside the existing procurement timeline —
  closing item 2's absent half.
- **Scope:** additive `dueDate DateTime?` (+ optional `sourceKind`/`sourceId`
  strings) on `BidDecision` (:1214); accept an OWNER_SELECTION `category`
  value (String field, no enum change needed `[V]` :1217); include open
  dated decisions in `procurement/timeline` output using the
  `calculateTimeline.ts` pure-function idiom; DecisionLogTab deadline UI.
- **Exclusions:** no AI-proposed selection items (LATER, spine), no
  notifications/emails, no changes to tier/lead-time logic.
- **Files/models/routes:** `prisma/schema.prisma` (additive),
  `app/api/bids/[id]/decisions/**`,
  `app/api/bids/[id]/procurement/timeline/route.ts`,
  `lib/services/procurement/` (new pure helper + tests),
  `app/bids/[id]/DecisionLogTab.tsx`, `TradesTab.tsx` (surface chip).
- **Migration:** one additive migration, gated runner, human-applied.
- **Test plan:** pure-function tests for deadline status/urgency (mirror
  `calculateTimeline.ts` shape); mocked-Prisma route tests for filtering
  open dated decisions.
- **Provider/cost:** zero provider calls.
- **Acceptance:** a decision with a due date appears in the procurement
  timeline with correct urgency; undated decisions unaffected; vitest green.
- **Dependencies:** WP1 (pattern), independent of WP2/WP3.
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP4 decision-deadline register.
  Anchor: git rev-parse HEAD; record it.
  Allowed: prisma/schema.prisma (ADDITIVE columns on BidDecision only),
  one new migration folder (never applied), app/api/bids/[id]/decisions/**,
  app/api/bids/[id]/procurement/timeline/route.ts,
  lib/services/procurement/** (+ __tests__),
  app/bids/[id]/DecisionLogTab.tsx, app/bids/[id]/TradesTab.tsx.
  Task: add dueDate (+ sourceKind/sourceId) to BidDecision; support an
  OWNER_SELECTION category value; merge open dated decisions into the
  procurement timeline response via a new pure date-math helper; deadline
  UI in DecisionLogTab.
  Forbidden: applying migrations, enums (keep SQLite-friendly strings),
  provider calls, notification systems, touching calculateTimeline.ts
  existing offsets.
  Stop condition: any non-additive schema need, or ambiguity about timeline
  response shape consumers — report instead of guessing.
  Verify: npx vitest run lib/services/procurement. NeuroGlitch trailer.
  ```

### WP5 — Schedule-linked gate surfacing (advisory, derived)

- **Objective / user outcome:** the operator sees, on the schedule and the
  submittal register, which upcoming activities are jeopardized by
  unapproved submittals or unbought trades — derived, recomputable, never
  blocking.
- **Scope:** a derived read endpoint (or orchestrate extension —
  `app/api/bids/[id]/procurement/orchestrate/route.ts` already computes
  AT_RISK/BLOCKED with `dryRun` and `riskWindowDays` `[V]`) that inverts the
  linkage: per `ScheduleActivityV2`, list linked `SubmittalItem`s whose
  `submitByDate`/status jeopardize `startDate`, plus `BuyoutItem.contractStatus`
  for the activity's trade; risk chips in `ScheduleTab.tsx` and
  `SubmittalsTab.tsx`.
- **Exclusions:** no write-blocking gates, no auto-rescheduling, no CPM
  recalculation changes, no `requiresInspection` enforcement (item 5
  verdict), no migration.
- **Files/models/routes:** `app/api/bids/[id]/procurement/orchestrate/route.ts`
  or new `app/api/bids/[id]/schedule-v2/gates/route.ts`;
  `lib/services/schedule/` pure helper (+ tests); `app/bids/[id]/ScheduleTab.tsx`,
  `SubmittalsTab.tsx`. Models read-only: `ScheduleActivityV2`,
  `SubmittalItem`, `SubmittalPackage`, `BuyoutItem`, `BidTrade`.
- **Migration:** none expected; STOP if one appears needed.
- **Test plan:** pure-function tests for the inversion math (activity with
  late submitByDate → flagged; unlinked activity → not flagged; buyout
  PENDING within window → flagged); mocked-Prisma read tests.
- **Provider/cost:** zero provider calls.
- **Acceptance:** derived gate view matches orchestrate's risk semantics;
  flags disappear when the underlying dates/statuses clear; vitest green.
- **Schedule-provenance sharpening (Addendum 2026-07-08, operator pain:
  "schedules copied from old templates with wrong project names"):** this WP
  must also close the capability-matrix finding that `applyAiResults` never
  writes `ScheduleActivityV2.aiGenerated`/`aiConfidence`/`layerSource` —
  every activity row a seed or AI pass touches must be stamped with its
  provenance so a template-copied or AI-suggested activity is visibly
  distinct from a human-entered one. Additive writes to existing columns
  only; no schema change.
- **Dependencies:** WP1. Complements WP4 (buyout/decision inputs).
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP5 advisory schedule gate surfacing.
  Anchor: git rev-parse HEAD; record it.
  Allowed: app/api/bids/[id]/procurement/orchestrate/route.ts OR a new
  app/api/bids/[id]/schedule-v2/gates/route.ts (choose one, say why),
  lib/services/schedule/** (new pure helper + __tests__),
  app/bids/[id]/ScheduleTab.tsx, app/bids/[id]/SubmittalsTab.tsx.
  Task: derived per-activity risk view from existing linkage
  (SubmittalItem.linkedActivityId/submitByDate/status, SubmittalPackage.riskStatus,
  BuyoutItem.contractStatus via BidTrade). Advisory chips only.
  Forbidden: schema changes/migrations, blocking or write-gating anything,
  modifying backward-date-math semantics, provider calls, claiming
  enforcement anywhere in UI copy (say "at risk", never "blocked from work").
  Stop condition: any need to persist derived risk on activities.
  Verify: npx vitest run lib/services/schedule lib/services/procurement.
  NeuroGlitch trailer.
  ```

### WP6 — Scope reconciliation coverage matrix (deterministic first)

- **Objective / user outcome:** one view answering "which spec sections and
  drawing disciplines have no scope item, no trade, or an exclusion" —
  deterministic joins over existing rows, with AI gap findings attached as
  labeled candidates, not merged as facts.
- **Scope:** derived reconciliation endpoint joining `SpecSection`
  (`covered`, `matchedTradeId`), `ScopeItem` (`inclusion`, `specSection`,
  `drawingRef` — string refs, matched best-effort), `BidTrade`, and
  `DrawingUpload`/`DrawingSheet` presence; render on `ScopeTab.tsx`;
  display `AiGapFinding` rows (status `pending_review` `[V]` :418) alongside
  as candidates with their existing disposition workflow.
- **Exclusions:** no new AI prompts, no FK rewrites of
  `AiGapFinding.sourceRef` (spine's job), no leveling/pricing data anywhere
  near the view's AI-adjacent code paths (sub confidentiality rule), no
  migration.
- **Files/models/routes:** new `app/api/bids/[id]/scope/reconciliation/route.ts`
  (or extend `app/api/bids/[id]/gap-analysis/`), `lib/services/` matrix
  helper (+ tests), `app/bids/[id]/ScopeTab.tsx`.
- **Migration:** none.
- **Test plan:** mocked-Prisma matrix tests — uncovered section detected;
  excluded-scope item surfaces the exclusion; drawing-only discipline with
  no scope row flagged; string-ref matching is conservative (no match ≠
  claim of gap, label as unmatched).
- **Provider/cost:** zero new provider calls; existing gap-analysis
  generation stays admin-gated per ADR 0003 and untouched.
- **Acceptance:** matrix reproduces known fixture gaps deterministically; AI
  findings visually distinct from deterministic gaps; vitest green.
- **Dependencies:** WP2 conceptually (spine alignment), but buildable after
  WP1; citation-grade upgrade deferred to spine adoption.
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP6 deterministic scope coverage matrix.
  Anchor: git rev-parse HEAD; record it.
  Allowed: new app/api/bids/[id]/scope/reconciliation/route.ts,
  lib/services/scope/** (new helper + __tests__), app/bids/[id]/ScopeTab.tsx.
  Task: deterministic joins across SpecSection (covered/matchedTradeId),
  ScopeItem (inclusion/specSection/drawingRef), BidTrade, DrawingUpload/
  DrawingSheet to surface uncovered/unassigned/excluded scope; attach
  existing AiGapFinding rows as clearly-labeled candidates.
  Forbidden: schema changes, new AI prompts or provider calls, touching
  LevelingRow/EstimateUpload/pricingData in any code path, changing
  AiGapFinding workflow semantics.
  Stop condition: if honest matching requires new columns or the spine's
  RequirementCandidate model, STOP and report the specific need.
  Verify: npx vitest run lib/services/scope. NeuroGlitch trailer.
  ```

### WP7 — Unified change-impact & decision-deadline view

- **Objective / user outcome:** one "open changes" register: addendum deltas
  (`AddendumUpload.deltaJson` :660), Procore-pulled RFIs (`RfiItem` :1265),
  and dated decisions (WP4) — each with what it impacts and when a response
  is due.
- **Scope:** derived read endpoint merging the three sources; per-delta
  "create decision" action (writes a `BidDecision` with `sourceKind`/
  `sourceId` from WP4); surface in `DecisionLogTab.tsx` and feed the Phase
  5E briefing's open-commitments section.
- **Exclusions:** no new ASI/bulletin model yet (post-award change docs =
  LATER, needs real usage evidence); no auto-created decisions from AI
  output (operator clicks per item); no Procore RFI writes (pull-only
  posture per WP3); no new provider calls.
- **Files/models/routes:** new `app/api/bids/[id]/changes/route.ts`,
  `lib/services/changes/` (+ tests), `app/bids/[id]/DecisionLogTab.tsx`,
  `app/api/bids/[id]/briefing/route.ts` (consume only).
- **Migration:** none beyond WP4's.
- **Test plan:** mocked-Prisma merge tests (ordering by due date; delta
  without decision shows "no decision recorded"; RFI due dates honored);
  create-decision endpoint validates bid ownership.
- **Provider/cost:** zero new provider calls; addendum delta generation
  remains its existing gated, explicit action.
- **Acceptance:** all three source types render in one dated list;
  decision creation links back to its source; vitest green.
- **Dependencies:** WP4 (dueDate/sourceKind), WP3 (pull-only posture).
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP7 unified open-changes register.
  Anchor: git rev-parse HEAD; record it. Prereq: WP4 columns present in
  schema at your anchor; if absent, STOP.
  Allowed: new app/api/bids/[id]/changes/route.ts, lib/services/changes/**
  (+ __tests__), app/bids/[id]/DecisionLogTab.tsx,
  app/api/bids/[id]/briefing/route.ts (read-integration only).
  Task: merge AddendumUpload deltas, RfiItem rows, and dated BidDecision
  rows into one derived open-changes read model; explicit per-item
  "create decision" write with source linkage.
  Forbidden: new models/migrations, provider calls, Procore writes,
  auto-creating decisions, altering delta generation.
  Stop condition: any temptation to add an ASI/bulletin model — report the
  gap instead.
  Verify: npx vitest run lib/services/changes. NeuroGlitch trailer.
  ```

### WP8 — Weekly field briefing (v2 of Phase 5E)

- **Objective / user outcome:** the shipped day-one superintendent brief
  (`app/api/bids/[id]/briefing/route.ts`, `BriefingTab.tsx` `[V]`) gains a
  repeatable weekly mode: lookahead window + what changed since last brief,
  drawing on persisted registers (WP2), gate flags (WP5), and open changes
  (WP7).
- **Scope:** parameterized weekly assembly reusing the existing section
  builders; per-section data-freshness/as-of labels; delta-since-last-run
  computed from persisted register timestamps; keep sidecar PDF render
  path as-is.
- **Exclusions:** no scheduling/cron/automation (explicit generation only —
  automation would be an ADR-0003-class decision the operator has not
  made); no AI prose generation; no new provider calls; no email sending.
- **Files/models/routes:** `app/api/bids/[id]/briefing/route.ts`,
  `app/bids/[id]/BriefingTab.tsx`, `lib/services/` briefing helpers
  (+ tests). No new models (register timestamps come from WP2 rows).
- **Migration:** none.
- **Test plan:** unit tests for section assembly with mocked Prisma
  (empty registers → honest empty sections; as-of stamping; delta window
  math); no sidecar call in tests (mock the fetch).
- **Provider/cost:** PDF render via existing sidecar path only; zero
  AI-provider calls; any future AI summarization would require a new
  operator decision and card.
- **Acceptance:** weekly brief renders with as-of + freshness labels;
  sections sourced from persisted rows, not recomputed JSON; vitest green.
- **Dependencies:** WP2, WP5, WP7. Last.
- **Agent prompt:**

  ```
  ONE-CARD LOCAL TASK — WP8 weekly field briefing.
  Anchor: git rev-parse HEAD; record it. Prereqs: WP2 register tables and
  WP7 changes endpoint present at anchor; if absent, STOP.
  Allowed: app/api/bids/[id]/briefing/route.ts,
  app/bids/[id]/BriefingTab.tsx, lib/services/briefing/** (new helpers +
  __tests__).
  Task: weekly mode for the Phase 5E brief — lookahead + delta-since-last,
  sourced from persisted registers/gates/changes, with per-section as-of
  and freshness labels. Explicit user-triggered generation only.
  Forbidden: cron/automation of any kind, AI provider calls, email, new
  models/migrations, changing the sidecar render contract, sub names or
  pricing in any AI-bound payload (there must be none).
  Stop condition: any need for background scheduling — that is an operator
  decision, not a code change.
  Verify: npx vitest run lib/services/briefing. NeuroGlitch trailer.
  ```

---

## Dependency graph (summary)

```
WP1 (submittal citations)         — no deps
WP2 (spine registers)             — SPEC-INTELLIGENCE-PIPELINE.md + WP1
WP3 (Procore one-way pinning)     — no deps (parallel-safe)
WP4 (decision deadlines)          — WP1 pattern only
WP5 (schedule gate surfacing)     — WP1
WP6 (scope coverage matrix)       — WP1 (spine upgrade later via WP2)
WP7 (open-changes register)       — WP4 + WP3
WP8 (weekly briefing)             — WP2 + WP5 + WP7
```

Every WP: local-only build → review → human-gated staging image → operator
verification. No WP is authorized by this document.

---

## Addendum 2026-07-08 — reconciliation with the operator pain-point note

Provenance: Josh provided a product-vision note describing the construction
pain this system should solve. It is treated here as OPERATOR PAIN/CONTEXT
ONLY — it is not evidence that any module is built, and nothing below
upgrades any capability, proof, or approval status (Ledger claim rules,
CAPABILITY-MATRIX-2026-07, and the Q03.3 PENDING / NOT EXECUTABLE governance
record all stand unchanged).

### Item-by-item classification against this roadmap

| Operator pain point | Classification |
|---|---|
| AI-assisted submittal extraction with citations | **Covered well** — item 1 (NOW), WP1 |
| Submittal schedule / lead-time gates | **Covered well** — item 3 (NEXT), WP5 |
| Warranty register | **Covered well** — item 6 (NEXT), WP2 |
| Training register | **Covered well** — item 6 (NEXT), WP2 |
| Closeout checklist | **Covered well** — items 6/9 (NEXT/LATER), WP2 |
| Testing / inspection / do-not-cover gates | **Covered well** — item 5 (split verdict; blocking field enforcement stays DO-NOT-BUILD) |
| Superintendent day-one briefing | **Covered well** — item 8 (day-one built `[V]`, verify; weekly = WP8 LATER) |
| Spec vs drawings vs bid scope/exclusion reconciliation | **Covered well** — item 4 (NEXT), WP6 |
| Owner-selection / long-lead / procurement deadlines | **Covered well** — item 2 (NEXT), WP4 |
| Procore-ready export path | **Covered well** — item 10 (NOW = pin one-way posture, WP3; auto-apply stays DO-NOT-BUILD) |
| Schedules copied from old templates / wrong project names | **Was missing — now sharpened** into WP5 (schedule-provenance stamping; see WP5 addendum note). Root cause matches the capability-matrix finding that AI/seed schedule writes carry zero provenance |
| Estimator→super context handoff as the product frame | **Covered implicitly — now stated explicitly** (below) |

### The organizing frame: the estimator→super context handoff

The note's underlying thesis unifies this roadmap: spec requirements are
read once, by the estimator, at bid time — then buried; the superintendent
inherits the job without that context, and submittals/closeout/testing
obligations resurface as emergencies on live jobs. The shared
requirement/evidence spine (SPEC-INTELLIGENCE-PIPELINE.md) IS the handoff
vehicle: requirements are extracted once with citations, human-reviewed
once, and then ROUTED — to the submittal register, the schedule's gates,
procurement deadlines, field test/inspection lists, and the closeout
registers — so the super starts from reviewed, cited obligations instead of
a 900-page PDF. The superintendent briefing (item 8 / WP8) is a CONSUMER of
that spine, not a separate AI feature.

This is also why **one shared spine precedes five separate AI registers**:
five independent extraction features would each re-parse the spec, each
invent its own provenance/review/waiver semantics, each need its own
provider-cost gate, and none could answer "who is responsible for this
requirement and where did it come from?" consistently. One spine gives one
citation model, one review FSM, one audit trail, one admin-gated provider
policy (ADR 0003) — and every register becomes a cheap view.

### Guardrails restated (binding on every item above)

Every AI extraction is draft-first, carries a verifiable source citation,
and becomes a commitment ONLY through explicit human review/approve/waive.
No extraction may silently create schedule/procurement commitments, send
communications, or mutate project records. AI output quality remains
unproven (no validated real provider call through the admin-gated path;
Q03.3 PENDING). Drawings/Addendums storage-proof status is exactly as stated
in CAPABILITY-MATRIX-2026-07 — unchanged by this addendum. Procore remains
one-way export/ingest-only; nothing here authorizes push or sync.

### Priorities after this review (unchanged in substance, re-affirmed)

- **NOW:** WP1 submittal citation hardening (the H3+ vertical slice — first
  build), WP3 Procore one-way pinning (parallel-safe), verify the existing
  day-one super brief.
- **NEXT:** WP2 spine registers (warranty/training/inspections/closeout),
  WP4 owner-selection/decision deadlines, WP5 schedule gates + provenance
  stamping, WP6 scope coverage matrix, WP7 open-changes register.
- **LATER:** WP8 weekly field briefing, closeout burn-down, citation-grade
  scope reconciliation.
- **DO NOT BUILD:** blocking field-gate enforcement, Procore webhook
  auto-apply/bidirectional sync, auto-send of any communication.
