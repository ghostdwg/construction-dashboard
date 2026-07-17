# Capability Ledger — Meeting-to-Response Control Loop (R2)

Last updated: 2026-07-17 · Audited at: `ffd5bd1` (branch `gwx/r2-meeting-response-control-loop`)
Scope: every capability in the R2 meeting/field-report/response domain.
This ledger records what is **actually implemented**, with evidence. Route
existence is never treated as proof of capability.

Status vocabulary (exactly these):

| Status | Meaning |
|---|---|
| `SCAFFOLD` | Placeholder/stub exists; not functionally complete |
| `BUILT` | Code complete locally; not verified wired end-to-end |
| `WIRED` | End-to-end path exists in source (UI→route→service→store) |
| `TESTED` | Local automated tests cover the capability |
| `STAGING_PROVEN` | Exercised on staging with recorded operator evidence |
| `PRODUCTION_PROVEN` | Exercised in production with recorded evidence |
| `BLOCKED` | Cannot proceed; exact blocker recorded |
| `DEFERRED` | Deliberately not built yet |

Evidence tags follow the Execution Ledger convention: `[V]` source/git-verified,
`[OP]` operator-verified live, `[INF]` inference, `[UNK]` unknown.

**Global staging note:** nothing in this domain is STAGING_PROVEN. The only
staging-proven capability in the repo is the Spec Book storage smoke
(13/13, image `e41b027-storage-smoke-failclosed`) plus one controlled
Anthropic call (`LAST_REAL_SUCCESS`) — see
`docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §1. Every row below is
at best local-only. Production is frozen; nothing is PRODUCTION_PROVEN.

---

## 1. Meeting capture and transcription

### 1.1 Meeting upload (standard audio)
- **Status:** WIRED (with a durability gap)
- **Source evidence [V]:** `app/api/bids/[id]/meetings/[meetingId]/upload/route.ts` — multipart `audio` → sidecar `/meetings/transcribe`; sidecar 400 → status PENDING for manual entry. UI `app/bids/[id]/MeetingsTab.tsx`.
- **Gap [V]:** the standard path streams audio to the sidecar and stores only `audioFileName`; **no durable audio blob is written**. Only the hybrid path persists audio.
- **Test evidence:** none for this route.
- **Staging evidence:** none `[UNK]`.
- **Security evidence:** route had **no `requireBidAccess`** at `ffd5bd1`; hardened in R2 Build 1 (see §7).
- **Blocker:** none.
- **Next acceptance test:** upload a synthetic audio file on staging with sidecar configured; verify durable storage + transcription completes (human-gated).

### 1.2 Meeting upload (hybrid Teams VTT + audio)
- **Status:** WIRED + TESTED (route-level)
- **Source evidence [V]:** `app/api/bids/[id]/meetings/[meetingId]/upload-hybrid/route.ts` — validates `WEBVTT` header, persists audio via `getBlobStore().put()` under `uploads/meetings/{id}/{safeName}` (`lib/services/meetings/storagePath.ts:49`), sets `AWAITING_SOURCE_MAP`.
- **Test evidence [V]:** `app/api/bids/[id]/meetings/[meetingId]/upload-hybrid/__tests__/route.test.ts` — durable-key persistence, invalid VTT rejection, cross-bid 404.
- **Staging evidence:** none `[UNK]`.
- **Security evidence:** no `requireBidAccess` at `ffd5bd1`; hardened in R2 Build 1.
- **Next acceptance test:** hybrid upload on staging; confirm blob at expected key and `AWAITING_SOURCE_MAP`.

### 1.3 Audio storage
- **Status:** BUILT (local backend only; hybrid path only)
- **Source evidence [V]:** `lib/storage/blobStore.ts` — `LocalBlobStore` only; `STORAGE_BACKEND` non-`local` throws; `put()` overwrites (no immutability enforcement). `Meeting.audioStorageKey` (schema:1147) nullable; legacy rows resolve via `lib/services/storage/legacyPathCompat.ts` (4-shape resolver, TESTED: `lib/services/storage/__tests__/legacyPathCompat.test.ts`).
- **Blocker:** original-audio immutability is convention, not enforced (`put()` overwrites).
- **Next acceptance test:** staging write-then-read of a meeting audio key; verify no overwrite path is reachable from routes.

### 1.4 Transcription + provider selection
- **Status:** BUILT (AssemblyAI path complete); **BLOCKED** for the in-repo WhisperX worker
- **Source evidence [V]:** sidecar `sidecar/routers/meetings.py:75-109` — WhisperX first when `WHISPERX_URL` set, else AssemblyAI, else 400. Job ids prefixed `WHISPERX:`/`AAI:`. Polling: `app/api/bids/[id]/meetings/[meetingId]/status/route.ts`.
- **Exact blocker [V]:** **client/worker contract mismatch** — sidecar `poll_whisperx_status` calls `GET /job/{id}` + `GET /artifacts/{id}` and submits field `file` expecting `job_id` (`sidecar/services/meeting_intelligence.py:230-266`), but `gpu-worker/whisperx_server.py` exposes `GET /status/{job_id}`, accepts field `audio`, returns `jobId`. The two are incompatible as committed. (Branch `gwx/gpu-whisperx-sidecar-contract-compat` exists elsewhere; not in this tree.)
- **Test evidence:** none for submit/poll on either side.
- **Staging evidence:** none `[UNK]`.
- **Next acceptance test:** contract-compat fix + a recorded end-to-end WhisperX transcription on staging (human-gated; GPU worker is external hardware).

### 1.5 WhisperX GPU worker
- **Status:** BUILT (standalone, real inference), not wired (see 1.4)
- **Source evidence [V]:** `gpu-worker/whisperx_server.py` — WhisperX + pyannote diarization, `X-API-Key` auth via `WHISPERX_API_KEY` (optional — **allows all when unset**), in-memory job store (lost on restart). There is no `WORKER_TOKEN`; the credential name is `WHISPERX_API_KEY`.
- **Security evidence [V]:** auth optional; fail-open when key unset. Rotation status of WHISPERX/SIDECAR keys is UNKNOWN (Ledger; GWX-Q17).
- **Next acceptance test:** worker deployed with key enforced; unauthenticated request rejected (human-gated).

### 1.6 Diarization
- **Status:** BUILT (worker + hybrid merge); persisted **denormalized only**
- **Source evidence [V]:** worker diarization `whisperx_server.py:92-129`; hybrid VTT merge `sidecar/services/transcript_merger.py` (`merge_hybrid`). Persisted as `Meeting.rawTranscript` (JSON with `segments[{speaker,text,start,end}]`), `Meeting.transcript` (display text), `Meeting.speakerMapping` (JSON). Roster normalized in `MeetingParticipant` (schema:1185).
- **R2 Build 1 [V]:** segments are now materialized into `MeetingTranscriptSegment` rows (immutable original fields + correction overlay) — see §6.1.
- **Test evidence:** merge untested; Build 1 adds segment-materialization tests.
- **Next acceptance test:** staging transcription producing ≥2 diarized speakers with segment rows materialized.

### 1.7 Speaker mapping (labels → people)
- **Status:** WIRED
- **Source evidence [V]:** `speaker-mapping/route.ts` (PATCH; regex-rewrites display transcript, updates `MeetingParticipant.name`), `source-mapping/route.ts` (POST; Teams source modes PERSON/SHARED_MIC/IGNORE, `num_speakers`, `audio_offset_seconds`). UI `SpeakerNamingPanel` in `MeetingsTab.tsx`.
- **Test evidence [V]:** `source-mapping/__tests__/route.test.ts` (4 tests: durability read paths, FAILED on read error, state gate).
- **Security evidence:** neither route had `requireBidAccess` at `ffd5bd1`; hardened in R2 Build 1.
- **Known behavior [V]:** speaker-name application **rewrites `Meeting.transcript` in place** (raw JSON untouched). R2 Build 1's correction layer supersedes this for post-transcription corrections.

### 1.8 Source timestamps
- **Status at ffd5bd1:** PARTIAL — only inside `rawTranscript` JSON + `[HH:MM:SS]` text prefixes; cluster-level aggregates in UI.
- **R2 Build 1:** `MeetingTranscriptSegment.startSec/endSec` are first-class and cited by Meeting Register entries; workspace UI navigates by timestamp. See §6.
- **Next acceptance test:** register entry → click citation → transcript scrolls to segment (component/e2e test locally; visual check on staging).

### 1.9 Transcript correction
- **Status at ffd5bd1:** free-text overwrite only (`PATCH .../meetings/[meetingId]` accepts arbitrary `transcript`), **no versioning, no audit, no segment-level ops**.
- **R2 Build 1:** audited, append-only correction system (rename/reassign/merge/split/mark-unknown/edit-wording) over immutable originals. See §6.2.

### 1.10 Durability-read triggers transcription (GWX-Q07 issue)
- **Status:** CONFIRMED in source; **BLOCKED** on GWX-Q07 (Opus adjudication) for the harness decision
- **Source evidence [V]:** `source-mapping/route.ts` reads stored audio then fire-and-forget POSTs sidecar `/meetings/transcribe` — no read-only probe exists.
- **Rule:** meetings durability-read is UNPROVEN and currently unprovable safely; do not claim otherwise (`verification-evidence.md`).

### 1.11 Durable transcription jobs
- **Status:** DEFERRED (gap, deliberate at ffd5bd1)
- **Source evidence [V]:** `BackgroundJob` declares `meeting_transcription` jobType (`lib/services/jobs/backgroundJobService.ts:15`) but **no code creates one** — the pipeline polls the sidecar's in-memory job store; a sidecar restart loses job state.
- **Next acceptance test:** future card — transcription submits through BackgroundJob with dedupe key.

## 2. Meeting analysis and extraction

### 2.1 8-section AI analysis (Claude via sidecar)
- **Status:** WIRED (local); provider call is live-gated
- **Source evidence [V]:** `analyze/route.ts` → sidecar `/meetings/analyze` → `analyze_meeting_with_context` (`sidecar/services/meeting_intelligence.py:509`, model `claude-sonnet-4-6`) → `parseMeetingAnalysis`/`writeMeetingAnalysis` (`lib/meeting-analysis.ts`). Option A credentials (route resolves `ANTHROPIC_API_KEY` via `getSetting`, forwards per request; sidecar fails loudly without it).
- **Test evidence [V]:** `sidecar/services/__tests__/test_meeting_intelligence.py` (7 tests — credential fail-closed). Parser/writer had no TS tests at ffd5bd1; R2 Build 1 adds projection tests over `parseMeetingAnalysis` output shape.
- **Staging evidence:** none. Exactly ONE controlled Anthropic call has ever been approved repo-wide (`LAST_REAL_SUCCESS`) — it was not a meeting analysis `[V]`.
- **Security evidence [V]:** no meeting stub mode exists; gating is key-presence. Error honesty: invalid extracted rows are dropped, never repaired; `AiUsageLog` rows are written around the provider call only.
- **Blocker:** real analysis requires an approved queue card + per-invocation human approval (GWX-Q16 ladder).
- **Next acceptance test:** one approved staging analysis run on a synthetic meeting; verify honest `AiUsageLog` row + register projection (§3.1).

### 2.2 MeetingActionItem extraction + lifecycle
- **Status:** WIRED + TESTED (promotion path)
- **Source evidence [V]:** §5/§8 of analysis → `writeMeetingAnalysis` (deletes prior AI rows `sourceText != null`, preserves manual); routes `.../action-items` (GET/POST/PATCH/DELETE); promotion `promoteMeetingActionItem` (`lib/services/trackedItems/index.ts:196-271`) with unique source guard.
- **Test evidence [V]:** `lib/services/trackedItems/__tests__/trackedItems.test.ts`, `app/api/bids/[id]/tracked-items/__tests__/routes.test.ts`.
- **Caveat [V]:** no PROPOSED state — AI action items land directly OPEN. Re-analysis deletes/recreates ALL AI-extracted rows regardless of status (promoted items keep their TrackedItem via SetNull). R2 register entries snapshot wording, so the register record survives this.

### 2.3 MeetingCommitment (OPS7)
- **Status:** WIRED + TESTED
- **Source evidence [V]:** schema:4279; extraction §10 with drop-invalid parsing; service `lib/services/meetings/commitments.ts` (PROPOSED→OPEN/DISMISSED→…, OVERDUE derived); routes + `MeetingCommitments.tsx`; freeze discipline (re-analysis replaces PROPOSED only).
- **Test evidence [V]:** `app/api/bids/[id]/meetings/__tests__/commitments.test.ts`.
- **Staging evidence:** none `[UNK]`.

### 2.4 DesignIntentChange (OPS5)
- **Status:** WIRED + TESTED
- **Source evidence [V]:** schema:4257; extraction §9; service `lib/services/meetings/designLog.ts` (PROPOSED→CONFIRMED/DISMISSED; confirm may create TrackedItem); routes + `MeetingDesignLog.tsx`.
- **Test evidence [V]:** `app/api/bids/[id]/meetings/__tests__/designLog.test.ts`.

### 2.5 Extraction rerun after correction (preview + apply)
- **Status at ffd5bd1:** ABSENT (re-analysis existed but wrote immediately, no preview).
- **R2 Build 1:** `MeetingExtractionRun` preview/apply with freeze discipline. See §6.4.

## 3. Meeting Register (R2 Build 1 — new)

### 3.1 Durable Meeting Register
- **Status:** BUILT + TESTED (local; never exercised live)
- **Source evidence [V]:** `MeetingRegisterEntry` (prisma/schema.prisma; migration `20260717010000_r2b1_meeting_register_foundation`); deterministic projection from stored analysis sections (§4→DECISION, §5→ACTION_ITEM bridge, §6→QUESTION, §7→RISK, §9→DESIGN_CHANGE bridge, §10→COMMITMENT bridge) in `lib/services/meetingRegister/registerBuilder.ts`; manual entries for all 11 types.
- **Deliberate scope [V]:** DISCUSSION/CONSTRAINT/SCHEDULE_ITEM/PROCUREMENT_ITEM/INFORMATIONAL are supported end-to-end but only populated manually in Build 1 — extending the analysis prompt with a dedicated register section is DEFERRED (provider-contract change; unverifiable locally).
- **Test evidence [V]:** `lib/services/meetingRegister/__tests__/*` (see report for counts).
- **Staging evidence:** none — never exercised live.
- **Next acceptance test:** approved staging analysis of a synthetic meeting produces PENDING register entries; disposition + promotion round-trip.

### 3.2 Human disposition
- **Status:** BUILT + TESTED (local)
- **Source evidence [V]:** reviewState machine PENDING → CONFIRMED | CORRECTED | MERGED | DUPLICATE | DISMISSED_WITH_REASON | DISCUSSION_ONLY | INFORMATIONAL | PROMOTED_TO_OPERATIONS in `lib/services/meetingRegister/register.ts`; append-only `MeetingRegisterEntryRevision` history; fully-reviewed gate blocks minutes publication while extracted entries are PENDING.

### 3.3 Operations Register promotion + cross-meeting continuity
- **Status:** BUILT + TESTED (local)
- **Source evidence [V]:** `lib/services/meetingRegister/promotion.ts` — promotes with full provenance (sourceKind `meeting_register`, unique `sourceMeetingRegisterEntryId`, evidence excerpt, locator, speaker, timestamps); linking allows many entries across meetings → one TrackedItem; promotion never removes the register entry; `relatedPriorEntryId` chains prior-meeting items.

## 4. Minutes

### 4.1 Draft/published minutes + amendments
- **Status at ffd5bd1:** ABSENT — no minutes model; `Meeting.reviewStatus` existed but no route drove IN_REVIEW/PUBLISHED; "minutes" appeared only as a PDF button label (`MeetingsTab.tsx:1838` → sidecar WeasyPrint, 501 when absent).
- **R2 Build 1:** BUILT + TESTED — immutable `MeetingMinutesRevision` snapshots, publish gate (no undispositioned extracted entries), amendments supersede with reason, prior revisions immutable. See §6.5.
- **Next acceptance test:** staging publish → amend → verify both revisions retrievable and prior unchanged.

### 4.2 Minutes PDF export
- **Status:** SCAFFOLD→WIRED (sidecar-dependent)
- **Source evidence [V]:** `.../export-pdf/route.ts` → sidecar WeasyPrint; 501/503 handled when sidecar/WeasyPrint absent.
- **Staging evidence:** none `[UNK]`.

## 5. Consultant reports / field reports / response loop (Build 2/3 context)

### 5.1 ConsultantReport / Revision / Observation / Disposition (OPS3/4)
- **Status:** WIRED + TESTED (local); guarded (`requireBidAccess` on all routes at this tree — the `1e188dc` regressions are NOT present here `[V]`)
- **Source evidence [V]:** schema:4101-4215; routes under `app/api/bids/[id]/consultant-reports/**`; content-addressed immutable revisions (`@@unique([bidId, checksum])`); append-only disposition records (client-extension enforced).
- **Test evidence [V]:** 6 route test files + service tests (see audit).
- **Naming [V]:** "Architect Field Report" / "Engineer Field Report" live as `ConsultantReport.reportType` values — naming preserved per R2 rule 13.

### 5.2 FieldReport (OPS2, job-site/daily reports)
- **Status:** WIRED + TESTED (routes) — **security gap**
- **Source evidence [V]:** schema:4064; routes `app/api/bids/[id]/field-reports/**` incl. upload/download; human-only item creation (kind FIELD_ITEM); `parseStatus` UNPARSED-only placeholder vocabulary.
- **Security evidence [V]:** **ALL field-report routes lack `requireBidAccess`**, including blob-serving download. NOT fixed in Build 1 (meeting scope); MUST be fixed in Build 2 before any field-report work ships. Recorded as the top Build 2 precondition.
- **Test evidence [V]:** `app/api/bids/[id]/field-reports/__tests__/routes.test.ts`.

### 5.3 Formal response
- **Status:** WIRED + TESTED — single-value, not revisioned
- **Source evidence [V]:** `TrackedItem.formalResponse{,By,At,Prior}` (schema:3998-4006); `setFormalResponse` (`lib/services/consultantReports/formalResponse.ts`, 4000-char cap, audited with bounded prior/new). One prior value on-row; full history in AuditEvent only.
- **Gap [V]:** no immutable response revisions, no transmittal, no recipient/delivery record — that is Build 2/3 scope by design.

### 5.4 Trade/contractor response packages, secure external response, transmittal, originator disposition, closure
- **Status:** ABSENT (DEFERRED to Builds 2/3)
- **Source evidence [V]:** zero matches for transmittal/external-response-token/portal concepts in app code. `TrackedItem` FSM (OPEN|IN_PROGRESS|READY_TO_CLOSE|CLOSED|WAIVED, `fsm.ts`) has no response-loop states.
- **Contracts frozen [V]:** see `docs/architecture/R2_MEETING_RESPONSE_CONTROL_LOOP.md` Parts D/E (Build 2/3 contracts).

### 5.5 Consultant stream PDF export (OPS6)
- **Status:** WIRED + TESTED (sidecar-dependent)
- **Source evidence [V]:** `lib/services/consultantReports/streamExport.ts` (caps 500 obs / 2MB payload, SSE route, per-bid in-flight lock, content-addressed export rows).

## 6. R2 Build 1 additions (this branch)

All statuses here are **BUILT + TESTED, local-only, never exercised live**. Migration is forward-only, additive, unapplied to any real DB.

| # | Capability | Key source |
|---|---|---|
| 6.1 | Transcript segment materialization (immutable originals + correction overlay) | `lib/services/meetingRegister/segments.ts`, `MeetingTranscriptSegment` |
| 6.2 | Audited diarization/transcript corrections (rename, reassign one/all, merge, split, mark-unknown, wording edit; author/time/reason; affected-derived report) | `lib/services/meetingRegister/corrections.ts`, `MeetingTranscriptCorrection` (append-only) |
| 6.3 | Meeting Register (11 entry types, provenance, confidence, review state) | `lib/services/meetingRegister/register.ts`, `registerBuilder.ts`, `MeetingRegisterEntry` (+ append-only revisions) |
| 6.4 | Extraction rerun preview/apply (freeze discipline: dispositioned entries never touched) | `lib/services/meetingRegister/extractionRuns.ts`, `MeetingExtractionRun` |
| 6.5 | Minutes publish/amend with immutable revisions + publish gate | `lib/services/meetingRegister/minutes.ts`, `MeetingMinutesRevision` |
| 6.6 | Promotion/link into TrackedItem with full provenance; cross-meeting continuity | `lib/services/meetingRegister/promotion.ts` |
| 6.7 | Meeting workspace UI (transcript review, corrections, register review/filters, timestamp nav, promotion, minutes, coverage) | `app/bids/[id]/MeetingRegisterPanel.tsx`, `TranscriptReviewPanel.tsx`, `MeetingMinutesPanel.tsx` |
| 6.8 | Meeting-core route hardening (`requireBidAccess` on every meeting read/mutation) | all routes under `app/api/bids/[id]/meetings/**` |

## 7. Security posture summary (this tree)

- Guarded at ffd5bd1 `[V]`: consultant-reports (all), commitments, design-changes, tracked-items formal-response/link-observation, alerts (not on this branch).
- Unguarded at ffd5bd1 `[V]`: all meeting-core routes; all field-report routes.
- R2 Build 1 `[V]`: every meeting-core + new register/correction/minutes route now runs `requireBidAccess` before body parsing or service work; denied-access + cross-bid tests added.
- Outstanding `[V]`: field-report routes (Build 2 precondition); sidecar endpoints' service-to-service auth optional (fail-open when `SIDECAR_API_KEY`/`WHISPERX_API_KEY` unset) — deploy-gate item; `AUTH_DISABLED` production fence exists in `lib/env.ts` `[V]`.
- The `gwx/phase1a-ai-extraction` (`1e188dc`) regressions do not exist on this branch `[V]`; Build 1 adds none (denied-access tests assert it).
