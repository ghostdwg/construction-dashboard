# Spec Intelligence Pipeline — One Reusable Spine

- Status: PROPOSED (design only — no schema, code, or migration in this doc is
  authorized; every schema change below requires its own explicit queue card
  per `.claude/rules/migrations-checkpoints.md`)
- Date: 2026-07-07
- Anchored inspection SHA: `2d207672e6b89a155e8426d3d2abbc91673352f2` [V]
- Evidence tags: `[V]` = verified in source at the SHA above (file:line),
  `[INF]` = inference from verified facts, `[UNK]` = unknown/unverified.

Target flow this doc architects:

```
Spec Book PDF
  → Spec Sections (split, per-section PDF + page range)          [exists]
  → Candidate Requirements with source citations                 [new spine]
  → Human review: approve / waive / reject                       [new spine]
  → Instantiation into registers & workflow rows                 [bridges to existing]
  → Schedule, procurement, field, closeout, Procore-ready export [mostly exists]
```

The point of this document: the repo already has **five parallel one-off
extraction paths** (regex submittal seeder, AI submittal generator, and three
read-only registers that re-parse `SpecSection.aiExtractions` JSON on every
GET). The pipeline below replaces "each feature re-reads the AI blob its own
way" with ONE durable, reviewable, cited candidate table that every
downstream consumer instantiates from. Nothing existing is deleted or
rewritten; everything new is additive.

---

## 0. What already exists (do not rebuild)

All `[V]`, file:line at the anchored SHA.

| Capability | Where | Notes |
|---|---|---|
| Spec book upload → `SpecBook` row | `prisma/schema.prisma:579-589`; `app/api/bids/[id]/specbook/upload/route.ts` | `status` defaults `"processing"` |
| Section split (sidecar, per-section PDF + page range) | `app/api/bids/[id]/specbook/split/route.ts:52-64` → sidecar `POST /parse/specs/split`; writes `SpecSection` rows at `:122-141` | `pdfPath` stored as **relative BlobStore key**; `pageStart`/`pageEnd`/`pageCount` populated (`schema.prisma:610-614`) |
| `SpecSection` | `prisma/schema.prisma:591-620` | `rawText :597` (**truncated to 10,000 chars** at split — `split/route.ts:131` `s.text.slice(0, 10000)`); `aiExtractions :606` (JSON blob: "submittals, warranties, training, testing, closeout, products, performance" per `:605`); `submittalItems` relation `:619` |
| AI spec analysis (3-pass, tiered Haiku/Sonnet) | `sidecar/services/spec_intelligence.py:1-14` (Pass 1 TOC identify, Pass 2 per-section analyze, Pass 3 aggregate); results persisted via callback `app/api/bids/[id]/specbook/analyze/complete/route.ts` into `SpecSection.aiExtractions` | Page markers `[PAGE X]` exist in extraction text (`spec_intelligence.py:112`) but **per-item page/paragraph citations are NOT emitted today** [V — absent from `CallbackPayload` shape at `analyze/complete/route.ts:23-45`] |
| Deterministic (regex) submittal seeding | `lib/services/submittal/seedSubmittalRegister.ts` — idempotent, defensive, additive (header `:3-9`) | **Fixed (WP1a, `c51f28b`) `[V]`: the seeder now writes `source="regex_seed"`** on every created row, so the AI-regeneration wipe (`generateFromAiAnalysis.ts:149`, `source in ["ai_extraction","regex_seed","csi_baseline","ai_organized"]`) and organize-ai replacement set (`organizeWithAi.ts:371`) both correctly match regex-seeded rows now; `updateSubmittal()` additionally promotes a row to `source="manual"` the moment a user edits it, so a corrected auto row is never silently replaced by the next auto pass, without touching either wipe's logic. The spine's `extractionMethod` must still be written explicitly by every producer — never defaulted — same as `source` now correctly is |
| AI → SubmittalItem generation | `lib/services/submittal/generateFromAiAnalysis.ts` — idempotent on `(bidId, specSectionId, type, title)` (`:8-9`), boilerplate filter `isGenericBoilerplate()` (`:42-48`), CERT/LEED deliberately excluded for a future closeout module (`:33-37`) | Writes `source="ai_extraction"`, `sourceJobId` job attribution |
| Submittal register + provenance fields | `prisma/schema.prisma:776-848` — `source :797` (six known values, documented inline `:788-796`: `"manual" | "regex_seed" | "ai_extraction" | "csi_baseline" | "ai_organized" | "drawing_analysis"`), `specSectionId :780`, `sourceJobId :824`, `linkedActivityId :820`, backward-math due dates `:819-826`. Since WP1b (`0ce2604`), `source` renders as a display-only provenance badge in the packages grid (`lib/services/submittal/provenanceLabels.ts` + `SubmittalsTab.tsx`) — origin only, never a quality/verification claim. | The closest thing to the target lifecycle that exists |
| Read-only derived registers (warranty/training/inspections/closeout) | `app/api/bids/[id]/warranties/route.ts` (+ `training/`, `inspections/`, `closeout/`) — each re-parses `aiExtractions` per GET; **no DB rows** ("No new DB model — data is derived", `warranties/route.ts:7`) | Tabs: `app/bids/[id]/WarrantiesTab.tsx` etc.; tab groups in `app/bids/[id]/tabConfig.ts:18-20` (`CONSTRUCTION_KEYS`) |
| Schedule V2 | `prisma/schema.prisma:948-1041` — `ScheduleActivityV2 :972` already has `aiGenerated :989`, `aiConfidence :990`, `requiresInspection :987`; `ScheduleDependency :1014`; snapshot `ScheduleVersion :1030` |
| Procurement | `BuyoutItem` `prisma/schema.prisma:222-257` (per-trade commitment lifecycle) |
| Procore-ready export | `app/api/bids/[id]/submittals/export/route.ts` — CSV matching Procore's submittal import template (`:1-13`); `ProcorePush` log `schema.prisma:1243`; RFI **pull** `RfiItem :1265` |
| Provider gateway (sole construction site) | `lib/services/ai/gateway.ts:202-238` (`createMessage`), client construction only at `:205`; P2-A0 shadow prompt scan `:142-200` (detection/telemetry ONLY); `classifyAiFailure` closed vocabulary `:96-117` |
| Usage/cost honesty contract | `lib/services/ai/aiUsageLog.ts:14-42` — `status: "ok" | "error" | "stub"`; stub paths write honest `status:"stub"` rows, never fake `ok`; `errorMessage` only ever a bounded `AiFailureClass` |
| Call registry + budgets | `lib/services/ai/aiTokenConfig.ts:48-169` (`AI_CALL_DEFINITIONS`, typed `CallKey :171`), `estimateCallCost :185`, DB-overridable `getMaxTokens :227`; cost preview UI `app/bids/[id]/AiCostPreview.tsx` |
| Admin automation gate (default OFF, fail-closed) | `lib/services/settings/documentAutomation.ts:79-91`; ADR `docs/architecture/adr/0003-document-ai-enrichment-admin-control.md` |
| Honest availability states | `lib/services/specbook/fileAvailability.ts:20-25` (`"durable-present" | "legacy-present" | "missing" | "invalid"`), classifier `lib/services/specbook/storagePath.ts` |
| Provenance-link discipline | `lib/services/specbook/sourceSectionLink.ts:16-18` — "Do NOT extend this to build links from free-text matching… only ever… a populated, schema-declared foreign key column" |
| Durable jobs | `BackgroundJob` `prisma/schema.prisma:1301-1363` — status FSM, `triggerSource`, dedupe `activeSlot` unique `(bidId, jobType, activeSlot)`. **Caveat `[V]` (matches CAPABILITY-MATRIX-2026-07): the dedupe guards are currently inert — no caller passes `dedupeKey`, and the only queue-scrape writer bypasses the service with `bidId`/`dedupeKey` both null, where SQLite NULL-distinct semantics mean the unique constraints never fire. Spine jobs must pass real slot/dedupe values to get actual dedupe** |
| Audit | `AuditEvent` `prisma/schema.prisma:3813-3855`; emitter `lib/observability/audit.ts`; **closed** category vocabulary `lib/observability/taxonomy.ts` (`AUDIT_CATEGORIES`, `DB_PERSISTED_CATEGORIES :163`) |

What does NOT exist [V by absence at this SHA]: any durable
requirement/candidate table; any per-item source citation (page/paragraph/
excerpt); any review/waive lifecycle for extracted requirements; any DB rows
behind the warranty/training/inspections/closeout tabs.

---

## 1. Principles (hard constraints)

These bind every implementing card. They restate — never weaken — existing
repo rules.

1. **Draft-first, always.** Every AI or deterministic extraction lands as a
   `RequirementCandidate` in `status="draft"`. No extraction path may create
   a `SubmittalItem`, `ScheduleActivityV2`, `BuyoutItem`, or any other
   workflow row directly once the spine exists. (Precedent: today's AI
   generator writes SubmittalItems directly — `generateFromAiAnalysis.ts` —
   that path is *bridged*, not copied; see §4 stage 5.)
2. **Every candidate carries a source citation**: `specSectionId` FK +
   page/paragraph locator + verbatim excerpt (§2). A candidate whose excerpt
   cannot be verified against stored section text is marked
   `citationVerified=false` and shown as such — surfaced honestly, never
   silently dropped and never displayed as verified (same honesty posture as
   the `"missing" | "invalid"` availability states,
   `fileAvailability.ts:20-25` [V]).
3. **Human review is the ONLY path to a commitment.** `draft → approved |
   waived | rejected` transitions require an authenticated user;
   instantiation into workflow rows happens only from `approved`, only as a
   direct consequence of that human action. The system may only create
   drafts and mark staleness.
4. **AI never acts.** No sending communications (RFQ/email paths under
   `lib/services/email/`, `OutreachLog` — untouched), no schedule/procurement
   commitments, no silent mutation of project records. AI output is inert
   data until a human transitions it.
5. **Provider calls only via the sanctioned gateways** —
   `lib/services/ai/gateway.ts` / `sidecar/services/ai_gateway.py` [V two-
   gateway rule, gateway.ts:23-25]. The `detect-ai-providers` allowlist
   accepts NO new entries. Every call: admin-gated per ADR 0003 conventions
   for automatic triggers, cost-logged to `AiUsageLog` under a registered
   `CallKey`, stub-mode capable with honest `status:"stub"` rows
   (`aiUsageLog.ts:14-42` [V]).
6. **Deterministic first, AI second, both attributable.** Anything a regex/
   heuristic can extract reliably (submittal verbs, warranty durations,
   closeout lists) runs without a provider. `extractionMethod`
   (`regex | heuristic | ai_claude | manual`) discriminates every candidate;
   extractor version is recorded so re-runs are comparable.
7. **Additive, forward-only.** All schema below is new tables / nullable
   columns only; applied solely via `scripts/apply-turso-migrations.mjs` on a
   human-approved card. No existing column changes meaning.
8. **Sub confidentiality unchanged**: `pricingData`/`rawPriceText`, sub
   names, companies, `isPreferred` never enter extraction prompts or
   candidate payloads. Spec text is owner/architect-authored, but the
   *prompt assemblers* for this pipeline must select only spec-derived
   fields (mirror `assembleGapPrompt.ts`'s explicit `select:` discipline
   [V `lib/services/ai/assembleGapPrompt.ts:19-40`]).

---

## 2. Shared domain model (proposed, additive-only)

### 2.1 Design choices, grounded

- **Citation fields are EMBEDDED on the candidate, not a separate
  `SourceEvidence` table.** [INF] Rationale: (a) exactly one citation per
  candidate in v1; (b) re-split **deletes all `SpecSection` rows**
  (`split/route.ts:117-119` [V]), so the candidate must carry a denormalized
  snapshot (csiNumber, page, excerpt) that survives FK nulling; (c) a join
  table adds a query on every register render for zero flexibility we need
  yet. If multi-citation candidates arrive later, an evidence table can be
  added additively without moving these columns.
- **String status/kind columns validated in API, not Prisma enums** —
  the repo's explicit SQLite-friendliness convention [V comments at
  `schema.prisma:711-715`, `:899-905`, `DrawingUpload :637-638`].
- **Loose reviewer pointer (`reviewedById String?` referencing `User.id`
  cuid, `schema.prisma:17-18` [V]) plus denormalized `reviewedByEmail`** —
  mirrors `AuditEvent.actorUserId/actorEmail` (`schema.prisma:3824-3825`).
- **Typed nullable FKs for instantiation links, not a generic
  `(targetKind, targetId)` join.** `sourceSectionLink.ts:16-18` [V] is
  explicit that UI provenance links must come from schema-declared FK
  columns. A `RequirementLink` join row carries one typed FK per target
  model; one candidate may instantiate several rows (e.g. warranty →
  SubmittalItem + closeout doc).

### 2.2 `RequirementCandidate` (new table)

```prisma
// Spec Intelligence spine — one row per extracted requirement, draft-first.
// kind values (validated in API, not enum — SQLite convention):
//   SUBMITTAL | PROCUREMENT | TEST_INSPECTION | TRAINING | WARRANTY |
//   CLOSEOUT | ATTIC_STOCK | SCHEDULE_CONSTRAINT | RFI_FLAG
// extractionMethod: regex | heuristic | ai_claude | manual
// status FSM (see §3): draft | approved | waived | rejected | stale
model RequirementCandidate {
  id    String @id @default(cuid())
  bidId Int

  // ── Source citation (Principle 2) ──
  specBookId    Int
  specSectionId Int?      // SetNull on re-split; snapshot fields below survive
  csiNumber     String    // denormalized from SpecSection at extraction time
  csiTitle      String
  pageNumber    Int?      // absolute page in original spec book
                          // (SpecSection.pageStart/pageEnd bound it)
  paragraphRef  String?   // spec paragraph locator, e.g. "1.6.B.2", best-effort
  excerpt       String    // verbatim quote from section text (bounded, ~500 chars)
  charStart     Int?      // offset into SpecSection.rawText, when method=regex
  charEnd       Int?
  citationVerified Boolean @default(false) // excerpt found verbatim in stored text

  // ── Classification + payload ──
  kind       String
  title      String
  detailJson String?     // kind-specific structured payload (JSON string —
                         // same convention as aiExtractions/deltaJson)

  // ── Attribution (Principle 6) ──
  extractionMethod String            // regex | heuristic | ai_claude | manual
  extractorVersion String            // e.g. "det-scan-v1", "spec-intel-pass2-v3"
  confidence       String?           // HIGH | MEDIUM | LOW — matches MarketLead
                                     // precedent (schema.prisma:1389,1398);
                                     // regex candidates = HIGH by construction
  sourceJobId      String?           // BackgroundJob attribution — exact
                                     // precedent: SubmittalItem.sourceJobId (:824)

  // ── Review lifecycle (Principle 3) ──
  status          String    @default("draft")
  reviewedById    String?   // User.id (cuid)
  reviewedByEmail String?   // denormalized, AuditEvent-style
  reviewedAt      DateTime?
  waiverReason    String?   // REQUIRED by API when status=waived
  staleReason     String?   // set by system: "section_resplit" | "reanalyzed"

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  bid         Bid          @relation(fields: [bidId], references: [id], onDelete: Cascade)
  specBook    SpecBook     @relation(fields: [specBookId], references: [id], onDelete: Cascade)
  specSection SpecSection? @relation(fields: [specSectionId], references: [id], onDelete: SetNull)
  sourceJob   BackgroundJob? @relation(fields: [sourceJobId], references: [id], onDelete: SetNull)
  links       RequirementLink[]

  @@index([bidId, kind, status])
  @@index([specSectionId])
  @@index([specBookId])
  @@index([sourceJobId])
  // Idempotent re-extraction — same discipline as generateFromAiAnalysis
  // (bidId, specSectionId, type, title) and the seeder:
  @@unique([bidId, specSectionId, kind, extractionMethod, title])
}
```

Note on the unique key: `specSectionId` is nullable; SQLite treats NULLs as
distinct in unique indexes (already relied on by
`BackgroundJob.activeSlot`, `schema.prisma:1345-1349` [V]), so stale
candidates with nulled sections never block re-extraction into fresh rows.

### 2.3 `RequirementLink` (new table)

```prisma
// Instantiation record: which workflow row(s) a candidate became.
// Exactly ONE of the typed FKs is set per row (API-enforced).
// Typed FKs, not (kind,id) strings — sourceSectionLink.ts's rule: UI
// provenance only from schema-declared FK columns.
model RequirementLink {
  id          String @id @default(cuid())
  candidateId String

  submittalItemId      Int?     // → SubmittalItem (schema.prisma:776)
  scheduleActivityV2Id String?  // → ScheduleActivityV2 (:972)
  buyoutItemId         Int?     // → BuyoutItem (:222)
  generatedQuestionId  Int?     // → GeneratedQuestion (:425) — RFI_FLAG kind

  createdById    String    // human who approved — never "system"
  createdByEmail String?
  createdAt      DateTime  @default(now())
  voidedAt       DateTime? // human unlink; row kept for audit, never deleted
  voidedById     String?

  candidate        RequirementCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  submittalItem    SubmittalItem?       @relation(fields: [submittalItemId], references: [id], onDelete: SetNull)
  scheduleActivity ScheduleActivityV2?  @relation(fields: [scheduleActivityV2Id], references: [id], onDelete: SetNull)
  buyoutItem       BuyoutItem?          @relation(fields: [buyoutItemId], references: [id], onDelete: SetNull)
  question         GeneratedQuestion?   @relation(fields: [generatedQuestionId], references: [id], onDelete: SetNull)

  @@index([candidateId])
  @@index([submittalItemId])
  @@index([scheduleActivityV2Id])
  @@index([buyoutItemId])
}
```

(Reciprocal relation-list fields get added to `SubmittalItem`,
`ScheduleActivityV2`, `BuyoutItem`, `GeneratedQuestion`, `Bid`, `SpecBook`,
`SpecSection`, `BackgroundJob` — relation declarations only, no columns on
those tables, so the migration stays purely additive [INF from Prisma
relation mechanics].)

### 2.4 Field-level fit: exists vs. added

| Concern | Already exists [V] | Added by this design |
|---|---|---|
| Section identity + page range | `SpecSection.csiNumber/csiTitle/pageStart/pageEnd` (`schema.prisma:595-596,612-613`) | per-ITEM `pageNumber`, `paragraphRef`, verbatim `excerpt`, `charStart/End` |
| Extraction provenance | `SubmittalItem.source` 6-value string (`:788-797`: `manual/regex_seed/ai_extraction/csi_baseline/ai_organized/drawing_analysis`; trustworthy since WP1a `c51f28b`, displayed as a badge since WP1b `0ce2604`); `ScheduleActivityV2.aiGenerated/aiConfidence` (`:989-990`) | unified `extractionMethod` + `extractorVersion` + `confidence` on ONE table |
| Job attribution | `SubmittalItem.sourceJobId` (`:824`) | same pattern on candidate |
| Review lifecycle | `SubmittalItem.status` is a *submittal logistics* FSM (PENDING→…→APPROVED, `:714-715`) — approval of the *document*, not of the *requirement's existence* | candidate `draft/approved/waived/rejected/stale` with reviewer + waiver reason (nothing comparable exists) |
| Waivers | nothing | `waiverReason`, audited |
| Registers (warranty/training/inspection/closeout) | derived JSON re-parse per GET, no rows, no review, no citations (`warranties/route.ts:5-9`) | candidates of those kinds become the durable backing store; tabs re-point at the candidates API |
| Cost/usage | `AiUsageLog` (`:1076`), `AI_CALL_DEFINITIONS` | one new `CallKey` entry (`requirement-extraction`) — additive per `aiTokenConfig.ts:7-9`'s own instructions |
| Audit | `AuditEvent` + closed `AUDIT_CATEGORIES` (`taxonomy.ts`) | one new category `"requirement_review"` appended to `AUDIT_CATEGORIES` and `DB_PERSISTED_CATEGORIES :163` (code change, additive) |

---

## 3. Lifecycle + state machine

```
                    ┌────────────────────────────────────────────┐
  extraction run    │                                            │
  (system, gated) ──►  draft ──human──► approved ──human,same──► instantiated*
                    │    │                 action    (links created)
                    │    ├──human──► waived   (waiverReason required)
                    │    ├──human──► rejected
                    │    └──system─► stale    (section re-split / re-analysis
                    │                          superseded this candidate)
                    └────────────────────────────────────────────┘
  * "instantiated" is NOT a status value: it is approved + ≥1 non-voided
    RequirementLink. One fewer state to corrupt; the truth is the link row.
```

| Transition | Actor | Mechanism | Audit (`category:"requirement_review"`) |
|---|---|---|---|
| (create) → `draft` | system (extraction run) or human (`manual`) | scan service / callback mapper / POST API | `action:"candidate_created"`, `actorKind:"system"|"operator"`, payload: kind, method, extractorVersion, citationVerified |
| `draft → approved` (+ links) | **human only** | PATCH review API; link creation in the SAME Prisma transaction | `action:"candidate_approved"`, decision lists created link target ids |
| `draft → waived` | **human only** | PATCH, `waiverReason` mandatory (400 without) | `action:"candidate_waived"`, reasonLog carries waiver text |
| `draft → rejected` | **human only** | PATCH | `action:"candidate_rejected"` |
| any non-stale → `stale` | **system only** | re-split/re-analysis marks (never deletes) prior candidates | `action:"candidate_marked_stale"`, `staleReason` |
| link `voidedAt` set | **human only** | unlink API — voids the LINK; never deletes the target workflow row automatically | `action:"link_voided"` |
| `approved/waived/rejected → draft` | **human only** (reopen) | PATCH; forbidden while non-voided links exist | `action:"candidate_reopened"` |

Rules [INF, from Principles 3–4]:

- No system path may ever set `approved`, `waived`, or `rejected`.
- Approve-and-instantiate is atomic: candidate update + workflow-row create +
  `RequirementLink` create in one transaction; audit emitted after commit
  (fire-and-forget `emitAuditEventNoAwait` per gateway precedent).
- Instantiated workflow rows keep their OWN lifecycles (submittal logistics
  FSM, schedule editing) — the spine never mutates them after creation.
- Deleting a target row a human created through this pipeline follows the
  target's existing deletion rules; the link's FK goes null (`SetNull`) and
  the void/audit trail preserves history.

---

## 4. Pipeline stages with existing anchors

### Stage 1 — Section split (EXISTS, unchanged)

`app/api/bids/[id]/specbook/split/route.ts` → sidecar
`spec_splitter.py`; produces `SpecSection` rows with per-section PDF
(relative BlobStore key), `pageStart/pageEnd`, trade matching, canonical CSI
titles [V]. One pipeline change *around* it (not in it): the split route
deletes all prior sections (`:117-119`) — Step D of the rollout adds a
pre-delete hook that marks that book's non-stale candidates `stale`
(`staleReason:"section_resplit"`), preserving review history.

### Stage 2 — Deterministic candidate scan (NEW, cheap, no provider)

New `lib/services/requirements/deterministicScan.ts`, modeled directly on
`seedSubmittalRegister.ts` (idempotent / defensive / additive header
contract [V `:3-9`]) and its regex bank, plus `generateFromAiAnalysis.ts`'s
noise filters (`isGenericBoilerplate`, verb-prefix stripping [V `:42-79`]).

- Input: `SpecSection.rawText` (**know the limit: 10k chars** —
  `split/route.ts:131`; beyond that, deterministic scan sees nothing — an
  honest `scanCoverage:"truncated"` flag on the run result, never a silent
  gap).
- Output: `RequirementCandidate` rows, `extractionMethod:"regex"`,
  `confidence:"HIGH"`, `charStart/charEnd` + excerpt sliced from `rawText`
  (`citationVerified:true` by construction), `pageNumber` approximated from
  the section's `pageStart` (paragraph-level page attribution within a
  section is `[UNK]` for regex; leave `pageNumber` null rather than guess
  when the section spans many pages).
- Kinds it can reliably produce [INF from existing regex bank]: SUBMITTAL,
  WARRANTY (duration patterns already parsed by the warranty register),
  TRAINING, CLOSEOUT, ATTIC_STOCK ("extra stock/attic stock" phrasing),
  TEST_INSPECTION.
- Trigger: explicit user action (button on the register tab) or
  post-split hook. Runs in-process or as a `BackgroundJob`
  (`jobType:"requirement_scan"` — new value in the validated-in-API string,
  additive per `schema.prisma:1295-1297` comment conventions). No admin gate
  needed (no provider), but audited as `candidate_created` batch.

### Stage 3 — AI extraction pass (NEW mapping over EXISTING call path)

Do **not** add a new provider call site. Extend the existing spec-analysis
flow:

- Sidecar Pass 2 (`spec_intelligence.py`) prompt gains a per-item
  requirement: every extracted item must include `quote` (verbatim, ≤500
  chars) and `page` (from the `[PAGE X]` markers already in its input,
  `spec_intelligence.py:112` [V]) and optional `paragraph` ("1.6.B.2").
  Provider calls stay inside `sidecar/services/ai_gateway.py` — the second
  sanctioned gateway; no allowlist change.
- The callback route (`analyze/complete/route.ts`) — which already persists
  `aiExtractions` and calls `generateSubmittalsFromAiAnalysis` [V] — gains a
  mapper: analysis JSON → `RequirementCandidate` rows,
  `extractionMethod:"ai_claude"`, `extractorVersion` from the sidecar
  payload, `sourceJobId` from the completed `BackgroundJob`.
- **Server-side citation verification**: the mapper checks each `quote`
  verbatim (whitespace-normalized) against `SpecSection.rawText`;
  found ⇒ `citationVerified:true` + `charStart/End`; not found (including
  the >10k-char truncation case) ⇒ `citationVerified:false`, candidate kept,
  UI badges it "citation unverified". Honest state, never a fabricated
  locator — the `"missing"/"invalid"` posture applied to citations.
- Gating + cost: automatic post-upload triggering stays behind
  `documentAutomationStatus()` (default OFF, fail-closed,
  `documentAutomation.ts:79-91` [V]; ADR 0003). Explicit user-clicked
  Analyze remains out of ADR 0003 scope per the ADR's own scope note
  (`0003…md:9-10` [V]) but shows a pre-run cost preview via
  `estimateCallCost` + `AiCostPreview.tsx` idiom. Register a
  `"requirement-extraction"` `CallKey` in `AI_CALL_DEFINITIONS` (the file's
  own two-step instructions, `aiTokenConfig.ts:7-9` [V]); sidecar-side usage
  is already reported via `pass2_usage` and `logSidecarUsage`
  (`analyze/complete/route.ts:33-43` [V]). Stub mode: a
  `REQUIREMENT_STUB_MODE` path writing honest `status:"stub"` rows, exactly
  the `BRIEF_STUB_MODE` convention (`aiUsageLog.ts:37-42` [V]).

### Stage 4 — Review UI (NEW tab, existing idioms)

- New `RequirementsTab` following the register-tab idiom exactly:
  client component + filter chips + search + stats header
  (`WarrantiesTab.tsx:1-45` [V is the template); new `TabKey` in
  `tabConfig.ts` (post-award group).
- Columns: kind badge, title, CSI section, citation (page + excerpt
  popover + verified badge), method/confidence, status, reviewer.
- Row actions: Approve (opens kind-specific instantiation dialog —
  pre-filled SubmittalItem / schedule-constraint / BuyoutItem-note /
  GeneratedQuestion form), Waive (reason required), Reject.
- "View source section" uses `sourceSectionLink.ts` + per-section PDF route
  (`app/api/bids/[id]/specbook/sections/[sectionId]/pdf`) with
  `checkFileAvailability` — all existing [V]; candidates with a nulled
  `specSectionId` render the snapshot citation with a "section re-split"
  note instead of a link (the module's FK-only rule).

### Stage 5 — Instantiation into registers / schedule / procurement / export

On approve, per kind (all target models exist [V]):

| kind | Creates | Existing anchor |
|---|---|---|
| SUBMITTAL | `SubmittalItem` (`source:"ai_extraction"` or new `"requirement_candidate"` value — validated-in-API string, additive) with `specSectionId`, package/routing via existing services | `submittalService.ts`, packages `schema.prisma:720` |
| WARRANTY / TRAINING / TEST_INSPECTION / CLOSEOUT / ATTIC_STOCK | v1: the approved candidate itself IS the durable register row; the four register tabs/APIs re-point from `aiExtractions` re-parse to `RequirementCandidate` where kind+status filters apply (the warranty route's derived-only design was explicitly interim — "No new DB model" `warranties/route.ts:7`; CERT/LEED were parked for exactly this module, `generateFromAiAnalysis.ts:33-37` [V]) | register routes + tabs |
| SCHEDULE_CONSTRAINT | `ScheduleActivityV2` milestone/constraint row (`aiGenerated:true`, `aiConfidence` from candidate) and/or link to an existing activity chosen by the human — never edits existing activities | `schema.prisma:972-1012` |
| PROCUREMENT | v1: link to the trade's `BuyoutItem` + append structured note; long-lead metadata columns on BuyoutItem are a later additive card | `schema.prisma:222` |
| RFI_FLAG | `GeneratedQuestion` draft (its own existing review/export flow) | `schema.prisma:425` |
| (any) | Procore-ready: instantiated SubmittalItems flow through the existing CSV export untouched | `submittals/export/route.ts` [V] |

---

## 5. What NOT to build

1. **Bidirectional Procore sync.** Export = existing CSV; inbound = existing
   `RfiItem` pull + webhook log. No write-back of requirement state to
   Procore, no reconciliation engine.
2. **Auto-send anything.** No candidate, approval, or waiver ever triggers
   email/RFQ/notification sends. Communications stay human-initiated in
   their existing flows.
3. **Auto-schedule mutation.** SCHEDULE_CONSTRAINT candidates never modify
   dates, durations, dependencies, or existing activities — they create new
   human-approved rows only. No background re-scheduling.
4. **Meetings coupling.** The meetings domain stays out of this spine
   entirely: its durability-read is UNPROVEN and unsafe to exercise
   (triggers transcription — `.claude/rules/verification-evidence.md` [V]);
   the harness decision is GWX-Q07's. No "action items → candidates" bridge.
5. **A SourceEvidence mega-table / generic evidence graph.** Embedded
   citation fields (§2.1) until a real multi-citation need exists.
6. **Retro-migration of `aiExtractions` history.** Old JSON blobs stay
   readable by the current registers until re-analysis naturally produces
   candidates; no backfill job that fabricates citations for data extracted
   without them.
7. **Prompt-scan "enforcement."** P2-A0 stays shadow-only telemetry; this
   pipeline must not describe or use it as redaction/blocking.

---

## 6. Migration / rollout order (additive, forward-only)

Each step is one queue-card-sized unit; every schema step requires its own
explicit human-approved card and applies only via
`scripts/apply-turso-migrations.mjs` (checkpoint-before-mutation rule).
Ordering note: per the image-ordering rule
(`.claude/rules/environments-deployment.md` [V]), each migration lands
strictly before the app image that references its columns.

- **Step A — Schema: `requirement_candidate` + `requirement_link` tables**
  (one migration, e.g. `2026MMDD…_requirement_candidate_spine`; new tables +
  relation declarations only; both additive/nullable).
  *Test (local, no DB):* mocked-Prisma unit tests are the repo template —
  `vi.hoisted` mock-module pattern in
  `lib/services/submittal/__tests__/*` [V]; plus `npx prisma validate`.
- **Step B — Deterministic scan + candidates API + read-only Requirements
  tab + review transitions (approve/waive/reject, no instantiation yet)** —
  no provider, no admin gate; includes the `"requirement_review"` audit
  category (append to `AUDIT_CATEGORIES`/`DB_PERSISTED_CATEGORIES`,
  `taxonomy.ts` — additive code).
  *Test:* pure-function regex tests on fixture spec text (the
  `seedSubmittalRegister` test style); FSM tests proving system paths cannot
  reach `approved/waived/rejected`; idempotency test (double-scan ⇒ no new
  rows); route tests with mocked prisma asserting waiver-reason 400 and
  audit emission.
- **Step C — AI mapping**: sidecar Pass-2 prompt gains quote/page fields;
  callback mapper → candidates with server-side citation verification; new
  `CallKey`; `REQUIREMENT_STUB_MODE`; automatic trigger stays behind
  `documentAutomationStatus()`.
  *Test:* callback route tests (the existing
  `analyze/complete/__tests__/route.test.ts` idiom [V]) with fixture
  payloads — verified quote ⇒ `citationVerified:true` + offsets; fabricated
  quote ⇒ `false`, row kept; stub-mode test asserting one honest
  `status:"stub"` usage row and zero gateway calls (sentinel-key pattern
  from `organizeWithAi` tests [V]). Sidecar prompt-shape tests offline in
  `sidecar/services/__tests__`. Real-provider validation of extraction
  quality is `[UNK]` until a human-gated GWX-Q16-class run — never claimed
  from stubs.
- **Step D — Instantiation + register re-pointing + staleness hook**:
  approve-transaction creating SubmittalItem / ScheduleActivityV2 /
  BuyoutItem-link / GeneratedQuestion + `RequirementLink`; warranty/
  training/inspections/closeout routes re-pointed to candidates (keeping the
  `aiExtractions` fallback for books never re-analyzed); split-route
  pre-delete stale-marking.
  *Test:* transaction tests (mocked prisma) proving atomicity and that
  links always carry a human `createdById`; register-route tests proving
  fallback behavior; stale-marking test proving re-split never deletes
  candidates.

Steps B–D are local-implementable per `.claude/rules/local-only-implementation.md`
once Step A's migration card has been human-applied to the target tier;
until then, all of B–D's tests run against mocks/fakes only, and any claim
about live behavior stays `[UNK]`.
