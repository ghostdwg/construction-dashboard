# R2 Build 3 — Response Control Loop: Implementation-Ready Contract

Status: **FROZEN** — authored 2026-07-18 on `gwx/r2-build3-contract-freeze`
(base `c1312a7`) under the operator mission
`20260718T163033Z-r2-build3-contract-freeze.md`.
Supersedes: `docs/architecture/R2_MEETING_RESPONSE_CONTROL_LOOP.md` **Part E**
(the Build 3 skeleton). Part D (Build 2) is superseded where noted by the
**accepted SOL implementation** at `43449a1` (integrated at `9b283b9` on
`gwx/sol-r2-ledger-integration`); this contract treats that implementation as
the Build 2 ground truth.
Changes to this contract require an explicit operator decision.

Sources reviewed before freezing (inventory in §22):
Build 1 + remediation report, Build 2 security-hardening report, shared-base
remediation report, field-response certification report, SOL trade-response
implementation + review reports, SOL integration report, the integrated
security review, the R2 architecture doc, and the live schema/service code on
`gwx/sol-trade-response-packages` and this branch.

---

## 0. Scope

Build 3 completes the Meeting-to-Response Control Loop **after**
`READY_TO_TRANSMIT` (where Build 2 stops):

- compiled response packages (immutable, content-addressed);
- transmittals to the originator (immutable, per-bid numbered);
- originator disposition capture (append-only), including
  accepted-with-comments and revise-and-resubmit;
- the revise-and-resubmit cycle back through contractor response / GC review;
- accepted responses, closure eligibility, human closure with evidence;
- reopening;
- immutable full-loop history and the provenance chain back to Meeting
  Register entries, Report Observations, and Tracked Items.

The two-object model is preserved verbatim: **Meeting/Register (and report
observation) source objects → TrackedItem operational control**. Build 3 adds
correspondence-loop objects around packages; it creates no competing register
(Binding rules 3–4) and never closes anything merely because it was
transmitted (Binding rule 15). Human approval remains required for promotion,
disposition, and closure — no system-initiated transition exists anywhere in
this contract.

## 1. Domain objects and ownership

| Object | New/Existing | Owner (mutating surface) | Nature |
|---|---|---|---|
| `ResponsePackage` | Existing (Build 2) + additive columns | GC session users via package services | Mutable head row; status is the loop position |
| `ResponsePackageItem` | Existing (Build 2) | GC session users, DRAFT only | Frozen after issue |
| `TradeResponseRevision` | Existing (Build 2) | Contractor (token) or GC manual entry | Immutable append-only |
| `TradeResponseReviewDecision` | Existing (Build 2) | GC session users | Immutable append-only |
| `ResponseAccessToken` | Existing (Build 2) | GC session users (issue/rotate/revoke) | Immutable scope; only `lastUsedAt`/`revokedAt` update |
| `CompiledResponse` | **New (Build 3)** | GC session users via compile action | Immutable append-only revision rows |
| `Transmittal` | **New (Build 3)** | GC session users via transmit action | Immutable append-only |
| `OriginatorDisposition` | **New (Build 3)** | GC session users record; originator identity is data, not credential | Immutable append-only |
| `ResponsePackageClosureRecord` | **New (Build 3)** | GC session users via close/reopen actions | Immutable append-only |
| `TrackedItem` | Existing | `fsm.ts` (human-only) — **unchanged** | One additive nullable column (§18) |

Ownership rules:

- The **originator** (architect / engineer / owner / consultant) has **no
  credential and no route surface** in Build 3. Every originator disposition
  is *recorded by* a GC session user; `disposedByName` /
  `disposedByOrganization` are evidence fields, not identities.
- External response tokens grant access **only** to the Build 2 contractor
  surfaces and **only** in externally-active package states
  (`ISSUED | RESPONSES_IN | GC_REVIEW`). No Build 3 route accepts a token.
- `TrackedItem` status transitions remain exclusively governed by
  `lib/services/trackedItems/fsm.ts` through the existing tracked-items
  routes. **No Build 3 code path calls `validateTransition` or mutates
  `TrackedItem.status`.** Package closure proposes; a human closes items
  individually.

## 2. Relationships and cardinality

```
Meeting ──1:*── MeetingRegisterEntry ──*:1── TrackedItem   (Build 1, unchanged)
FieldReport/ConsultantReport ──1:*── ReportObservation ──*:1── TrackedItem (Build 2, unchanged)

TrackedItem ──1:*── ResponsePackageItem ──*:1── ResponsePackage        (Build 2)
ResponsePackageItem ──1:*── TradeResponseRevision (revisionIndex 0..n) (Build 2)
TradeResponseRevision ──1:*── TradeResponseReviewDecision              (Build 2)
TradeResponseRevision ──1:*── TradeResponseAttachment                  (Build 2)
ResponsePackage ──1:*── ResponseAccessToken                            (Build 2)

ResponsePackage ──1:*── CompiledResponse   (revisionIndex 0..n; immutable)   [B3]
CompiledResponse ──1:*── Transmittal       (a compiled revision may be sent
                                            more than once — re-send, second
                                            recipient)                        [B3]
Transmittal ──1:*── OriginatorDisposition  (append-only; current = latest)   [B3]
OriginatorDisposition ──*:0..1── ResponsePackageItem (item-level detail rows) [B3]
ResponsePackage ──1:*── ResponsePackageClosureRecord (CLOSED/REOPENED events) [B3]
TrackedItem.closedViaPackageId ──*:0..1── ResponsePackage (provenance only)   [B3]
```

Cardinality constraints (database-enforced where possible):

- `@@unique([packageId, revisionIndex])` on `CompiledResponse`.
- `@@unique([bidId, transmittalNumber])` on `Transmittal`.
- Every Build 3 row carries denormalized `bidId` (tenancy, §13).
- All Build 3 FKs are `onDelete: Restrict` (durable-history discipline
  established by the retention migration 100 and the Build 2 repair
  migration 101 — accountable correspondence is never cascade-deletable).

## 3. Status and disposition vocabulary (frozen)

All vocabularies are **app-validated string constants, never Prisma enums**
(repo convention). Single source of truth:
`lib/services/tradeResponse/types.ts`, extended in place.

### 3.1 `ResponsePackage.status` (stored)

```
DRAFT, ISSUED, RESPONSES_IN, GC_REVIEW, READY_TO_TRANSMIT,      (Build 2 — unchanged)
TRANSMITTED, REVISE_AND_RESUBMIT, ACCEPTED, CLOSED, REOPENED,   (Build 3 — new)
VOIDED                                                          (Build 2 — unchanged)
```

### 3.2 Derived display states (never stored)

- `OVERDUE` — contractor lane: derived from `responseDueDate` (Build 2,
  unchanged, `derivePackageDisplayStatus`).
- `NO_RESPONSE` — originator lane: derived when status is `TRANSMITTED`, the
  latest transmittal has `expectedResponseBy` in the past, and no
  package-level disposition exists for it.

### 3.3 Hold states (stored, orthogonal to status)

`ResponsePackage.holdState ∈ { DISPUTED, BLOCKED } | null`, with
`holdReason` (required), `holdSetBy`, `holdSetAt`. A hold freezes the loop
**without losing loop position** (delta from Part E, which modeled these as
statuses — see §20). While `holdState` is non-null: every forward status
transition, compile, transmit, disposition recording, closure, and external
token submission is rejected 409; reads and the audit report remain
available. Setting and clearing a hold are human, reasoned, audited actions.

### 3.4 `OriginatorDisposition.disposition`

```
ACCEPTED                      — closes the loop cycle; enables closure
ACCEPTED_WITH_COMMENTS        — as ACCEPTED; dispositionText REQUIRED
REVISE_AND_RESUBMIT           — reopens the cycle; dispositionText REQUIRED
REJECTED                      — reopens the cycle; dispositionText REQUIRED
FIELD_VERIFICATION_REQUIRED   — reopens the cycle; dispositionText REQUIRED
INFORMATIONAL                 — recorded note; never changes status
```

(Part E's `ACCEPTED_WITH_FOLLOW_UP` is renamed `ACCEPTED_WITH_COMMENTS` —
§20. The certification fixtures' `dispositionType: APPROVE` maps to
`ACCEPTED`; fixtures are reconciled in packet B3-P0.)

### 3.5 Unchanged Build 2 vocabularies

`RESPONSE_TYPES`, `GC_REVIEW_STATES` (`ACCEPTED_FOR_TRANSMITTAL`,
`RETURNED_FOR_REVISION`), `MANUAL_CHANNELS`, `RESPONSE_CHANNELS`,
`OBSERVATION_DISPOSITIONS`, and `TrackedItem` FSM statuses/kinds/priorities
are frozen as implemented and are **not** modified by Build 3.

### 3.6 `Transmittal.method`

`EMAIL | PORTAL | PROCORE | HAND | OTHER`. This records how a human sent the
package through existing channels. **Build 3 performs no delivery** — no
email sending, no Procore API call, no external egress (§23).

### 3.7 `ResponsePackageClosureRecord.action`

`CLOSED | REOPENED`.

## 4. Lifecycle and transition table

### 4.1 Text diagram (full loop)

```
DRAFT ──issue──▶ ISSUED ──▶ RESPONSES_IN ──▶ GC_REVIEW ⇄ READY_TO_TRANSMIT
  │                │             │               │              │
  └────────────────┴─────────────┴───────────────┴──▶ VOIDED    │ transmit
                                                     (terminal) ▼
                            ┌──────────────────────────── TRANSMITTED ──(re-send: no change)
                            │ disposition                     │
                            │ REVISE_AND_RESUBMIT /           │ disposition ACCEPTED /
                            │ REJECTED /                      │ ACCEPTED_WITH_COMMENTS
                            ▼ FIELD_VERIFICATION_REQUIRED     ▼
              REVISE_AND_RESUBMIT ◀────────────────────── ACCEPTED
                    │        │            (later reversing        │ close (human,
       reopen cycle │        │ reopen      disposition)           │  evidence)
   (reviewCycle+1)  ▼        ▼ cycle                              ▼
              RESPONSES_IN  GC_REVIEW                          CLOSED
                    └──── Build 2 lane loops back ────┐           │ reopen (human,
                          to READY_TO_TRANSMIT …      │           ▼  reason)
                                                      │       REOPENED ──▶ GC_REVIEW |
                                                      │                    RESPONSES_IN |
                                                      └──▶ …               CLOSED (re-close)
```

Item-level (unchanged): `TrackedItem` moves only via `fsm.ts` on human action.

### 4.2 Allowed transitions (exhaustive)

Every transition is human-initiated, single-winner (conditional claim, §17),
audited in-transaction (§11), and rejected while a hold is active.

| # | From | To | Via | Gate |
|---|---|---|---|---|
| 1 | DRAFT | ISSUED | issue action (B2) | ≥1 item; token minted or `manualChannel` recorded |
| 2 | DRAFT..READY_TO_TRANSMIT | VOIDED | status/void (B2) | pre-transmit only; atomically revokes all package tokens |
| 3 | ISSUED | RESPONSES_IN | status (B2) | every item has ≥1 response revision |
| 4 | RESPONSES_IN | GC_REVIEW | status (B2) | — |
| 5 | GC_REVIEW | READY_TO_TRANSMIT | status (B2) | latest revision of **every** item is `ACCEPTED_FOR_TRANSMITTAL` |
| 6 | READY_TO_TRANSMIT | GC_REVIEW | status (**B3, new**) | backward correction (mirrors fsm.ts un-stage philosophy); reason recorded |
| 7 | READY_TO_TRANSMIT | TRANSMITTED | **transmit action only** | compiled revision exists for current `reviewCycle`; transmittal row created; all active tokens revoked — one transaction |
| 8 | TRANSMITTED | TRANSMITTED | transmit with `resend: true` | new immutable transmittal row (new number); no status change |
| 9 | TRANSMITTED | ACCEPTED | **disposition recording only** | package-level `ACCEPTED` or `ACCEPTED_WITH_COMMENTS` on the latest transmittal |
| 10 | TRANSMITTED | REVISE_AND_RESUBMIT | **disposition recording only** | package-level `REVISE_AND_RESUBMIT`, `REJECTED`, or `FIELD_VERIFICATION_REQUIRED` |
| 11 | ACCEPTED | REVISE_AND_RESUBMIT | disposition recording | a later reversing package-level disposition (append-only history preserved) |
| 12 | REVISE_AND_RESUBMIT | RESPONSES_IN | reopen-cycle action | `reviewCycle` += 1; contractor input needed; requires fresh/rotated token or recorded manual channel |
| 13 | REVISE_AND_RESUBMIT | GC_REVIEW | reopen-cycle action | `reviewCycle` += 1; GC-only rework, no new contractor input |
| 14 | ACCEPTED | CLOSED | **close action only** | closure eligibility (§10.1); appends `CLOSED` closure record |
| 15 | CLOSED | REOPENED | reopen action | reason required; appends `REOPENED` closure record |
| 16 | REOPENED | GC_REVIEW | reopen-cycle action | rework path; `reviewCycle` += 1 |
| 17 | REOPENED | RESPONSES_IN | reopen-cycle action | contractor rework path; `reviewCycle` += 1; token rule as #12 |
| 18 | REOPENED | CLOSED | close action | re-close (e.g. reopened only to attach evidence); new `CLOSED` record; eligibility re-checked |

### 4.3 Prohibited transitions (explicit, service-rejected 409)

- `TRANSMITTED → CLOSED` in any form — **Binding rule 15**. Closure is
  reachable only from `ACCEPTED` / `REOPENED` via the close action.
- `VOIDED → anything` (terminal), and `→ VOIDED` from `TRANSMITTED`,
  `REVISE_AND_RESUBMIT`, `ACCEPTED`, `CLOSED`, `REOPENED` — a transmitted
  package is history and can never be voided.
- `TRANSMITTED / ACCEPTED / CLOSED / REOPENED` as targets of the **generic
  status route** — these are reachable only through their dedicated actions
  (transmit / disposition / close / reopen).
- `ISSUED → DRAFT` (membership is frozen at issue — Build 2, unchanged).
- Any forward transition, compile, transmit, disposition, or closure while
  `holdState` is non-null.
- Any transition of `TrackedItem.status` by package code.
- Package-item membership changes (`items` add/remove) outside `DRAFT`.

## 5. Immutable versus editable fields

| Surface | Immutable (never updated after create) | Editable (audited) |
|---|---|---|
| `CompiledResponse` | ALL fields (append-only; enforced by Prisma client extension) | — |
| `Transmittal` | ALL fields | — |
| `OriginatorDisposition` | ALL fields (corrections = newer appended row) | — |
| `ResponsePackageClosureRecord` | ALL fields | — |
| `ResponsePackage` (B3 columns) | `packageNumber`, `bidId` (B2) | `status`, `reviewCycle`, `holdState`/`holdReason`/`holdSetBy`/`holdSetAt`, `closedAt`/`closedBy` (projection of latest closure record), `updatedAt` |
| `TradeResponseRevision` | contractor-controlled fields (B2) | `gcReview` projection fields via review service only (B2) |
| `ResponseAccessToken` | scope fields (B2) | `lastUsedAt`, `revokedAt` only (B2) |
| `TrackedItem` | — | `closedViaPackageId` set once by human item-closure from package context; never overwritten once set, never set by package transitions |

`lib/prisma.ts` client extensions (established Build 1/2 pattern) enforce
append-only behavior for all four new models: `update`, `updateMany`,
`upsert`, `delete`, `deleteMany` throw.

## 6. Supersession and revision rules

- **Compiled revisions supersede by index.** `CompiledResponse.revisionIndex`
  is monotonic per package. The current compiled response = highest index.
  Older revisions are retained forever, downloadable forever, and referenced
  forever by their transmittals. No row is ever rewritten (contrast with the
  register-entry SUPERSEDED lifecycle — compiled revisions need no state flag
  because immutable rows + index ordering carry the history).
- **Contractor response revisions** keep Build 2 semantics unchanged:
  `revisionIndex` monotonic per package item across **all** review cycles
  (cycle 2 responses continue the same sequence; `reviewCycle` at submission
  time is recoverable from the audit trail and compile manifests).
- **Dispositions supersede by recency.** The *current* package-level
  disposition = latest `(recordedAt, id)` row with `packageItemId = null` on
  the **latest** transmittal. Earlier dispositions and dispositions on older
  transmittals are permanent history. A disposition is never edited; a
  mistake is corrected by appending the correct row (mirror of
  `TradeResponseReviewDecision.correctionOfId`: `OriginatorDisposition`
  carries an optional `correctionOfId` self-reference for explicit
  correction provenance).
- **Closure records supersede by recency.** Current closed/open state
  projection lives on `ResponsePackage.status`; the full history is the
  append-only record sequence (CLOSED, REOPENED, CLOSED, …).

## 7. Transmittal numbering and versioning

- `transmittalNumber` is a **per-bid monotonic sequence** (1, 2, 3, …)
  spanning all packages in the bid, allocated inside the transmit
  transaction with unique-constraint retry (`@@unique([bidId,
  transmittalNumber])`, same `withUniqueRetry` pattern as Build 2
  `packageNumber`). Numbers are never reused, including for voided… (voided
  packages cannot transmit) — never reused, period; gaps are impossible
  because allocation commits with the row.
- **Every send event = one new transmittal row with its own number.**
  Re-sending the same compiled revision (second recipient, bounced email) is
  a new transmittal referencing the same `compiledResponseId`.
- **Versioning is carried by the compiled revision**, not the number.
  Display format (UI/PDF, not stored): `TX-{transmittalNumber}` with
  `Response Rev {CompiledResponse.revisionIndex}` — e.g. a resubmission
  after revise-and-resubmit goes out as a *new* transmittal number carrying
  `Response Rev 1`.
- The certification fixtures' `TR-2024-029`-style strings are display
  artifacts, not schema; fixtures reconcile to the frozen shape in B3-P0.

## 8. GC commentary behavior

Unchanged Build 2 invariants, restated as binding for Build 3 surfaces:

- GC commentary lives in `TradeResponseRevision.gcCommentary` (current
  projection) and immutably in `TradeResponseReviewDecision.commentary`
  (full history with correction provenance). It is **never merged into**
  `responseText` (contractor words and GC words never mix).
- The compiled response renders GC commentary **as a visually distinct
  block** per item, clearly attributed to the GC, alongside the contractor's
  accepted response. Items with GC-internal responsibility
  (`gcInternalResponsibility = true`) may carry commentary with **no**
  contractor response (`formalResponse`/revision absent) — the compile does
  not require a contractor revision for GC-internal items (they must still
  pass the Build 2 `READY_TO_TRANSMIT` gate via a GC manual-entry revision
  or be excluded from the package at DRAFT time; the gate itself is not
  weakened).
- Recording an `ACCEPTED_WITH_COMMENTS` disposition does **not** write GC
  commentary — originator comments are `OriginatorDisposition.dispositionText`
  (a third, separately attributed voice). Three voices, three fields, never
  merged: contractor (`responseText`), GC (`gcCommentary`), originator
  (`dispositionText`).

## 9. Originator disposition behavior

### 9.1 Recording

`POST /api/bids/[id]/transmittals/[tid]/disposition` (session + bid access):

- `packageItemId = null` → **package-level** disposition: drives the status
  transition per §4.2 rows 9–11 **in the same transaction** as the append.
- `packageItemId` set → **item-level** detail row: never changes package
  status; used to mark which items the originator singled out.
- `disposedByName` required always; `dispositionText` required for
  `ACCEPTED_WITH_COMMENTS`, `REVISE_AND_RESUBMIT`, `REJECTED`,
  `FIELD_VERIFICATION_REQUIRED`; `disposedAt` is the originator's stated
  date (defaults to now), `recordedAt` is the system time; `recordedBy` is
  the session actor.
- Dispositions may only be recorded against the package's **latest**
  transmittal while the package is `TRANSMITTED`, `ACCEPTED`, or
  `REVISE_AND_RESUBMIT` (late paperwork after the state already moved is
  legal; it appends without re-transitioning unless it reverses per row 11).
  `INFORMATIONAL` may be recorded in any of those states, never transitions.

### 9.2 Accepted-with-comments

`ACCEPTED_WITH_COMMENTS` is closure-eligible exactly like `ACCEPTED`. The
comments are permanent record on the disposition row and are surfaced on the
package audit report and closure screen. If the comments imply new work, a
human creates follow-up TrackedItems through existing manual-creation
surfaces (optionally linking the package's items for continuity). **No
automatic item creation** (§23) and no new `sourceKind` value — the canonical
vocabulary in `lib/services/trackedItems/sourceKinds.ts` is not extended.

### 9.3 Revise-and-resubmit

A package-level `REVISE_AND_RESUBMIT` (or `REJECTED` /
`FIELD_VERIFICATION_REQUIRED`) disposition moves the package to
`REVISE_AND_RESUBMIT`. From there a human **reopen-cycle** action chooses the
rework lane:

- `→ RESPONSES_IN` when contractors must respond again. Item-level
  disposition rows guide *which* items need rework: items whose latest
  item-level disposition on the latest transmittal is `ACCEPTED`-class are
  flagged (derived, not stored) as "not requiring resubmission"; new
  revisions for them are permitted but not demanded by the Build 2
  every-item-responded gate, which is satisfied by their existing revisions.
- `→ GC_REVIEW` when the GC can address the return without contractor input
  (e.g. attach verification evidence, correct commentary).

`reviewCycle` increments on every reopen-cycle action. The Build 2 lane then
runs unchanged (responses → review → `READY_TO_TRANSMIT`), a **new** compiled
revision is produced, and a **new** transmittal goes out. Nothing from the
prior cycle is edited, deleted, or recompiled in place.

Because transmit revoked all tokens (§4.2 row 7), reopening to
`RESPONSES_IN` requires issuing/rotating a token (or recording a manual
channel) — deliberate: no stale external credential silently regains access
when the loop reopens.

## 10. Closure and reopening

### 10.1 Closure eligibility (all required, checked in the close transaction)

1. `status = ACCEPTED` (or `REOPENED` for re-close), `holdState` null.
2. The current package-level disposition on the latest transmittal is
   `ACCEPTED` or `ACCEPTED_WITH_COMMENTS`.
3. A session actor (recorded as `ResponsePackageClosureRecord.actor` and
   projected to `closedBy`/`closedAt`).
4. Evidence references (`evidenceJson`: transmittal ids, disposition ids,
   attachment ids — **id references only, never content**) — may be empty,
   is always recorded.

The close action, closure-record append, status flip, and AuditEvent commit
in one transaction.

**Package closure does NOT require item closure, and does not perform it.**
The loop being complete (originator accepted) is distinct from the work being
complete (TrackedItem lifecycle). Forcing item closure to close
correspondence would pressure premature Operations Register closure — the
inverse of rule 15's intent. Instead the closure record snapshots every
member item's `TrackedItem.status` at close time (`itemStatusSnapshotJson`,
ids + status labels only), and the UI shows a warning listing still-open
items. When a human subsequently closes an item *from the package context*,
the existing fsm route records `closedViaPackageId` provenance.

### 10.2 Reopening

- `CLOSED → REOPENED` is a human action with a **required reason**,
  appending a `REOPENED` closure record and AuditEvent. Nothing is deleted;
  `closedAt`/`closedBy` projections are cleared, the record history remains.
- From `REOPENED`: re-close directly (row 18 — eligibility re-checked), or
  reopen a rework cycle (rows 16–17).
- Reopening the package never reopens TrackedItems. `CLOSED`/`WAIVED`
  remain terminal in fsm.ts V1; item-level reopening stays out of scope
  (§23) — a reopened package needing item work uses new items or the
  existing non-terminal items.

## 11. Audit and history requirements

The Build 1/2 audit policy applies verbatim to every Build 3 mutation:

- Mandatory bounded `AuditEvent` written **inside** the mutation's
  transaction via `persistAuditEnvelope` (fail-closed: audit failure rolls
  the mutation back). Stdout/Loki emission only after commit
  (`emitAuditEnvelopeStdout`). Implementation reuses
  `lib/services/tradeResponse/txAudit.ts`.
- Audited actions: compile, transmit (incl. re-send), disposition recording
  (package- and item-level), reopen-cycle, close, reopen, hold set/clear,
  the Build 3-added backward transition (row 6), and compiled-response
  download (read-audit, post-commit telemetry only — downloads mutate
  nothing).
- Payload discipline: ids, counts, state labels, actor labels, presence
  flags only. **Never**: response text, GC commentary, disposition text,
  recipient email addresses, file names, storage keys, token values, or any
  document content. Detailed text lives in the immutable domain rows.
- Domain history is the primary record: compiled revisions, transmittals,
  dispositions, closure records, response revisions, and review decisions
  are all append-only and together reconstruct the full loop without the
  audit log.
- The full-loop audit report (§15, `GET …/audit`) composes the provenance
  chain: source (Meeting Register entry / Report Observation / manual) →
  TrackedItem → package item → response revisions + review decisions →
  compiled revisions → transmittals → dispositions → closure records. Read
  from persisted rows only — no derived claims.

## 12. Authorization matrix by action

There is no role model in this codebase (any authenticated bid member may
act; a role fence is a known, accepted gap — recorded, not silently widened).
Every action records its actor. Frozen matrix:

| Action | Credential | Guard order | Extra gate |
|---|---|---|---|
| Compile / list / download compiled | Session | `requireBidAccess(bidId)` before body/DB/blob | status ∈ {READY_TO_TRANSMIT, TRANSMITTED*} (*download any state) |
| Transmit / re-send | Session | same | status claim §4.2 rows 7–8 |
| Record disposition | Session | same | latest transmittal only; §9.1 states |
| Reopen-cycle | Session | same | status ∈ {REVISE_AND_RESUBMIT, REOPENED} |
| Close / reopen | Session | same | §10 eligibility |
| Hold set/clear | Session | same | reason required |
| Audit report | Session | same | read-only |
| ANY Build 3 action | External token | — | **REJECTED — no token surface exists** |
| Contractor submit (B2) | Token | token wall (B2, unchanged) | active states only — never TRANSMITTED or later |

Universal: positive-numeric id validation and `requireBidAccess` run before
body parsing, DB, blob, or service work (Build 1/2 invariant, proven by the
existing denial-matrix pattern; Build 3 extends that matrix to every new
route). Cross-bid/unknown ids → uniform 404, zero downstream work.

## 13. Tenant isolation requirements

- Denormalized `bidId` on all four new models; every child lookup is
  parent-chain-scoped (`findFirst` with `{id, bidId}` and the full
  package → item / transmittal → compiled chains), Build 2 pattern.
- Unknown, foreign-bid, and wrong-parent ids are indistinguishable (404,
  same body, no timing/probe signal).
- Compiled PDFs stored under bid-scoped server-owned keys:
  `plan-room/jobs/{bidId}/response-packages/{packageId}/compiled/{revisionIndex}-{sha256}.pdf`
  — downloads use only the server-stored key, `private, no-store`,
  `nosniff`, attachment disposition, `application/pdf` only.
- The compiled document for one package contains only that package's items,
  responses, commentary, and dispositions — never other bids' or other
  packages' data.
- Confidentiality boundary (Ledger rules restated): compiled/transmitted
  output NEVER contains `pricingData` / `rawPriceText` / `isPreferred`.
  Responder name/company appear in the originator-facing compiled response
  (standard construction correspondence attribution — the originator is not
  a subcontractor-facing surface and not an AI prompt); the Build 2
  contractor portal continues to never show other subs' identities. Nothing
  in Build 3 enters any AI prompt.

## 14. Source provenance requirements

- The chain in §11 must be reconstructible from persisted rows for every
  package item, across supersession: register-entry SUPERSEDED lifecycles,
  response-revision indexes, compiled revisions, and transmittal history all
  retain their links permanently (Restrict FKs, append-only rows).
- `TrackedItem.sourceKind` canonical vocabulary is **unchanged**; Build 3
  introduces no writer of `sourceKind` and no new value.
- `consultantTargetDate` (rule 14) is never read into or rewritten by any
  Build 3 path; contractor/GC dates (`responseDueDate`,
  `expectedResponseBy`) are the only dates Build 3 touches.
- Compile manifests (`contentManifestJson`) record exactly which
  `TradeResponseRevision` ids/indexes and review decisions each compiled
  revision embodies — ids and counts only — making every transmitted
  document's contents provable later without re-rendering.

## 15. API request and response contracts

All routes: `bidRouteContext` (id validation + `requireBidAccess` before
body). JSON responses; mutations return the created/affected row projections
(never raw tokens, never storage keys).

```
POST /api/bids/[id]/response-packages/[pkgId]/compile
  req:  { } (idempotent — §17)
  200:  { ok, compiledResponse: { id, revisionIndex, reviewCycle, sha256,
          byteSize, compiledAt, compiledBy, reused: boolean } }

GET  /api/bids/[id]/response-packages/[pkgId]/compiled
  200:  { revisions: [ { id, revisionIndex, reviewCycle, sha256, byteSize,
          compiledAt, compiledBy, transmittalIds: [] } ] }

GET  /api/bids/[id]/response-packages/[pkgId]/compiled/[revIndex]/download
  200:  application/pdf (headers per §13); 404 unknown/foreign

POST /api/bids/[id]/response-packages/[pkgId]/transmit
  req:  { recipientName, recipientEmail?, recipientOrganization?,
          method, note?, expectedResponseBy?, resend?: boolean }
  200:  { ok, transmittal: { id, transmittalNumber, compiledResponseId,
          compiledRevisionIndex, sentAt, sentBy }, packageStatus }

GET  /api/bids/[id]/response-packages/[pkgId]/transmittals
  200:  { transmittals: [ { …row, dispositions: [ …rows ] } ] }

POST /api/bids/[id]/transmittals/[tid]/disposition
  req:  { disposition, dispositionText?, disposedByName,
          disposedByOrganization?, disposedAt?, packageItemId?,
          correctionOfId? }
  200:  { ok, disposition: { id, … }, packageStatus }

POST /api/bids/[id]/response-packages/[pkgId]/reopen-cycle
  req:  { target: "RESPONSES_IN" | "GC_REVIEW", reason }
  200:  { ok, status, reviewCycle }

POST /api/bids/[id]/response-packages/[pkgId]/close
  req:  { evidence?: [ { kind: "transmittal"|"disposition"|"attachment",
          id } ], note? }
  200:  { ok, status: "CLOSED", closureRecordId, openItemWarnings:
          [ { trackedItemId, status } ] }

POST /api/bids/[id]/response-packages/[pkgId]/reopen
  req:  { reason }        // required
  200:  { ok, status: "REOPENED", closureRecordId }

POST /api/bids/[id]/response-packages/[pkgId]/hold
  req:  { holdState: "DISPUTED" | "BLOCKED" | null, reason }  // reason
        required when setting AND when clearing
  200:  { ok, holdState }

GET  /api/bids/[id]/response-packages/[pkgId]/audit
  200:  { package, chain: [ per-item provenance per §11 ], transmittals,
          dispositions, closureRecords, compiledRevisions }   // ids, labels,
        timestamps, and domain text fields; never tokens/storage keys
```

The existing Build 2 `POST …/status` route is extended only with row 6
(`READY_TO_TRANSMIT → GC_REVIEW`, reason required) and continues to reject
every Build 3-only target state (§4.3).

## 16. Expected error codes

Follows `statusForError` conventions (extended, not replaced):

| Code | Meaning in Build 3 |
|---|---|
| 400 | Validation: unknown vocabulary value, missing required reason/text/name, malformed date, invalid evidence ref shape |
| 401 | No session (proxy wall, unchanged) |
| 404 | Unknown/foreign/cross-bid/wrong-parent id — uniform, probe-safe; also unknown compiled revision or transmittal |
| 409 | State conflicts: wrong status for the action; stale single-winner claim lost; hold active; close without ACCEPTED-class disposition; transmit without current-cycle compile; duplicate transmit without `resend: true`; disposition on a non-latest transmittal; membership change post-DRAFT |
| 413 | (unchanged Build 2 attachment limit; no Build 3 upload surface) |
| 429 | (external token wall only — no Build 3 surface) |
| 500 | Unexpected; message never leaks internals; mutation rolled back with its audit |

Rule-15 violations are 409 with an explicit durable error message
(`"Transmission never closes a package"` class), mirroring the
durable-history 409 discipline.

## 17. Idempotency and concurrency

- **Compile is idempotent.** The compile service computes the current
  content manifest (accepted latest revisions + review decisions +
  commentary + package header + `reviewCycle`). If the package's latest
  `CompiledResponse` has an identical manifest, it is returned with
  `reused: true` and no new row/blob. Otherwise `revisionIndex` = latest+1
  via unique-retry. Concurrent compiles: unique constraint makes one winner;
  the loser retries, detects the identical manifest, returns `reused`.
- **Transmit is single-winner.** `updateMany where {id, bidId, status:
  "READY_TO_TRANSMIT", holdState: null} → TRANSMITTED`, assert count 1,
  inside the transaction that creates the transmittal, allocates the number,
  and revokes tokens. A concurrent duplicate loses the claim → 409.
  Re-send requires `resend: true` and current status `TRANSMITTED` —
  a double-clicked first transmit can never create two transmittals.
- **Disposition recording** serializes per transmittal inside its
  transaction; the status flip (rows 9–11) is itself a conditional
  `updateMany` claim. Appends are deliberate human records — no automatic
  dedupe; an accidental duplicate is corrected by an appended
  `correctionOfId` row, never deletion.
- **Close / reopen / reopen-cycle / hold** are conditional claims on the
  exact expected `(status, holdState)`; losers get 409, nothing partial.
- **Number allocation** (`transmittalNumber`, `revisionIndex`) uses the
  Build 2 `withUniqueRetry` pattern — no read-then-write gaps.
- All checks that gate a transition are **re-executed inside** the owning
  transaction (Build 2 discipline: preflight + in-transaction recheck).

## 18. Schema additions and migration strategy

### 18.1 New models (frozen shape; Restrict FKs; conventions per repo)

```prisma
model CompiledResponse {
  id                  Int      @id @default(autoincrement())
  bidId               Int
  packageId           Int
  revisionIndex       Int      @default(0)
  reviewCycle         Int      @default(0)
  storageKey          String   // §13 key shape; server-owned
  sha256              String
  byteSize            Int
  contentManifestJson String   // ids/revision indexes/counts only
  compiledBy          String
  compiledAt          DateTime @default(now())

  bid          Bid             @relation(fields: [bidId], references: [id], onDelete: Restrict)
  package      ResponsePackage @relation(fields: [packageId], references: [id], onDelete: Restrict)
  transmittals Transmittal[]

  @@unique([packageId, revisionIndex])
  @@index([bidId, packageId])
}

model Transmittal {
  id                    Int      @id @default(autoincrement())
  bidId                 Int
  packageId             Int
  compiledResponseId    Int
  transmittalNumber     Int
  recipientName         String
  recipientEmail        String?
  recipientOrganization String?
  method                String   // EMAIL | PORTAL | PROCORE | HAND | OTHER
  note                  String?
  expectedResponseBy    DateTime?
  sentBy                String
  sentAt                DateTime @default(now())

  bid              Bid              @relation(fields: [bidId], references: [id], onDelete: Restrict)
  package          ResponsePackage  @relation(fields: [packageId], references: [id], onDelete: Restrict)
  compiledResponse CompiledResponse @relation(fields: [compiledResponseId], references: [id], onDelete: Restrict)
  dispositions     OriginatorDisposition[]

  @@unique([bidId, transmittalNumber])
  @@index([bidId, packageId])
  @@index([compiledResponseId])
}

model OriginatorDisposition {
  id                     Int      @id @default(autoincrement())
  bidId                  Int
  transmittalId          Int
  packageItemId          Int?     // null = package-level (drives status)
  disposition            String   // §3.4 vocabulary
  dispositionText        String?
  disposedByName         String
  disposedByOrganization String?
  disposedAt             DateTime @default(now())   // originator's stated date
  recordedBy             String                     // GC session actor
  recordedAt             DateTime @default(now())
  correctionOfId         Int?

  bid          Bid                    @relation(fields: [bidId], references: [id], onDelete: Restrict)
  transmittal  Transmittal            @relation(fields: [transmittalId], references: [id], onDelete: Restrict)
  packageItem  ResponsePackageItem?   @relation(fields: [packageItemId], references: [id], onDelete: Restrict)
  correctionOf OriginatorDisposition? @relation("OriginatorDispositionCorrections", fields: [correctionOfId], references: [id], onDelete: Restrict)
  corrections  OriginatorDisposition[] @relation("OriginatorDispositionCorrections")

  @@index([bidId, transmittalId, recordedAt])
  @@index([packageItemId])
  @@index([correctionOfId])
}

model ResponsePackageClosureRecord {
  id                     Int      @id @default(autoincrement())
  bidId                  Int
  packageId              Int
  action                 String   // CLOSED | REOPENED
  reason                 String?  // app-required for REOPENED
  evidenceJson           String   @default("[]") // id refs only
  itemStatusSnapshotJson String   @default("[]") // [{trackedItemId,status}]
  actor                  String
  createdAt              DateTime @default(now())

  bid     Bid             @relation(fields: [bidId], references: [id], onDelete: Restrict)
  package ResponsePackage @relation(fields: [packageId], references: [id], onDelete: Restrict)

  @@index([bidId, packageId, createdAt])
}
```

### 18.2 Additive columns on existing models

```prisma
// ResponsePackage — all nullable/defaulted, additive:
reviewCycle Int      @default(0)
holdState   String?  // DISPUTED | BLOCKED
holdReason  String?
holdSetBy   String?
holdSetAt   DateTime?
closedAt    DateTime?   // projection of latest closure record
closedBy    String?

// TrackedItem — additive, provenance only:
closedViaPackageId Int?   // Restrict FK → ResponsePackage; set once by human
                          // item-closure performed from package context
```

Part E's `TrackedItem.closureEvidenceJson` is **dropped** (§20): closure
evidence lives on the package closure record; item evidence remains the
existing comment thread + attachments.

### 18.3 Migration strategy

- Exactly **one** forward-only, additive migration:
  `20260719000000_r2b3_response_control_loop` (timestamp finalized at
  authoring; MUST sort lexicographically after
  `20260718030000_r2b2_trade_response_reviewer_repairs`), becoming ordinal
  **102** on the integrated line (99 trade → 100 retention → 101 repair →
  102 Build 3).
- New tables + additive nullable/defaulted columns only. **No table
  rebuilds, no data backfill, no destructive change, no down-migration.**
- Authored and locally verified only (fresh throwaway replay 102/102,
  `prisma migrate status`, migration lint, and a 101-with-data → 102 upgrade
  test extending the existing integrated upgrade suite). Never applied to
  any real/shared/staging/production database by a model — application is
  human-gated per the migration runner rules.
- Rollback posture: additive-only means image rollback is safe without data
  rollback (established pattern).

## 19. Compatibility

### 19.1 With existing Tracked Items

- `fsm.ts`, statuses, kinds, priorities, `sourceKinds.ts`: untouched.
- `formalResponse`/`formalResponsePrior` (consultant lane) is unrelated to
  and untouched by the package response lane.
- Package membership, trade assignment, and all Build 3 actions never write
  `TrackedItem.status`, `dueDate`, or any consultant field.
- The only TrackedItem change is the additive `closedViaPackageId`
  provenance column (§18.2), written by the existing human closure route
  when invoked from package context.

### 19.2 With Consultant Reports and Field Reports

- `ReportObservation` (Build 2) remains the human extraction bridge from
  both report families into TrackedItems; Build 3 consumes the chain
  read-only for provenance.
- `ConsultantDispositionRecord` (observation-level, Build 1 domain) and
  `OriginatorDisposition` (transmittal-level, Build 3) are **distinct
  namespaces**; neither reads or writes the other.
- ARCHITECT_FIELD_REPORT / ENGINEER_FIELD_REPORT naming preserved (rule 13);
  `consultantTargetDate` isolation preserved (rule 14).

### 19.3 With Build 1 (Meeting Register)

Meeting Register provenance (`sourceMeetingRegisterEntryId`, register-entry
SUPERSEDED lifecycle, cross-meeting continuity) feeds the §11 chain
unchanged. Rerun/supersession behavior is unaffected: register reconciliation
never touches packages, and packaged (promoted/linked) entries are in the
"preserve" class by the Build 1 remediation contract.

### 19.4 With the SOL integration branch

This contract is frozen against the accepted Build 2 surface as integrated at
`9b283b9` (`gwx/sol-r2-ledger-integration`). Implementation must branch from
the post-review integrated base; if the combined review forces Build 2
changes, this contract's §3.5 "unchanged" claims must be re-verified before
packet B3-P1 starts (a checklist item, not a re-freeze).

## 20. Deltas from R2 doc Part E (recorded decisions)

| # | Part E | This contract | Rationale |
|---|---|---|---|
| 1 | `ORIGINATOR_REVIEW` stored state | Dropped; `TRANSMITTED` covers awaiting-review; dispositions drive the next transition | The state carried no information beyond `TRANSMITTED` + zero dispositions; every extra state is an extra invalid-transition surface |
| 2 | `ACCEPTED_WITH_FOLLOW_UP` | `ACCEPTED_WITH_COMMENTS` | Mission vocabulary; matches certification fixtures' accepted-with-comments scenario |
| 3 | Exception **states** DISPUTED / NO_RESPONSE / BLOCKED | DISPUTED/BLOCKED = orthogonal `holdState`; NO_RESPONSE = derived | Holds must not destroy loop position; derived states are never stored (Build 2 precedent: OVERDUE) |
| 4 | Token behavior at transmit unspecified | Transmit atomically revokes all active tokens | No external credential survives into the immutable post-transmit record; reopen requires explicit re-issue |
| 5 | Closure evidence on `TrackedItem.closureEvidenceJson` | Append-only `ResponsePackageClosureRecord` (+ snapshot) | Package-loop evidence belongs to the package; append-only beats a mutable JSON column; enables reopen history |
| 6 | `closedViaPackageId` on TrackedItem | Kept | Provenance value, human-set only |
| 7 | Disposition transmittal-level only | + optional `packageItemId` item-level rows, + `correctionOfId` | Originators mark up individual items (certification fixtures); correction provenance mirrors the accepted `TradeResponseReviewDecision` pattern |
| 8 | `REVISE_AND_RESUBMIT → GC_REVIEW` direct | Stored `REVISE_AND_RESUBMIT` state + human reopen-cycle to `RESPONSES_IN` or `GC_REVIEW`, `reviewCycle` counter | The returned-by-originator condition must be visible and reportable; contractor-rework vs GC-rework lanes differ (token gating) |
| 9 | Compiled key `compiled-responses/{sha256}.pdf` | Package-scoped key with revision + sha (§13) | Consistent with Build 2 server-owned key discipline; collision-safe; adds manifest for provable content |
| 10 | Reopening unaddressed | §10.2 (REOPENED state, records, re-close) | Mission requirement |
| 11 | (implicit sidecar compile) | Local PDF engine only, no egress | Ledger provider gating; documentation-only claim discipline |

Part D drift already accepted via SOL review (review-decision history,
rotation, `manualChannel`, limiter, `VOIDED` gates) is inherited as-is.

## 21. Test and acceptance gates

Local gates (every packet; commands + summary lines recorded per the
verification-evidence rule):

1. `npx prisma validate` and `npx prisma generate` pass.
2. Full `npx vitest run` passes (no existing test weakened — gates, confirm
   phrases, guard sweeps untouched).
3. `npx tsc --noEmit --incremental false` exit 0.
4. `npx eslint` clean on every new/changed file (pre-existing baseline debt
   is not grown).
5. Migration packet only: migration lint, fresh throwaway replay (102/102),
   `prisma migrate status`, and the 101-with-seeded-loop-data → 102 upgrade
   test.
6. `git diff --check` clean; clean worktree at commit.

Acceptance tests (frozen; extend the Build 2 mocked-Prisma + migrated-DB
suites):

- A1 Compile: immutable revision; identical-manifest recompile returns
  `reused`, creates nothing; post-revise recompile increments; old revision
  bytes/rows untouched; manifest lists exact revision ids.
- A2 Transmit: creates transmittal + revokes tokens + flips status in one
  transaction; token use after transmit → 404; double-transmit race → one
  winner; re-send requires flag, new number, same compiled revision.
- A3 Rule 15: transmit does not close; close from `TRANSMITTED` → 409; close
  without ACCEPTED-class disposition → 409; every prohibited transition in
  §4.3 rejected.
- A4 Dispositions: append-only (update/delete throw); package-level drives
  status per rows 9–11 atomically; item-level never transitions;
  `ACCEPTED_WITH_COMMENTS` requires text and closes eligibility; reversal
  (row 11) preserves full history; correction chain provable.
- A5 Revise-and-resubmit: reopen-cycle increments `reviewCycle`; Build 2
  gates re-apply on the new cycle; new revisions continue `revisionIndex`
  monotonically; accepted items derivably "not requiring resubmission";
  token re-issue required for `RESPONSES_IN` lane.
- A6 Closure/reopen: eligibility matrix; item statuses snapshotted; items
  NOT transitioned; reopen requires reason; re-close appends a second
  record; `closedViaPackageId` set only by human item closure.
- A7 Holds: set/clear reasoned + audited; all forward actions 409 while
  held; loop position preserved on clear.
- A8 Authorization/tenancy: denial matrix over every new route (auth before
  body/DB/blob, zero downstream work on denial); cross-bid/wrong-parent 404
  uniformity; no token access to any Build 3 route.
- A9 Audit: in-transaction fail-closed AuditEvent for every §11 action
  (injection tests prove rollback); payload boundedness (no text/PII/keys).
- A10 Provenance: full-chain audit report from a seeded
  meeting-register-entry → … → closure fixture, across one
  revise-and-resubmit cycle and one reopen.
- A11 Migrated-DB: 102 replay; 101-with-data upgrade preserves every Build 2
  row byte-identically; Restrict FKs proven at the database boundary.

Staging certification is a separate, human-gated card (synthetic scenarios
per the Completion standard); nothing in Build 3 is claimed live-proven by
local suites.

## 22. Source and report inventory (reviewed for this freeze)

| Source | Location | Role |
|---|---|---|
| R2 domain contract (Parts A–F) | `docs/architecture/R2_MEETING_RESPONSE_CONTROL_LOOP.md` @ `c1312a7` | Superseded Part E; binding rules + Build 1 ground truth |
| Capability Ledger | `docs/architecture/CAPABILITY_LEDGER.md` @ `c1312a7` | Evidence-state discipline |
| Build 1 + remediation report | `~/gwx-ops/reports/r2-meeting-register-foundation.md` | Register/rerun/audit invariants |
| Build 2 security hardening | `~/gwx-ops/reports/r2-build2-security-hardening.md` | Route/service auth ground truth |
| Shared-base remediation | `~/gwx-ops/reports/r2-base-release-remediation.md` (this branch's tip `c1312a7`) | Audit atomicity + reconcile invariants |
| Field-response certification | `~/gwx-ops/reports/r2-field-response-certification.md` + fixtures | Expected disposition/transmittal shapes; gap list |
| SOL trade-response implementation | `~/gwx-ops/reports/sol-trade-response-packages.md`; code @ `43449a1` | Build 2 as-built (schema §D, `types.ts`, `packages.ts`) |
| SOL trade-response review | `~/gwx-ops/reports/sol-trade-response-packages-review.md` | Final verdict APPROVE @ `43449a1` |
| SOL integration report | `~/gwx-ops/reports/sol-r2-ledger-integration.md` (`9b283b9`) | Migration ordinals 99–101; integrated surface |
| Integrated security review | `~/gwx-ops/reports/sol-integrated-security-review.md` | BLOCK findings driving fail-closed/retention discipline |
| Live schema/services | `prisma/schema.prisma`, `lib/services/trackedItems/fsm.ts`, `lib/services/tradeResponse/*` (via `git show`) | Field-level verification |

## 23. Explicit non-goals

- **No delivery automation.** No email sending, Procore push, or any
  network egress; transmittals record human sends.
- **No originator portal / external credential** for dispositions.
- **No role model.** Actor recording only; role fences are a separate,
  acknowledged decision.
- **No automatic follow-up item creation** from accepted-with-comments.
- **No item-level reopening** (fsm.ts CLOSED/WAIVED stay terminal).
- **No new `sourceKind` values**; no Meeting Register or observation
  schema changes; no changes to Build 1/2 vocabularies or gates.
- **No notification delivery** for `RETURNED_FOR_REVISION` (the durable
  hook exists; delivery remains future work).
- **No AI involvement anywhere** in Build 3: no extraction, no
  summarization, no provider calls; nothing here enters an AI prompt.
- **No deployment/staging/production claims** — implementation is
  local-only until separately human-gated.

## 24. Implementation breakdown and dependency order

Independently reviewable packets, one branch/commit series each, in order:

| Packet | Contents | Depends on |
|---|---|---|
| **B3-P0** | Docs/tests only: certification fixture vocabulary reconciliation (`APPROVE`→`ACCEPTED`, TR-number display shape), Part E supersession pointer | contract ratified |
| **B3-P1** | Schema + migration 102 + `lib/prisma.ts` append-only extensions + migrated-DB replay/upgrade tests (A11) | integrated base approved |
| **B3-P2** | Compile service: manifest, idempotency, storage, routes, download (A1) | P1 |
| **B3-P3** | Transmit service: numbering, single-winner claim, token revocation, transmittal routes (A2, A3-transmit) | P2 |
| **B3-P4** | Originator disposition service/routes: package+item level, status mapping, corrections (A4) | P3 |
| **B3-P5** | Revise-and-resubmit cycle: reopen-cycle route, `reviewCycle`, token re-issue interplay (A5) | P4 |
| **B3-P6** | Closure/reopen/hold: closure records, eligibility, snapshots, `closedViaPackageId` surface, hold route (A6, A7) | P4 |
| **B3-P7** | Full-loop audit report route + Operations Register / package UI wiring (A10) | P2–P6 |
| **B3-P8** | End-to-end acceptance sweep (A3, A8, A9 across all routes), certification fixture harness alignment, Capability Ledger truth update | P0–P7 |

Graph: `P0 ∥ P1 → P2 → P3 → P4 → (P5 ∥ P6) → P7 → P8`.

Hard external dependency: **implementation begins only after the combined
security/integration review of `gwx/sol-r2-ledger-integration`
(`51d57f2..9b283b9`) approves the integrated base** and §19.4's re-check
passes. This contract freeze itself has no dependency and is complete now.
