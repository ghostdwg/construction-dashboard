# Capability Matrix — 2026-07-07

**Anchor:** worktree `/opt/neuroglitch/worktrees/gwx-fable-handoff`, HEAD `2d207672e6b89a155e8426d3d2abbc91673352f2` (branch `gwx/fable-final-architecture-handoff`).

**Method:** read-only code inspection (Prisma schema, API routes, services, UI components, test files) plus the Ledger's staging-proven list (`docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §1). Repo docs (`ROADMAP.md`, `CURRENT_STATE.md`, `SYSTEM_BRIEF.md`) were treated as claims to verify, not evidence — the Ledger flags them as stale. No tests were run; no live systems were touched.

**Tag legend:** `[V]` = verified in source at this SHA (file:line cited). `[OP]` = operator-verified live evidence recorded in the Ledger §1 (not re-verifiable from code alone). `[INF]` = inference from verified facts. `[UNK]` = unknown/unverified.

**Bucket rules used in the rollup:** VERIFIED-WORKING requires code + tests + presence on the Ledger §1 staging-proven list. Anything whose value depends on AI output quality is at best IMPLEMENTED-UNPROVEN — zero real-document provider validation has occurred (the Ledger's single controlled call proved the credential path only; real-AI validation, Q03.3/GWX-Q16-class, is PENDING). Nothing in this document is or implies evidence of human approval.

**Cross-cutting auth fact (applies to every section):** this Next.js version's middleware is `proxy.ts` (not `middleware.ts`). It session-gates ALL routes except a short public list (`/login`, `/api/auth/*`, `/api/health`, `/metrics`, `/api/jobs/run-due`, `/api/procore/webhook`) — `proxy.ts:42-68`, matcher `:84-88` `[V]`; the unauthenticated→`/login` redirect is staging-proven `[OP]` (Ledger §1). However, `AUTH_DISABLED=true` bypasses everything (`proxy.ts:44`) `[V]`, and — outside the admin settings routes — there are **no per-route role checks**: any authenticated user (`estimator`/`pm`) can trigger paid AI calls, Procore pushes, and job mutations `[V]` (roles defined `lib/auth.ts:9`; `isAdminAuthorized()` `lib/auth.ts:84-99` used only by settings/admin routes).

---

## 1. H3 — Submittal Register / Seeder

**Evidence locations `[V]`**
- Models: `SubmittalItem` `prisma/schema.prisma:776` (`specSectionId` :780, `source` :797 default `"manual"`, six known values documented inline :788-796 — `manual | regex_seed | ai_extraction | csi_baseline | ai_organized | drawing_analysis`; `sourceJobId` :824, schedule-tie fields :828-835); `SubmittalPackage` :720; `SubmittalDistributionTemplate` :850; module header comment :707-709.
- Services: `lib/services/submittal/seedSubmittalRegister.ts` (regex seeder, block-finder ~:113, classifier ~:97; stamps `source="regex_seed"` on every created row since WP1a `c51f28b`); `generateFromAiAnalysis.ts` (consumes stored `SpecSection.aiExtractions`, wipes prior auto items ~:155); `csiBaselineSeeder.ts`; `organizeWithAi.ts` (live Claude via gateway, call ~:408); `submittalService.ts` (bid-scope guard from commit `f34746a` in `createSubmittal`/`updateSubmittal`; `updateSubmittal` promotes an edited auto row to `source="manual"` since WP1a, protecting corrected rows from a later wipe without touching wipe logic itself); `provenanceLabels.ts` (pure origin→label mapping for the WP1b display badge, explicit fallback for any unmapped value, never a quality/verification claim).
- Routes: `app/api/bids/[id]/submittals/{seed,generate-from-specs,generate-ai,organize-ai,export,packages,distribution-templates}/route.ts`. `packages/route.ts` additionally selects/emits `source` since WP1b `0ce2604`.
- UI: `app/bids/[id]/SubmittalsTab.tsx` (rendered `page.tsx:336-339`); buttons "Generate from AI" :476-483, "AI Organize" :500-508; provenance badge in the packages-grid title cell since WP1b (origin only — "Manual"/"Regex seed"/"AI extract"/"CSI baseline"/"AI organized"/"Drawing" — never implies review/approval/quality).
- Tests: `lib/services/submittal/__tests__/{submittalService,organizeWithAi,seedSubmittalRegister,generateFromAiAnalysis,provenanceLabels}.test.ts`, `app/api/bids/[id]/submittals/generate-ai/__tests__/route.test.ts`, `packages/__tests__/route.test.ts`, `__tests__/submittalBoilerplate.test.ts`.

**User-facing workflow `[V]`** — Reachable: `/bids/[id]?tab=submittals` → "Generate from AI" (enabled only when analyzed sections exist, `SubmittalsTab.tsx:749`) → optional "AI Organize" → "Export Procore CSV". The pure regex seeder (`POST .../submittals/seed`) has **no UI button** — API-only; the UI fallback path is `seedCsiBaseline`, not the regex seeder.

**Input/Output `[V]`** — Regex seed: `SpecSection.rawText` in → `SubmittalItem` rows (numbered `{csiNumber}-{seq}`, `specSectionId` set, responsible sub auto-linked from accepted RFQs, `source="regex_seed"`). Generate-from-specs: stored `aiExtractions` JSON in → items + auto packages. Generate-ai Phase 2: drawing `analysisJson` + section list → sidecar → items with `source="drawing_analysis"`, `specSectionId=null`. Organize-ai: existing items → Claude → replacement trade-packaged register (`source="ai_organized"`).

**Source/provenance** — Section-level FK provenance for regex/spec paths (`specSectionId`) and job attribution (`sourceJobId`) `[V]`. Gaps: drawing-derived items are uncited (`specSectionId=null`) `[V]`; organized items lose section linkage in Claude consolidation `[INF]`; no page/offset citations anywhere `[V]` — no page-anchored citation link exists yet (deferred follow-on to WP1b, not yet built). **Fixed (WP1a, `c51f28b`):** the regex seeder previously left `source` at default `"manual"` instead of `"regex_seed"`, so `generateFromAiAnalysis`'s wipe of `regex_seed` items missed them; the seeder now stamps correctly, and `updateSubmittal` promotes a user-edited auto row to `"manual"` so a real correction is still protected from a later wipe. **Displayed (WP1b, `0ce2604`):** the now-trustworthy `source` value renders as a display-only provenance badge in the packages grid — origin only, never a claim that the row's content is correct or reviewed.

**Safety/cost `[V]`** — `seedSubmittalRegister`/`generateSubmittalsFromAiAnalysis`/`seedCsiBaseline`: deterministic, no provider call. `organize-ai`: live Claude via sanctioned gateway (`organizeWithAi.ts:13`), model `claude-sonnet-4-6`, usage logged with `audit:{feature:"submittal-organize"}`; throws if `ANTHROPIC_API_KEY` unset. `generate-ai` Phase 2: sidecar hop (`SIDECAR_URL`), missing key → non-fatal skip (silently swallowed). Session required (proxy.ts); no role check on any submittal route. WP1a/WP1b introduced zero provider calls, zero Procore changes, zero migrations — both are local code + display only.

**Missing before real project use** — AI-organized register items untraceable to spec pages for dispute defense `[INF]` (page-anchored citation link remains a deferred WP1 follow-on); sidecar Phase-2 failures silent (register looks complete when cross-ref never ran) `[V]`; the prior provenance-tag bug is fixed (above) but AI output quality itself remains unproven — real-AI validation (Q03.3/GWX-Q16-class) is still PENDING, not executable, and a passing local suite never upgrades that; regex heuristics have no confidence signal on poor OCR `[INF]`; zero live validation of any AI-assisted path `[V]`+Ledger §1.

---

## 2. H4 — Schedule Seed (legacy + Schedule V2 / CPM)

**Evidence locations `[V]`**
- Models: `ScheduleActivity` `prisma/schema.prisma:914` (legacy, FS-only); `Schedule` :948; `ScheduleActivityV2` :972 (provenance fields `aiGenerated` :997, `aiConfidence` :998, `layerSource` :999 — no `specSectionId` FK); `ScheduleDependency` :1014 (FS/SS/FF/SF + lag); `ScheduleVersion` :1030.
- Services: `lib/services/schedule/scheduleService.ts` (`seedScheduleActivities` :150 — deterministic CSI-ordered FS chain + milestones); `scheduleV2Service.ts` (`seedScheduleV2` :599 — fixed 9-phase GC template + long-lead procurement rows); `durationDefaults.ts`.
- Routes: `app/api/bids/[id]/schedule/{seed,recalculate,export}/route.ts`; `schedule-v2/{seed,activities,generate}/route.ts`; `procore-push/schedule/route.ts`.
- UI: `app/bids/[id]/ScheduleTab.tsx` ("Seed from Trades" :126, Export :162); full editor `/bids/[id]/schedule` → `ScheduleGrid.tsx:25,495` → `ScheduleIntelligencePanel` ("Build Skeleton" :141-142, "Run Intelligence" :154-160).
- Tests: `app/api/bids/[id]/schedule-v2/generate/__tests__/route.test.ts`, `__tests__/schedule.test.ts`.

**User-facing workflow `[V]`** — Reachable both ways: bid tab "schedule" → Seed from Trades (deterministic legacy H4); full editor → Build Skeleton (deterministic V2) → optional "Run Intelligence" (paid AI, model selector sonnet/opus46/opus47).

**Input/Output `[V]`** — Legacy seed: `BidTrade` list → `ScheduleActivity` rows + milestones, working-day date walk, writes `Bid.projectDurationDays`. V2 seed: spec-book divisions (or BidTrades fallback) → `ScheduleActivityV2` skeleton + `ScheduleDependency` chain. V2 generate: `SpecSection.aiExtractions` + drawing analysis → sidecar → activity overrides/procurement/new activities, then CPM recalculate; GET surfaces `cost_usd`/tokens.

**Source/provenance** — **Weak for AI edits:** `applyAiResults` in `schedule-v2/generate/route.ts` writes only `name/duration/notes/csiCode` and **never sets `aiGenerated`/`aiConfidence`/`layerSource`** `[V]` — AI-modified rows are indistinguishable from manual edits in the DB. No spec-section linkage on any activity `[V]`. Deterministic seeds' provenance is the template itself (not stored per-row).

**Safety/cost `[V]`** — Both seeders fully deterministic, no provider call. `schedule-v2/generate`: sidecar hop with `api_key` forwarded from `getSetting("ANTHROPIC_API_KEY")` (does NOT use the in-process TS gateway — the sidecar's Python gateway makes the Claude call); **fails closed** — missing key → 503. Cost preview via GET metadata mode. Session required; no role check.

**Missing before real project use** — AI schedule edits leave no audit trail while feeding `SubmittalItem.submitByDate` back-math `[V]`/`[INF]`; two parallel schedule models (legacy + V2) can be seeded independently for the same bid with no reconciliation `[V]`; template durations are not project-calibrated `[INF]`; AI intelligence unavailable without sidecar + key; zero live validation of the AI path `[V]`.

---

## 3. 15a — Bid Intelligence Brief

**Important disambiguation `[V]`:** three distinct AI flows exist, and repo docs conflate them. (1) **Brief** = `POST /api/bids/[id]/intelligence` → `BidIntelligenceBrief`. (2) **Per-trade gap analysis** (§4) = `POST /api/bids/[id]/gap-analysis/generate` → `AiGapFinding`. (3) **Bid-level review** = `POST /api/bids/[id]/intelligence/generate` (`assembleReviewPrompt.ts`) → also `AiGapFinding` — this flow (3), not the Brief, is the one real Anthropic call ever made on staging `[OP]` Ledger §1.

**Evidence locations `[V]`**
- Model: `BidIntelligenceBrief` `prisma/schema.prisma:673-690` (`whatIsThisJob`, `howItGetsBuilt`, `riskFlags`, `assumptionsToResolve`, `addendumSummary`, `sourceContext`, `isStale`, `triggeredBy`; `bidId @unique` :675).
- Service: `lib/services/ai/generateBidIntelligenceBrief.ts` (main :212, live path :238-379, stub :54-145, truncated-JSON repair :10-40). Prompt: `assembleBriefPrompt.ts:18-264`. Trigger: `lib/services/jobs/briefRefreshAutomation.ts:44-130`.
- Routes: `app/api/bids/[id]/intelligence/route.ts` (GET :9, POST :28).
- UI: `app/bids/[id]/IntelligenceBrief.tsx:108` under "Glint Intelligence" on the overview tab (`page.tsx:259-265`); Generate :240-246 / Regenerate :467-473.
- Tests: `lib/services/ai/__tests__/generateBidIntelligenceBrief.test.ts` (gateway fidelity :57, shadow-scan metadata :72, JSON repair :82) — plumbing only, no output-quality tests.

**User-facing workflow `[V]`** — Reachable: bid overview tab → Generate/Regenerate brief. Also auto-fires on spec-book upload via `triggerBriefRefresh` (`specbook/upload/route.ts:338`) — but only when the admin Document AI Enrichment setting is ON (default OFF, §7).

**Input/Output `[V]`** — In: project name + trade names, intake scalars, **full Division-1 `rawText`** (`assembleBriefPrompt.ts:124-135`), other sections' numbers/titles only, drawing disciplines, addendum text. Out: structured JSON parsed into the model's columns + `sourceContext` (document counts, generatedFrom).

**Source/provenance** — **Uncited-by-construction.** `foundIn`/`sourceRef` strings are model-authored free text (schema instructions :186-197), never validated against real `SpecSection` rows; the stub even fabricates plausible refs (:76); UI renders them verbatim (`IntelligenceBrief.tsx:389,418`) `[V]`. `sourceContext` stores counts, not per-claim provenance.

**Safety/cost `[V]`** — Live path only via sanctioned gateway (`createMessage` :266 with `audit:{feature:"brief"}`); `BRIEF_STUB_MODE` writes `status:"stub"` AiUsageLog rows (:224-231) + UI stub badge; ok/error logging with bounded failure classes (:276-294); per-call token ceiling DB-overridable (`aiTokenConfig.ts:49-65`, typicalInput ~30k). No spend cap `[INF]`. Prompt verified free of `pricingData`/`rawPriceText`/sub names/`isPreferred` `[V]` (grep of `assemble*.ts` = zero hits; estimates aren't selected at all). Session required; any role can trigger a paid call.

**Missing before real project use** — Zero real-document quality validation (Q03.3/GWX-Q16 PENDING) `[V]`; unverifiable citations; no aggregate spend controls; single-brief-per-bid (`bidId @unique`) means regeneration overwrites with no history `[V]`/`[INF]`.

---

## 4. 15b — Per-Trade Gap Analysis

**Evidence locations `[V]`**
- Model: `AiGapFinding` `prisma/schema.prisma:405-423` (`tradeName`, `findingText`, `sourceRef`, `confidence`, `severity`, `sourceDocument`, `status @default("pending_review")`, `reviewNotes`, relation to `GeneratedQuestion`).
- Route+service: `app/api/bids/[id]/gap-analysis/generate/route.ts` (`runGapAnalysis` :240, live loop :284-367, save :200-236, stub :21-171, POST :371); read route `gap-analysis/route.ts:8`. Prompt: `lib/services/ai/assembleGapPrompt.ts:14-204`.
- Review API: `app/api/findings/[id]/route.ts:1-29` (PATCH; statuses `pending_review|approved|dismissed|converted_to_question` :3).
- UI: `app/bids/[id]/AiReviewTab.tsx:224` ("Run Analysis" :352-358) on the `ai-review` tab labeled "INTELLIGENCE" (`tabConfig.ts:27`).
- Tests: `gap-analysis/generate/__tests__/route.test.ts` (gateway fidelity :68, per-trade JSON-skip :84) — plumbing only.

**User-facing workflow `[V]`** — Reachable: bid → INTELLIGENCE tab → Run Analysis (optional per-trade filter); findings grouped by trade with severity badges; "Add to Questions" per finding (`AiReviewTab.tsx:75-84`). The approve/dismiss review workflow exists in API+schema but is **not wired into this UI** `[V]`/`[INF]`.

**Input/Output `[V]`** — In, per trade: project fields, trade CSI, matched sections' `rawText` truncated to 400 chars (:116), the Brief as context (:44-51), and **only** `subToken`+`sanitizedText` from estimates gated `approvedForAi:true` (:54-67). Out: `AiGapFinding` rows per trade (prior bid+trade rows deleted first :207).

**Source/provenance `[V]`** — Same weakness as the Brief: `sourceRef` is model-authored free text stored raw (:226) with no validation; enum `sourceDocument` only; no page numbers or FK linkage. Decorative citations.

**Safety/cost `[V]`** — Live via gateway (:313) but **passes no `audit` metadata** → shadow-scan feature label defaults to `"unknown"` (`gateway.ts:143`); `GAP_STUB_MODE` writes `status:"stub"` rows (:273-280); missing key → 503 (:382-390). **Highest-cost flow: one call per trade, ~25 calls/bid** (`aiTokenConfig.ts:66-82`), no aggregate cap. Sub-confidentiality verified excluded by construction; shadow prompt-scanner (`promptScan.ts:49,65-71`) is detect-only telemetry — never blocks/redacts (P2-A0, shadow-only). Session required; any role can trigger ~25 paid calls.

**Missing before real project use** — Zero output-quality validation `[V]`; unverified citations; review FSM not surfaced in UI; **table collision:** flow (3) `intelligence/generate/route.ts:86-105` deletes/recreates `AiGapFinding` for the whole bid while gap-analysis deletes per bid+trade — running both wipes/duplicates each other's rows `[V]`.

---

## 5. Document Storage / Spec Splitting (SpecBook / SpecSection)

**Evidence locations `[V]`**
- Models: `SpecBook` `prisma/schema.prisma:579-589`; `SpecSection` :591-620 — provenance fields `pageStart`/`pageEnd`/`pageCount` :609-611, `pdfPath`/`pdfFileName` :606-608, `aiExtractions` :603, cascade delete :618.
- Upload: `app/api/bids/[id]/specbook/upload/route.ts` — BlobStore write with canonical relative key `plan-room/jobs/{bidId}/spec/original.pdf` :253-257, sidecar parse first (`/parse/specs`, PyMuPDF4LLM) :108 with in-process `pdfjs-dist` fallback :116-132, SpecBook row :264.
- Split: `app/api/bids/[id]/specbook/split/route.ts` — sidecar `/parse/specs/split` :57; writes `pdfPath`+`pageStart` etc. :10,138.
- Serve: `app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts` — reads via `readStoragePathBuffer(section.pdfPath, bidId)` :37, 404 when `pdfPath` null :29.
- Storage layer: `lib/services/specbook/storagePath.ts` (4-shape classifier, bid-scoped legacy root); `lib/services/storage/legacyPathCompat.ts` (domain factory for drawings/estimates/addendums/meetings); deliberate two-module split is a Ledger §4.6 decision — do not unify.
- Tests: `lib/services/specbook/__tests__/{storagePath,fileAvailability,sourceSectionLink}.test.ts`; `app/api/bids/[id]/specbook/upload/__tests__/{route,storageSmoke}.test.ts`; `split/__tests__/`. Smoke harness: `scripts/specbook-staging-smoke.mjs` (1021 lines).

**User-facing workflow `[V]`** — Reachable: bid Documents tab → upload spec PDF → sidecar parse into sections → split into per-section PDFs → view/download section PDF. Unauthenticated section-PDF request redirects to `/login` (`proxy.ts:63-68`; staging-proven `[OP]`).

**Input/Output `[V]`** — PDF in → `SpecBook` row + section rows (`csiNumber`, `csiTitle`, `rawText`, canonical title enrichment) → per-section PDF blobs with page-range provenance. `aiExtractions` populated only by the separate paid analyze lane (`specbook/analyze`), which downstream registers (submittals, closeout etc.) render from — they stay empty until a real analyze pass runs (Ledger §1 UNPROVEN list).

**Source/provenance `[V]`** — **Strongest in the app:** every split section stores its 1-indexed page range in the original book (:609-611), and split is deterministic (PyMuPDF/pdf-lib mechanics, not AI).

**Safety/cost `[V]`** — Splitting/parsing deterministic; provider calls enter only via (a) the analyze lane and (b) post-upload fire-and-forget enrichment (`generateBidIntelligence`, `triggerBriefRefresh` — upload route :331-338), gated by: storage-smoke suppression (highest priority) → `DOCUMENT_AUTOMATION_HARD_DISABLED` lock → admin setting `documentAutomationEnabled` → **default OFF**; settings-lookup failure fails closed to `disabled` (ADR 0003; `lib/services/settings/documentAutomation.ts:53,79-91`).

**Staging-proven vs unit-tested `[OP]`/`[V]`** — The FULL Spec Book storage lifecycle (upload → sidecar parse → split → serve section PDF → delete → re-upload → cleanup) is the ONLY Ledger-recorded staging-proven lifecycle: 13/13 smoke steps, automation suppressed (Ledger §1, Q03-era image). Drawings/estimates/addendums/meetings durable writes are code + unit-tested only in canonical terms — NOT staging-proven and not equivalent to the Spec Book proof. (A Q03.1-style drawings/addendums smoke was locally observed against image `471a73f`; its only traces are non-durable local notes in `/tmp` which do not change Ledger status — canonical proof awaits a Ledger/Queue-approved evidence record.) No lifecycle has been proven on the current `2d20767` image. Meetings durability-read is unprovable safely today (read path triggers sidecar re-transcription; Ledger §1). No audio-availability probe exists at this SHA (grep = zero) — that work lives on the unmerged release-hardening branch.

**Missing before real project use** — Non-specbook lifecycles staging-unproven `[V]`; production DB rows still hold absolute paths, normalization backfill never run anywhere (Ledger §1 BLOCKED); `aiExtractions` quality unvalidated, so every downstream register is empty or unproven `[V]`.

---

## 6. Procore Export / Push

**Evidence locations `[V]`**
- Models: `Bid.procoreProjectId` `prisma/schema.prisma:132`; `Subcontractor.procoreVendorId @unique` :280; `ProcorePush` :1243; `RfiItem` :1265 (`procoreRfiId` :1268); `ProcoreWebhookEvent` :1365.
- Client: `lib/services/procore/client.ts` — creds via `getSetting()` (`PROCORE_CLIENT_ID/SECRET/COMPANY_ID`) :64-69, throws "not configured" :76-81 (fail-closed); OAuth client-credentials :88-124; **hardcoded** `https://api.procore.com` :14, no sandbox/stub/mock.
- Push: `pushService.ts` — vendors :90 (writes back `procoreVendorId` :165-174), contacts :195, submittals :258 (dedup by title :324), budget :368 (cost-code matching :393-407). Pull/sync: `syncService.ts` — RFIs :69, submittal statuses :131, webhook mark-processed :196. Schedule: `scheduleService.ts:37-49` (MSP-XML multipart to import API).
- Routes: `app/api/procore/{test,projects,webhook,webhook/register}/route.ts`; `app/api/bids/[id]/procore-push/{vendors,contacts,submittals,budget,schedule,status}`; `procore-pull/{rfis,submittals}`; `procore-project` (link). Offline CSV exports (F1): `app/api/bids/[id]/procore-export/*` — zero Procore imports, pure DB→CSV `[V]`.
- Webhook fail-closed: `app/api/procore/webhook/route.ts:32-39` — 503 if `PROCORE_WEBHOOK_SECRET` unset, 401 on mismatch.
- UI: `app/bids/[id]/ProcoreTab.tsx` (1266 lines — link/search :153-185, push cards :358-410, schedule :522-538, sync :675, webhook panel :851-884); `app/settings/ProcoreSettingsCard.tsx` (creds entry + Test Connection :47).
- Tests: **none for client/push/pull/schedule/webhook** `[V]`; only `scripts/tests/test-parseProcoreCsv.mjs` (inbound CSV import parser).

**User-facing workflow `[V]`** — Reachable end-to-end in UI: Settings → Procore card (enter creds, Test Connection) → bid Procore tab → link project → push vendors/contacts/submittals/budget/schedule, pull RFIs/statuses, register webhook.

**Input/Output `[V]`** — Out: vendor records, people, submittals (title/spec_section/type), budget line items, MSP-XML schedule. Back/stored: Procore vendor IDs, RFIs → `RfiItem`, statuses → `SubmittalItem.status`, events → `ProcoreWebhookEvent`, per-push counts → `ProcorePush`.

**Source/provenance `[V]`** — Push history rows (`ProcorePush`: created/updated/skipped/errors JSON) give operational provenance; ID write-backs give entity linkage. Deterministic mapping, no AI.

**Safety/cost `[V]`/`[INF]`** — Fail-closed without creds; inbound webhook fail-closed without secret. But: hardcoded production host with no dry-run gate — once creds are entered, any authenticated user's POST immediately writes live data into the Procore tenant (session-gated by proxy.ts, `/api/procore/webhook` deliberately public with secret auth; **no role check** on push routes). Response-shape assumptions (title dedup, cost-code matching, status mapping) coded to docs, never tested against a real tenant `[INF]`.

**Missing before real project use** — Never exercised against a live tenant, no creds seeded anywhere `[V]` (Ledger §1: "Procore F1–F4 needs real Procore credentials"); zero automated tests on the entire live bridge `[V]`; no role gating or confirmation step on writes `[V]`; fragile matching assumptions unvalidated `[INF]`.

---

## 7. Admin Controls, Audit Trail, Background-Job Evidence

**Document AI Enrichment setting (ADR 0003, Q03.2b) `[V]`**
- ADR artifact: `docs/architecture/adr/0003-document-ai-enrichment-admin-control.md` (records an operator decision dated 2026-07-07; the ADR is the approval artifact — nothing in this matrix is itself approval evidence).
- Gate: `lib/services/settings/documentAutomation.ts` — key `documentAutomationEnabled` :30; only literal `"true"` enables :53; fresh DB read per event (deliberately not cached `getSetting()`) :21-26; lookup failure fails closed to `"disabled"` :84-90; `DOCUMENT_AUTOMATION_HARD_DISABLED` lock :34-36 checked before DB :80, can only force OFF.
- Admin API: `app/api/settings/document-automation/route.ts` — GET :46 / PATCH :59 both `isAdminAuthorized()`-gated :47,60; PATCH audits `document_automation_toggle` category `operator_override` :91-108.
- Admin UI: `app/settings/DocumentAutomationCard.tsx` (AI Configuration tab, `app/settings/page.tsx:123-124`); honest OFF-state notices `app/bids/[id]/DocumentsTab.tsx:1400-1684`.
- Consumers: `specbook/upload/route.ts:331`, `drawings/upload/route.ts:279,358`, `addendums/[addendumId]/route.ts:151` (X-Automation-Status header :58-144).
- Tests: `lib/services/settings/__tests__/documentAutomation.test.ts`, `app/api/settings/document-automation/__tests__/route.test.ts`, storage-smoke route tests on all three consumers.

**AuditEvent `[V]`** — Model `prisma/schema.prisma:3813-3854` (actor/correlation/decision/reasonLog envelope, 10 indexes). Writer `lib/observability/audit.ts` (`emitAuditEvent` :71, create :114; persistence category-gated :108-110 per `lib/observability/taxonomy.ts:163-177`; persistence failure swallowed :139-148). Emitters: runner/dispatcher (`lib/observability/runner.ts:61,81,103`; `lib/runners/dispatcher.ts:78-230`), AI gateway shadow-scan (`gateway.ts:158,187`), automation toggle. **Read surface: exactly one** — the "last change" line on the automation card (`document-automation/route.ts:29`). No audit list UI/API, no retention/pruning — append-only, write-mostly `[V]`.

**BackgroundJob `[V]`** — Model :1301-1357; `dedupeKey` :1318 with `@@unique([dedupeKey, activeSlot])` :1350. Service `lib/services/jobs/backgroundJobService.ts` accepts `dedupeKey` (:31,45) — **but no caller ever passes it** (grep = zero) and the market-scrape creator bypasses the service entirely (`app/api/market-intelligence/sources/[id]/queue-scrape/route.ts:57-64`, direct create, `bidId` and `dedupeKey` both null). Under SQLite NULL-distinct unique semantics (schema comment :1342-1343) **both dedupe guards are inert for market scrapes** — the route's "one active job per source" comment (:54-55) and 409 handler (:76-77) describe protection that never engages. Matches Ledger §1: "column+unique index exist with no writer." Runner: `app/api/jobs/run-due/route.ts` (`WORKER_TOKEN`-gated :143-149, atomic claim :167-170, market_scrape only :156,177). Job routes (`jobs/queue`, `jobs/[id]`, `bids/[id]/jobs`) have no role check (session-only via proxy.ts) `[V]`.

**AiUsageLog + readiness `[V]`/`[OP]`** — Model :1076-1091 (`status` ok|error|stub :1084; `errorMessage` bounded enum only :1085). Writer `lib/services/ai/aiUsageLog.ts` (:103,167; never-throw :118-120; cost at log time :64). Readiness `lib/services/ai/providerReadiness.ts` — 5-state `LiveProviderVerification` :62-67, precedence :117-128, stub rows excluded from "real" evidence :143-147, never live-calls, never exposes credentials. Endpoints admin-gated: `ai-readiness/route.ts:14-18`, `ai-usage/route.ts:9-13`. UI: `app/settings/AiSettingsCard.tsx:147-148,356-419`; per-bid `AiBidUsageCard.tsx`. The `LAST_REAL_SUCCESS` durable evidence from the one controlled staging call is `[OP]` (Ledger §1).

**Auth model `[V]`** — Roles `admin|estimator|pm` (`lib/auth.ts:9`, default `estimator` :60); `isAdminAuthorized()` :84-99 used by settings/admin routes; `app/api/admin/` contains only `users/route.ts` (admin-gated). `AUTH_DISABLED=true` bypasses every gate including the enrichment toggle (`lib/auth.ts:88`, `proxy.ts:44`).

**Missing before real project use** — dedupe writer unwired (duplicate job storms possible) `[V]`; audit trail unreadable by humans beyond one line `[V]`; no retention story for append-only AuditEvent/AiUsageLog `[V]`; `AUTH_DISABLED` bypass must provably be off in any shared deployment `[UNK]` (live env values not inspectable from here); thin tests around backgroundJobService/run-due/queue-scrape `[V]`.

---

## Rollup

| # | Capability | Status | Biggest gap |
|---|---|---|---|
| 1 | H3 Submittal Register / seeder | PARTIAL | Deterministic seeders implemented+unit-tested (local only, never live); AI paths unproven (Q03.3 PENDING); regex seeder correctly stamps `source="regex_seed"` and shows a display-only provenance badge since WP1a/WP1b (`c51f28b`/`0ce2604`) — badge is origin only, not a quality/review claim; still no UI button for the pure regex path; organized items lose spec citations; page-anchored citation link not yet built |
| 2 | H4 Schedule Seed / V2 CPM | PARTIAL | Deterministic seeds + CPM implemented+unit-tested (local only); AI generate path never sets `aiGenerated`/`aiConfidence` — AI edits untraceable |
| 3 | 15a Bid Intelligence Brief | IMPLEMENTED-UNPROVEN | Zero real-document quality validation; citations are model-authored free text, unverifiable |
| 4 | 15b Per-Trade Gap Analysis | IMPLEMENTED-UNPROVEN | Same, at ~25 provider calls/bid with no aggregate spend cap; approve/dismiss review FSM not in UI; `AiGapFinding` table shared with the separate bid-review flow (mutual clobber) |
| 5 | Spec Book storage / splitting | VERIFIED-WORKING (storage only) | The 13/13 staging-proven lifecycle covers storage mechanics with AI suppressed — the only Ledger-proven lifecycle; drawings/estimates/addendums/meetings lifecycles are canonically unproven (code + unit-tests only); the analyze lane (`aiExtractions`) that feeds every downstream register is UNPROVEN |
| 6 | Procore export / push | IMPLEMENTED-UNPROVEN | Never touched a real tenant; zero tests on the live bridge; hardcoded prod host with no dry-run/role gate |
| 7 | Admin / audit / job evidence | PARTIAL | Enrichment gate + AI-usage evidence are solid (code+tests; readiness `[OP]`-evidenced); dedupeKey dedupe inert; audit trail write-only; `AUTH_DISABLED` global bypass |
| 8 | Operations Register spine (OPS1, Slice 1 — added 2026-07-09) | LOCAL-CODE-BUILT (unit-tested; NOT staging-proven) — OPS1 migration applied and code deployed per operator report, see deploy note below | TrackedItem/Comment/Attachment models + human-only FSM + routes + one-at-a-time OAC promote bridge + OPERATIONS tab, built on branch `gwx/slice1-tracked-item-spine-oac-register` (merged to integration @ `d4b7f6c`); attachment byte-serving/preview and all ingestion/seeding slices not built |
| 9 | Field Report ingester V0 (OPS2, Slice 2 — added 2026-07-09) | LOCAL-CODE-BUILT (unit-tested; NOT staging-proven) — OPS2 migration applied and code deployed per operator report, see deploy note below | FieldReport source-document model + private file upload (Slice-1 ordering) + human-triggered FIELD_ITEM creation with report citation, built on branch `gwx/slice2-field-report-ingester` (merged to integration @ `d4b7f6c`); NO OCR/AI extraction (parseStatus always UNPARSED in V0), no preview, no JSO, no warranty/closeout seeding |
| 10 | OPS private file download V0 (added 2026-07-09) | LOCAL-CODE-BUILT (unit-tested; NOT staging-proven; no schema change, no migration) — code deployed per operator report, see deploy note below | Authenticated download routes for tracked-item attachments and field-report source files, built on branch `gwx/ops-private-file-serving-v0` (merged to integration @ `d4b7f6c`) — ids only (server-stored keys, arbitrary keys impossible), tenancy before blob read, attachment disposition + allowlisted Content-Type + nosniff + private/no-store; download-only: NO inline preview, no signed URLs, no public links, no OCR/AI |
| 11 | OPS acceptance UX hardening V1 (added 2026-07-10) | LOCAL-CODE-BUILT (copy-contract tested; NOT staging-proven; no schema change, no migration) — see deploy note below | Discoverability/labeling only, on branch `gwx/ops-acceptance-ux-hardening-v1` (merged to integration @ `d4b7f6c`): Construction nav → `?tab=operations`, Deliver→Tasks cross-link, "Tasks / Operations Register" heading + expand/comments/attachments help + ▸/▾ indicators + first-run walkthrough, Field Reports action labels + directive empty state, Meetings "Promote to Tracked Item" button with honest 409/empty handling; NO new capability, no AI/OCR/thumbnails, no provider/Procore, existing APIs unchanged |
| 12 | OPS operational polish V1 (added 2026-07-10) | LOCAL-CODE-BUILT (unit + copy-contract tested; NOT deployed, NOT staging-proven; no schema change, no migration) | Register workflow polish on branch `gwx/ops-next-operational-polish`: promote-from-meeting PICKER (existing meetings/action-items read endpoints, already-tracked options annotated/disabled as a HINT — server 409 stays the source of truth — manual # fallback kept, honest empty copy), status summary chips + OVERDUE chip/row highlight (terminal statuses never flagged; filtered counts labeled as filtered), field-report count relabeled "N tracked items" with context tooltip; pure view helpers in `registerViewHelpers.ts`, directly unit-tested; NO new endpoints, no AI/OCR, no provider/Procore |

Deploy note (operator-reported, 2026-07-10): staging runs image `groundworx-app:d4b7f6c-ops-ux-hardening` (integration @ `d4b7f6c` = rows 8–11) with OPS1/OPS2 migrations applied and health green — per Josh's report, not independently verified here. No acceptance walkthrough has been recorded, so no row is upgraded past LOCAL-CODE-BUILT/deployed; nothing OPS-related is staging-PROVEN and no `[OP]` lifecycle claim is made.

Statuses per the bucket rules in the intro. Only the Spec Book **storage** lane meets the VERIFIED bar (Ledger §1). Every AI-quality-dependent capability is capped at IMPLEMENTED-UNPROVEN until the human-gated real-provider validation ladder (Q03.3 / GWX-Q16-class) runs.
