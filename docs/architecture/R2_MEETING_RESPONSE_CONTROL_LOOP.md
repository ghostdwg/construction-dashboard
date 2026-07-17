# R2 — Meeting-to-Response Control Loop: Domain Contract

Status: **FROZEN** (Build 1 implemented on this branch; Builds 2/3 contracts frozen below)
Authored: 2026-07-17 at `ffd5bd1` base · Branch: `gwx/r2-meeting-response-control-loop`
Amended: 2026-07-17 — Codex release-gate remediation (rerun supersession
lifecycle, transaction/audit policy, segment provenance, sourceKind
vocabulary). Amendments are marked **[R2-REM]** inline.
Companion: `docs/architecture/CAPABILITY_LEDGER.md` (what actually exists, with evidence)

This document is the binding domain contract for the R2 line. Subsequent
build lanes implement against it; they do not re-derive it. Changes require
an explicit operator decision recorded in `~/gwx-ops/DECISIONS.md`.

---

## Part A — Binding rules (verbatim from the R2 mission)

1. Every meeting has a durable Meeting Register.
2. Meeting Register entries persist even when not operationally promoted.
3. TrackedItem remains the Operations Register.
4. No competing task/register system is created.
5. Original audio and raw transcript remain immutable.
6. Corrections are audited revisions or overlays.
7. Meeting extraction can be rerun after correction.
8. Users preview downstream effects before applying a rerun.
9. Previously published minutes remain revisioned.
10. One Operations Register item may collect continuity from multiple meetings.
11. Every extracted Meeting Register item receives a human disposition.
12. Only accountable items require Operations Register promotion.
13. "Architect Field Report" and "Engineer Field Report" naming is preserved.
14. Consultant target dates remain separate from contractor/GC due dates.
15. No response closes merely because it was transmitted.

Repo conventions that bind every model below: status vocabularies are
**app-validated strings, never Prisma enums**; history is **append-only
records**, corrections append rather than mutate; `bidId` is denormalized
onto child rows for tenancy scoping; unknown/foreign ids return 404
(indistinguishable from out-of-tenancy); every mutation route runs
`requireBidAccess(bidId)` before body parsing or service work.

**[R2-REM] Audit policy (binding for this release):** domain
revision/history rows are the detailed operational record; the AuditEvent
row is ALSO mandatory for every accountability-relevant mutation
(transcript/speaker corrections and merges, register dispositions —
including merge/duplicate/dismissal, edits, manual creation, Operations
Register promotion/linking, extraction-run preview/apply/discard, minutes
publication and amendment). The AuditEvent is written INSIDE the same
database transaction as the mutation; an audit failure rolls the mutation
back — never fail-open. Stdout/Loki telemetry is emitted only after commit.
Audit payloads carry ids/counts/labels (bidId, meetingId, registerEntryId,
revision id, source extraction run, actor) — never transcript or entry
text; detailed text lives in the domain revision records.
Implementation: `lib/services/meetingRegister/txAudit.ts` over
`lib/observability/audit.ts` (`buildAuditEnvelope` / `persistAuditEnvelope`
/ `emitAuditEnvelopeStdout`).

**[R2-REM] Provenance validation:** any manually supplied `segmentId`
(register manual create; correction ops) is validated segment → meeting →
bid AFTER `requireBidAccess` and BEFORE any mutation. Nonexistent,
cross-meeting and cross-bid ids all fail with the same response — a probe
learns nothing about foreign segments.

## Part B — Entity relationship contract (Build 1 domain)

### B.1 Source layer (immutable)

```
Meeting 1──1 audio blob            (Meeting.audioStorageKey → BlobStore; original bytes never rewritten by app code)
Meeting 1──1 rawTranscript JSON    (Meeting.rawTranscript — IMMUTABLE after transcription completes)
Meeting 1──1 vttContent            (hybrid only; source artifact)
```

- `Meeting.rawTranscript` (WhisperX/AssemblyAI JSON, `segments[{speaker,text,start,end}]`)
  is the immutable transcription record. **No R2 code path updates it.**
- `Meeting.transcript` (display text) is a legacy denormalized projection;
  R2 treats it as derived output, regenerated from segments after corrections.

### B.2 Segment / correction layer (overlay over immutable source)

```
Meeting 1──* MeetingTranscriptSegment      (materialized projection of rawTranscript)
Meeting 1──* MeetingTranscriptCorrection   (APPEND-ONLY audit log of every correction)
MeetingTranscriptSegment *──1 MeetingParticipant?   (resolved current speaker)
```

- `MeetingTranscriptSegment` carries **frozen** `originalSpeakerLabel` /
  `originalText` (copied once at materialization from the raw JSON) plus the
  **current** overlay `currentSpeakerLabel` / `currentText` /
  `isUnknownSpeaker` / `participantId`. Original columns are never updated;
  the raw JSON is additionally untouched, so immutability is double-recorded.
- Materialization is deterministic and idempotent (`segmentIndex` from raw
  order; re-materialization is a no-op when rows exist). Manual/pasted
  transcripts materialize from `[HH:MM:SS] Speaker: text` lines when raw
  JSON is absent.
- Split support: a split deactivates the original row (`isActive=false`,
  retained forever) and inserts replacement rows with `splitFromSegmentId`
  provenance and fractional `sortKey` ordering. Citations that reference the
  deactivated row keep resolving.
- Every correction (RENAME_SPEAKER, REASSIGN_SEGMENT, REASSIGN_ALL_MATCHING,
  MERGE_SPEAKERS, SPLIT_SEGMENT, MARK_UNKNOWN, EDIT_TEXT) appends one
  `MeetingTranscriptCorrection` row: author (required), reason, bounded
  before/after values, affected segment count, and the ids of derived
  objects (register entries, action items, commitments, design changes)
  whose attribution/citation overlaps the corrected span. No update or
  delete path exists for correction rows.
- **[R2-REM] Atomicity:** the overlay mutation, the correction-history row,
  the derived display-transcript rebuild and the mandatory AuditEvent row
  run in ONE database transaction for every op (segment text edit, speaker
  reassignment one/all, speaker merge, unknown-speaker marking, split). If
  any write fails, the whole correction rolls back: no correction exists
  without its history record and no history record claims a correction that
  did not occur. The original transcript value remains recoverable from the
  frozen original* columns and raw JSON.

### B.3 Participant / diarization identity

```
diarization label ("SPEAKER_2")  →  MeetingParticipant.speakerLabel  →  ProjectContact?
```

- Diarization identity = the label; participant identity = the
  `MeetingParticipant` row; person identity = optional `ProjectContact`.
- RENAME_SPEAKER changes participant naming; MERGE_SPEAKERS folds one label's
  segments into another and marks the orphaned participant merged; both are
  corrections (audited), never destructive to original labels (original
  labels persist in `originalSpeakerLabel` and raw JSON).

### B.4 Meeting Register layer

```
Meeting 1──* MeetingRegisterEntry
MeetingRegisterEntry *──1 MeetingTranscriptSegment?   (anchor citation)
MeetingRegisterEntry 1──* MeetingRegisterEntryRevision (APPEND-ONLY history)
MeetingRegisterEntry *──1 MeetingActionItem?     (bridge: linkedActionItemId)
MeetingRegisterEntry *──1 MeetingCommitment?     (bridge: linkedCommitmentId)
MeetingRegisterEntry *──1 DesignIntentChange?    (bridge: linkedDesignChangeId)
MeetingRegisterEntry *──1 TrackedItem?           (ops link: linkedTrackedItemId)
MeetingRegisterEntry *──1 MeetingRegisterEntry?  (mergedIntoEntryId)
MeetingRegisterEntry *──1 MeetingRegisterEntry?  (relatedPriorEntryId — prior-meeting continuity)
```

- **Entry types (exactly):** DISCUSSION, DECISION, QUESTION, ACTION_ITEM,
  COMMITMENT, DESIGN_CHANGE, RISK, CONSTRAINT, SCHEDULE_ITEM,
  PROCUREMENT_ITEM, INFORMATIONAL.
- **Preserved per entry:** meeting, agenda topic, raw source wording
  (`rawSourceText`, frozen at creation), normalized wording
  (`normalizedText`, human-editable, audited), speaker label + name,
  timestamp range (`startSec`/`endSec`), source citation string, anchor
  segment, participants (JSON name list), responsible party, due date,
  confidence, review state, prior-meeting relation, linked Operations
  Register item, revision history.
- **Origins:** `ai_extraction` (projection of analysis), `manual`
  (human-authored, lands CONFIRMED), and bridge origins
  (`action_item_bridge`, `commitment_bridge`, `design_change_bridge`).
- **Reconciliation with existing meeting objects (rule 4 — no duplicate
  system):** MeetingActionItem, MeetingCommitment and DesignIntentChange
  remain the operational lifecycle objects (their own status machines,
  services and UI are unchanged). The Meeting Register entry for one of
  those is a **bridge entry**: it is the durable historical register record
  (wording, citation, disposition) and *links* to the lifecycle row; it
  never mirrors that row's lifecycle. If a rerun replaces a PROPOSED
  lifecycle row, a dispositioned bridge entry keeps its own frozen wording
  and survives with the link nulled (SetNull) — the register record is
  never lost (rule 2).
- **Disposition (rule 11):** every extracted entry starts PENDING and must
  receive exactly one of: CONFIRMED, CORRECTED, MERGED, DUPLICATE,
  DISMISSED_WITH_REASON, DISCUSSION_ONLY, INFORMATIONAL,
  PROMOTED_TO_OPERATIONS. DISMISSED_WITH_REASON requires a reason; MERGED
  and DUPLICATE require the surviving entry id; CORRECTED records the
  edited normalized wording. Dispositions append revision rows; a
  disposition may be superseded by appending (never by rewriting history).
- **[R2-REM] SUPERSEDED (machine lifecycle, never a human disposition):**
  when an applied rerun no longer produces a PENDING machine-origin entry,
  that entry is marked `reviewState = SUPERSEDED` and RETAINED FOREVER with
  `supersededByRunId` (the replacing run), `supersededByEntryId` (the
  replacement entry where a deterministic match exists), `supersededAt`,
  and an append-only `RERUN_SUPERSEDE` revision row. Superseded entries
  keep their previous wording, classification, speaker, citation and
  originating extraction run; they are excluded from active lists, coverage
  totals and the fully-reviewed gate (query them with
  `includeSuperseded=true` or `reviewState=SUPERSEDED`), and they cannot be
  edited, dispositioned, promoted or linked. Dispositioned, linked or
  promoted entries are NEVER superseded.
- **Fully-reviewed gate:** a meeting cannot publish minutes (and reports
  "unreviewed" coverage) while any extracted (non-manual-origin) entry is
  PENDING.

### B.5 Extraction runs (rules 7–8)

```
Meeting 1──* MeetingExtractionRun (PREVIEWED → APPLIED | DISCARDED)
```

- The first analysis writes directly (initial population, no preview
  needed) and records an APPLIED run. Every subsequent analysis lands as a
  PREVIEWED run holding the parsed analysis JSON.
- **[R2-REM] Reconciliation is deterministic, idempotent and
  NON-DESTRUCTIVE — apply never deletes a register entry.** The preview
  (and the apply, which recomputes the identical reconcile) reports five
  outcomes per entry/draft:
  - **create** — a draft with no existing counterpart becomes a new entry;
  - **unchanged** — an identical re-extraction (same type + same raw source
    wording) keeps the existing PENDING entry, its id, its originating run
    and its state (bridge links are refreshed to the rewritten lifecycle
    rows);
  - **supersede** — a PENDING machine-origin entry the new analysis no
    longer produces is marked SUPERSEDED and retained (see B.4), with the
    replacement entry recorded when the same type + anchor segment matches;
  - **merge** — two or more PENDING entries collapsing onto one draft are
    all superseded by that one created entry;
  - **preserve** — dispositioned/linked/promoted entries are never touched.
  Applying the same analysis twice yields only `unchanged` outcomes;
  re-applying an APPLIED run is rejected.
- APPLY (human) executes in ONE transaction: lifecycle rows via the
  existing writer (PROPOSED-replacement discipline), the non-destructive
  register reconcile above, the run flip to APPLIED, and the mandatory
  AuditEvent row. DISCARD keeps the run row for the audit trail.

### B.6 Minutes (rule 9)

```
Meeting 1──* MeetingMinutesRevision   (revisionIndex 0..n; IMMUTABLE once created)
MeetingMinutesRevision *──1 MeetingMinutesRevision? (supersedesRevisionId, set-once)
```

- Draft = the live Meeting fields + current register state. PUBLISH
  snapshots summary, key decisions, open issues, red flags, participants,
  the register entries (id, type, state, wording, citation), and the
  correction count into `contentJson`, frozen forever. Publishing requires
  the fully-reviewed gate and a session actor; it sets
  `Meeting.reviewStatus = "PUBLISHED"` + `publishedAt`.
- AMEND creates revision n+1 with a required `amendmentReason` and
  `supersedesRevisionId`; prior revisions are never edited or deleted.
  Corrected speaker/transcript provenance is visible because each snapshot
  embeds the correction count and register state at publish time.

### B.7 Operations Register (rules 3, 10, 12)

```
MeetingRegisterEntry *──1 TrackedItem   (many entries, across meetings, → one item)
TrackedItem.sourceMeetingRegisterEntryId  (unique — the ONE originating entry when promoted)
```

- TrackedItem remains the single Operations Register (kind/status/fsm.ts
  untouched). Promotion from a register entry creates a TrackedItem with
  full provenance: `sourceKind = "meeting_register"`, unique originating
  entry id, source meeting, transcript citation (`sourceLocator` =
  timestamp + speaker), original wording (`evidenceExcerpt`), normalized
  action (title/description), responsible party, due date, trade where
  known, explicit `extractionMethod`. Promotion sets the entry's state to
  PROMOTED_TO_OPERATIONS and `linkedTrackedItemId` — the entry itself is
  never deleted or moved (rule 2 / "promotion must not remove").
- **[R2-REM] `TrackedItem.sourceKind` canonical vocabulary** (single source
  of truth: `lib/services/trackedItems/sourceKinds.ts`): `manual`,
  `meeting_action_item`, `meeting_design_change`, `meeting_register`,
  `consultant_observation`, `field_report`. Every writer imports the
  constants — no string literals. Legacy values on existing rows
  (`meeting`, `consultant_report`, `spec_section`) remain readable forever
  and are NEVER rewritten (no destructive backfill) and never re-emitted by
  new code. UI labels/grouping resolve through the same module.
- LINK (without creating) attaches an entry to an existing TrackedItem —
  this is how one Operations item collects continuity from multiple
  meetings; chronology is preserved by the entries' meeting dates and
  `relatedPriorEntryId` chains.
- Only accountable items (ACTION_ITEM, COMMITMENT, DESIGN_CHANGE, RISK,
  and any entry a human judges accountable) get promoted; DISCUSSION_ONLY /
  INFORMATIONAL dispositions exist precisely so the rest stay meeting-local
  (rule 12).

### B.8 Consultant / field-report layer (context for Builds 2–3)

Existing, unchanged in Build 1: `ConsultantReport` (reportType preserves
ARCHITECT_FIELD_REPORT / ENGINEER_FIELD_REPORT naming — rule 13) →
`ConsultantReportRevision` (immutable files) → `ConsultantObservation`
(ENTERED → accepted/dismissed; verbatim fields freeze) →
`ConsultantDispositionRecord` (append-only) → TrackedItem (originating +
supporting links). `ConsultantObservation.consultantTargetDate` is never
synced with `TrackedItem.dueDate` (rule 14). `FieldReport` = job-site
source evidence; items are human-created TrackedItems citing it.

---

## Part C — Build 1 route contract (implemented on this branch)

All routes: `requireBidAccess(bidId)` first, before body parsing. Cross-bid
ids → 404. Session actor required for every disposition/correction/publish.

```
GET/POST  /api/bids/[id]/meetings/[meetingId]/register              list (filter: entryType, reviewState, includeSuperseded) / manual create (segmentId provenance-validated)
PATCH     /api/bids/[id]/meetings/[meetingId]/register/[entryId]    edit normalized fields (audited)
POST      /api/bids/[id]/meetings/[meetingId]/register/[entryId]/disposition   {disposition, reason?, targetEntryId?}
POST      /api/bids/[id]/meetings/[meetingId]/register/[entryId]/promote       create TrackedItem (provenance)
POST      /api/bids/[id]/meetings/[meetingId]/register/[entryId]/link          {trackedItemId} link existing
GET       /api/bids/[id]/meetings/[meetingId]/register/coverage     disposition coverage counts + fully-reviewed flag
GET       /api/bids/[id]/meetings/[meetingId]/segments              materialize-on-first-read + list
GET/POST  /api/bids/[id]/meetings/[meetingId]/segments/corrections  history / apply one correction op
GET       /api/bids/[id]/meetings/[meetingId]/extraction-runs       list runs
GET       /api/bids/[id]/meetings/[meetingId]/extraction-runs/[runId]          preview detail (diff)
POST      /api/bids/[id]/meetings/[meetingId]/extraction-runs/[runId]/apply    human apply
POST      /api/bids/[id]/meetings/[meetingId]/extraction-runs/[runId]/discard
GET/POST  /api/bids/[id]/meetings/[meetingId]/minutes               list revisions / publish or amend
```

Hardened pre-existing meeting routes (guard added, behavior otherwise
unchanged): `meetings`, `meetings/[meetingId]`, `upload`, `upload-hybrid`,
`status`, `analyze`, `action-items`(+`[itemId]`), `participants/[participantId]`,
`speaker-mapping`, `source-mapping`, `export-pdf`.

---

## Part D — Build 2 contract (FROZEN): Field Reports & Trade Response

**Precondition (blocking):** add `requireBidAccess` to every
`app/api/bids/[id]/field-reports/**` route (including download) with
denied-access tests — the audit found them unguarded.

### D.1 New models

```prisma
// GC/job-site observation extracted BY A HUMAN from a FieldReport or
// consultant report revision, or entered directly. Mirrors
// ConsultantObservation discipline: verbatim fields freeze on leaving OPEN review.
model ReportObservation {
  id              Int      @id @default(autoincrement())
  bidId           Int
  sourceKind      String   // field_report | consultant_report | direct_entry
  fieldReportId   Int?     // exactly one source set; app-enforced
  consultantReportId Int?
  observationText String
  sourceLocator   String?  // page/photo ref, verbatim
  observedAt      DateTime?
  disposition     String   @default("OPEN") // OPEN | ACCEPTED | DISMISSED_WITH_REASON | DUPLICATE | INFORMATIONAL
  dispositionBy   String?
  dispositionAt   DateTime?
  dispositionReason String?
  registerItemId  Int?     // TrackedItem linkage (supporting)
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// Trade grouping on the Operations item (additive columns on TrackedItem):
//   leadTradeId Int?          — lead trade
//   responsibleContractorId Int?  (Subcontractor FK)
//   gcInternalResponsibility Boolean @default(false)
//   consultantDiscipline String?  // architect | engineer | other, display-only
// Supporting trades:
model TrackedItemTradeAssignment {
  id            Int    @id @default(autoincrement())
  trackedItemId Int
  tradeId       Int
  role          String @default("SUPPORTING") // LEAD | SUPPORTING
  @@unique([trackedItemId, tradeId])
}

// Contractor response package — a bundle of TrackedItems issued to one
// contractor. Preserves original numbering via the member rows.
model ResponsePackage {
  id             Int      @id @default(autoincrement())
  bidId          Int
  packageNumber  Int      // per-bid sequence
  title          String
  contractorId   Int?     // Subcontractor; null = internal GC package
  status         String   @default("DRAFT")
  // DRAFT → ISSUED → RESPONSES_IN → GC_REVIEW → READY_TO_TRANSMIT → (Build 3: TRANSMITTED...)
  // Exception states: OVERDUE (derived at read, never stored), VOIDED
  issuedAt       DateTime?
  issuedBy       String?
  responseDueDate DateTime?   // contractor/GC due date — NEVER the consultant target date (rule 14)
  voidedBy       String?
  voidedAt       DateTime?
  createdBy      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model ResponsePackageItem {
  id            Int    @id @default(autoincrement())
  packageId     Int
  bidId         Int
  trackedItemId Int
  displayNumber String? // original meeting/report numbering, verbatim
  @@unique([packageId, trackedItemId])
}

// Immutable contractor response revision. NO update path — a change is a
// new revision. External or manually-entered-by-GC (channel preserved).
model TradeResponseRevision {
  id             Int      @id @default(autoincrement())
  bidId          Int
  packageItemId  Int
  revisionIndex  Int      @default(0)
  responderName  String
  responderCompany String?
  channel        String   @default("PORTAL") // PORTAL | EMAIL | PROCORE | OTHER (manual entry preserves source)
  responseType   String   // COMPLETED | PROPOSED_DATE | CLARIFICATION_REQUESTED | DISPUTED | NOT_APPLICABLE
  responseText   String
  proposedCompletionDate DateTime?
  actualCompletionDate   DateTime?
  submittedAt    DateTime @default(now())
  enteredBy      String?  // GC user when manually entered; null for portal
  gcReview       String   @default("PENDING") // PENDING | ACCEPTED_FOR_TRANSMITTAL | RETURNED_FOR_REVISION
  gcReviewBy     String?
  gcReviewAt     DateTime?
  gcCommentary   String?  // separate GC commentary, never merged into responseText
  @@unique([packageItemId, revisionIndex])
}

model TradeResponseAttachment {
  id                 Int    @id @default(autoincrement())
  responseRevisionId Int
  bidId              Int
  storageKey         String // plan-room/jobs/{bidId}/response-packages/{packageId}/{safeName} — project-scoped
  fileName           String
  mimeType           String // allowlist: jpeg/png/webp/pdf
  byteSize           Int
  createdAt          DateTime @default(now())
}

// Secure external access — token grants access to EXACTLY ONE package.
model ResponseAccessToken {
  id           String   @id @default(cuid())
  bidId        Int
  packageId    Int
  tokenHash    String   @unique  // sha-256 of the secret; raw token NEVER stored
  contractorEmail String?
  expiresAt    DateTime            // fail-closed on expiry
  revokedAt    DateTime?           // fail-closed on revocation
  createdBy    String
  createdAt    DateTime @default(now())
  lastUsedAt   DateTime?
}
```

### D.2 Status machine (package)

`DRAFT → ISSUED → RESPONSES_IN → GC_REVIEW → READY_TO_TRANSMIT` (+
`VOIDED` from any pre-transmit state; `OVERDUE`/`NO_RESPONSE` derived at
read from `responseDueDate` and revision absence — never stored).
Transitions are human-only, service-enforced, audited; `ISSUED` requires
≥1 item and (for external packages) a generated token or recorded manual
channel.

### D.3 Route contract

```
POST /api/bids/[id]/field-reports/[fieldReportId]/observations           create observation
POST /api/bids/[id]/observations/[obsId]/disposition                     human disposition
POST /api/bids/[id]/observations/[obsId]/promote|link                    into TrackedItem
POST /api/bids/[id]/response-packages                                    create DRAFT
POST /api/bids/[id]/response-packages/[pkgId]/items                      add/remove items
POST /api/bids/[id]/response-packages/[pkgId]/issue                      → ISSUED (+ token mint, hash stored)
POST /api/bids/[id]/response-packages/[pkgId]/revoke-token
POST /api/bids/[id]/response-packages/[pkgId]/items/[itemId]/responses   GC manual entry (channel != PORTAL)
POST /api/bids/[id]/response-packages/[pkgId]/items/[itemId]/responses/[revId]/gc-review
GET/POST /api/external/response/[token]/**                               token wall: hash-match + not expired/revoked
                                                                          → package items only; submit creates revision
```

External routes: no session; token is the sole credential; token grants
read of the package's items (title, description, locator, due date —
**never** pricing, sub lists, or other bids' data) and response submission.
Expired/revoked/unknown token → 404. Rate-limited. Every use stamps
`lastUsedAt` and emits an audit event.

### D.4 Acceptance tests (freeze)

1. Field-report routes reject non-owner (401/403/404 matrix).
2. Observation disposition freeze: verbatim fields immutable after leaving OPEN.
3. Package issue requires items; due date is contractor date (consultant target date untouched on linked items).
4. Response revision immutability: second submission = revisionIndex 1; revision 0 byte-identical.
5. Token: expired → 404; revoked → 404; valid → only that package's items; cross-package/cross-bid probe → 404.
6. GC review states gate transmittal readiness; RETURNED_FOR_REVISION notifies (Build 3 wiring).
7. Attachment isolation: token cannot fetch another bid's storage keys.
8. Manual-channel entry preserves channel + enteredBy.

## Part E — Build 3 contract (FROZEN): Originator Return & Closure

### E.1 New models

```prisma
// Compiled response package returned to the original sender.
model CompiledResponse {
  id            Int      @id @default(autoincrement())
  bidId         Int
  packageId     Int
  revisionIndex Int      @default(0)  // revise-and-resubmit increments; immutable rows
  storedKey     String   // branded PDF: plan-room/jobs/{bidId}/compiled-responses/{sha256}.pdf
  sha256        String
  byteSize      Int
  compiledBy    String
  compiledAt    DateTime @default(now())
  @@unique([packageId, revisionIndex])
}

// Durable transmittal record. Transmission NEVER closes anything (rule 15).
model Transmittal {
  id                 Int      @id @default(autoincrement())
  bidId              Int
  compiledResponseId Int
  transmittalNumber  Int      // per-bid sequence
  recipientName      String   // original architect/engineer/owner/consultant/GC reviewer
  recipientEmail     String?
  method             String   // EMAIL | PORTAL | PROCORE | HAND | OTHER
  sentBy             String
  sentAt             DateTime @default(now())
  note               String?
}

// Originator disposition — append-only; current = latest by (disposedAt, id).
model OriginatorDisposition {
  id                 Int      @id @default(autoincrement())
  bidId              Int
  transmittalId      Int
  disposition        String   // ACCEPTED | ACCEPTED_WITH_FOLLOW_UP | REVISE_AND_RESUBMIT | REJECTED | FIELD_VERIFICATION_REQUIRED | INFORMATIONAL
  dispositionText    String?
  disposedByName     String   // originator identity as recorded by GC
  recordedBy         String   // GC session actor
  disposedAt         DateTime @default(now())
}

// Closure evidence on TrackedItem (additive columns):
//   closureEvidenceJson String @default("[]")  // attachment ids / completion refs
//   closedViaPackageId Int?                    // the package whose acceptance closed it
```

### E.2 Status machine (full loop, package-level)

```
READY_TO_TRANSMIT → TRANSMITTED → ORIGINATOR_REVIEW
  → ACCEPTED            → CLOSED (explicit human closure with evidence; audited)
  → REVISE_AND_RESUBMIT → GC_REVIEW (new CompiledResponse revision; loop)
Exception states: DISPUTED, NO_RESPONSE, BLOCKED, VOIDED (human-set; OVERDUE derived)
```

Rule 15 is enforced in the service: TRANSMITTED can never transition
directly to CLOSED; ORIGINATOR_REVIEW requires a recorded
OriginatorDisposition; CLOSED requires an ACCEPTED-class disposition +
actor + (configurably) completion evidence. Item-level TrackedItem closure
stays governed by `fsm.ts` — package closure proposes, a human executes.

### E.3 Route contract

```
POST /api/bids/[id]/response-packages/[pkgId]/compile      → CompiledResponse rev N (sidecar PDF, content-addressed)
POST /api/bids/[id]/response-packages/[pkgId]/transmit     → Transmittal + status TRANSMITTED
POST /api/bids/[id]/transmittals/[tid]/disposition          record originator disposition (append-only)
POST /api/bids/[id]/response-packages/[pkgId]/close         explicit closure (ACCEPTED disposition required)
GET  /api/bids/[id]/response-packages/[pkgId]/audit         full loop audit report
```

### E.4 Acceptance tests (freeze)

1. Compile produces immutable revision; recompile after revise-and-resubmit increments, never overwrites.
2. Transmit records transmittal and does NOT close (attempting close without disposition → error).
3. REVISE_AND_RESUBMIT reopens GC_REVIEW and permits new trade response revisions.
4. ACCEPTED + human close → CLOSED with evidence; audit trail complete (source meeting → register entry → item → package → response revisions → transmittal → disposition → closure).
5. Cross-bid/denied-access matrix over every new route.
6. Staging certification checklist = the Completion standard list in `~/gwx-ops/CURRENT_GOAL.md` (synthetic scenarios; human-gated).

---

## Part F — Explicitly out of scope for R2 code (governance)

- No real provider calls, migrations against real DBs, deploys, or staging
  contact from model sessions — all human-gated per repo rules.
- The GWX-Q07 durability-read hazard (reading meeting audio triggers
  transcription) is adjudicated outside R2; Build 1 does not touch the
  source-mapping trigger path.
- Sidecar/GPU-worker service-to-service auth hardening is a deploy-gate
  item tracked in the Capability Ledger, not an R2 build deliverable.
