# R2 Meeting-to-Response Lifecycle — Capability Matrix

**Branch:** `gwx/r2-local-certification-harness` · **Base:** `9158b4b` (R2 Field
Response certification foundation) · **Date:** 2026-07-18

This matrix covers every stage of the lifecycle named in the certification
mission:

```
Meeting → transcript/minutes → Meeting Register → Tracked Item →
Consultant/Field Observation → trade grouping → response package →
contractor response → GC review → compiled response → transmittal →
originator disposition → revise-and-resubmit/accepted → closure eligibility →
closure record → reopening
```

Status legend: **IMPLEMENTED** (real schema + service code, unit-tested, on
this branch) · **FIXTURE_SIMULATED** (no schema on this branch; modeled
in-memory per the frozen Build 3 contract for certification purposes only) ·
**FUTURE_CONTRACT** (frozen vocabulary/shape exists only in
`docs/r2/BUILD3-RESPONSE-CONTROL-LOOP-CONTRACT.md`, read via `git show
1ce99dd:...` from `gwx/r2-build3-contract-freeze`, never merged) ·
**BLOCKED** · **UNKNOWN**.

A capability's schema does not exist on THIS branch until the (untouched)
`gwx-sol-r2-ledger-integration` worktree's Build 2 trade-response line and the
Build 3 packets (B3-P1 onward) are implemented and merged. Until then, every
row from "response package" onward is FIXTURE_SIMULATED by construction, not
by choice — see `tests/fixtures/r2-lifecycle/responsePackageSimulator.ts`
header.

| # | Object / capability | Status | Current implementation source | Fixture source | Scenario coverage | Provenance expectation | Authorization expectation | Audit/history expectation | Known blocker |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Meeting (upload, transcript, publish) | IMPLEMENTED | `prisma/schema.prisma` `Meeting` model; meeting analysis/publish services | `tests/fixtures/r2-lifecycle/meetingRegisterFixtures.ts` `makeMeeting` | 8, 9, 23 | Root of the source chain; no upstream provenance | Bid-scoped routes (not exercised by this harness — out of scope) | Meeting analysis versioning (`analysisVersion`) exists; not exercised here | Audio-durability read-path liveness is a separate, unrelated concern (GroundWorX queue GWX-Q07) — not this harness's scope |
| 2 | MeetingActionItem (Register source row) | IMPLEMENTED | `prisma/schema.prisma` `MeetingActionItem`; written by meeting analysis or manual entry | `meetingRegisterFixtures.ts` `makeMeetingActionItem` | 8, 9, 23 | `meetingId`, `bidId` denormalized | Read via `findFirst({id, bidId})` tenancy scoping | No dedicated audit event on creation (inherits meeting's) | None for this harness's purposes |
| 3 | Meeting Register → TrackedItem promotion | IMPLEMENTED | `lib/services/trackedItems/index.ts` `promoteMeetingActionItem`; `TrackedItem.sourceMeetingActionItemId @unique` | Reuses real service; fixtures in `meetingRegisterFixtures.ts` | 8, 9, 23 | `sourceMeetingId`, `sourceMeetingActionItemId`, `evidenceExcerpt` carried forward verbatim | `findFirst({id, bidId})` before promote; friendly duplicate error + DB unique constraint (P2002) as a second fence | `register_action` AuditEvent (`tracked_item_promote`), best-effort (logged, never blocks the action) | None — this exact guard is what scenarios 8/9 certify |
| 4 | TrackedItem (Operations Register entry, FSM) | IMPLEMENTED | `prisma/schema.prisma` `TrackedItem`; `lib/services/trackedItems/fsm.ts` | `tests/field-response-certification/unit-integration-builders.ts` `makeTrackedItem` (reused, not duplicated) | Underlies every scenario 1-26 | `sourceKind`, `sourceConsultantObservationId`/`sourceFieldReportId`/`sourceMeetingActionItemId` (each `@unique` where the source is single-origin) | FSM is human-only (`validateTransition`); no system-initiated transition | `register_action` AuditEvent on transition, with `from`/`to`/actor | None |
| 5 | Consultant/Field Observation (ConsultantObservation, FieldReport) | IMPLEMENTED | `lib/services/consultantReports/observations.ts`; `prisma/schema.prisma` `ConsultantObservation`, `FieldReport` | `tests/field-response-certification/fixtures/*.json`; `unit-integration-builders.ts` observation makers (reused) | 3 (via `buildReviseAndResubmitScenario`) | `sourcePage` frozen on resolution; `bidId` denormalized for the same-bid link check | `bid` scoping on every route; state machine ENTERED→ACCEPTED\_\*/DISMISSED | `ConsultantDispositionRecord` append-only (client-extension enforced — `update`/`delete` throw) | Extraction/OCR permanently deferred (`parseStatus` stays `UNPARSED`) — unrelated to this harness |
| 6 | Trade grouping | IMPLEMENTED (utility) / Partial (no write path) | `unit-integration-builders.ts` `groupByTrade`; `TrackedItem.tradeId` FK exists, no UI writes it | `FIXTURE_TRADES` (reused) | 21 | Grouping is a pure read-time derivation, not stored | N/A (read-only utility) | N/A | No trade-assignment UI exists (Build 2 gap, pre-existing, documented in `BUILD2-ACCEPTANCE-SPEC.md` B2-03) |
| 7 | Response package (`ResponsePackage`) | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch — schema lives on `gwx-sol-r2-ledger-integration` (untouched) | `responsePackageSimulator.ts` `SimResponsePackage` | 1-7, 10, 13-20, 23-26 | `bidId` denormalized (simulated); membership frozen outside DRAFT | Actor-bidId match required before any mutation (simulated `requireBidAccess`) | In-transaction fail-closed audit write, simulated (scenario 14) | Real schema requires packet B3-P1 (contract §24); not started |
| 8 | Contractor response (`TradeResponseRevision` equivalent) | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch (Build 2 trade-response models absent) | `responsePackageSimulator.ts` `SimPackageItem.responseText` | 1-7, 13, 24 | Response text keyed to `trackedItemId` | Simulated — gated by package status (ISSUED/RESPONSES_IN) | N/A (contractor lane, Build 2 scope) | Real Build 2 schema is on `gwx-sol-trade-response-packages`/`gwx-sol-r2-ledger-integration`, not this branch |
| 9 | GC review decision | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `recordGcReviewDecision` | 1-7, 13, 20, 24 | Per-item decision gates `READY_TO_TRANSMIT` (all items must be `ACCEPTED_FOR_TRANSMITTAL`) | Simulated actor-bidId check | N/A (Build 2 scope) | Same as row 7/8 |
| 10 | Compiled response (`CompiledResponse`) | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `compile()` | 13, 24 | `contentManifestJson`-equivalent hash ties a revision to exact item/response ids (simulated via SHA-256 of a manifest object) | Simulated; only legal from `READY_TO_TRANSMIT`/`TRANSMITTED` | Append-only revisions; identical manifest reuses (idempotent, contract §17) | Needs contract packet B3-P2 |
| 11 | Transmittal | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `transmit()` | 1-7, 13, 20, 24, 25 | Per-bid monotonic `transmittalNumber` (simulated); references the compiled revision id | Simulated single-winner claim; revokes package token on transmit | Append-only; re-send creates a new row, never edits | Needs contract packet B3-P3; legacy fixture `TR-YYYY-NNN` strings are NOT the frozen shape — see B3-P0 below |
| 12 | Originator disposition | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `recordDisposition()`; vocabulary reconciled in `vocabulary-aliases.ts` | 1-6, 25 | `packageItemId` null = package-level (drives status); set = item-level (never transitions) | Simulated; only against the latest transmittal | Append-only; corrections via `correctionOfId`, never edited in place | Needs contract packet B3-P4; existing certification fixtures used placeholder vocabulary — B3-P0 required first |
| 13 | Revise-and-resubmit cycle | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `reopenCycle()` | 3, 5 | `reviewCycle` increments; prior cycle's rows never edited | Simulated; requires fresh token issuance conceptually (token flag) for the contractor lane | Every reopen is an appended audit entry | Needs contract packet B3-P5 |
| 14 | Closure eligibility + closure record | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `close()` | 15, 16, 17, 18 | Snapshots `itemStatuses` by reference id, never mutates `TrackedItem.status` | Simulated eligibility: status ACCEPTED/REOPENED, no hold, ACCEPTED-class latest disposition | Append-only `ResponsePackageClosureRecord`-equivalent | Needs contract packet B3-P6 |
| 15 | Reopening | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `reopen()` | 19 | Prior CLOSED record is never mutated or removed | Simulated; reason required | Appends a REOPENED record; `closedAt`/`closedBy` projections clear, history remains | Needs contract packet B3-P6 |
| 16 | Cross-bid / cross-meeting / duplicate-link provenance guards | IMPLEMENTED (Register leg) + FIXTURE_SIMULATED (package leg) | `promoteMeetingActionItem` tenancy check + unique constraint (Register leg, real); `responsePackageSimulator.ts` `addItem` (package leg, simulated) | Both fixture layers | 7, 8, 9, 10 | N/A — these ARE the provenance guards | Both layers assert actor/bid scoping before any mutation | Rejected mutations never reach the audit-write step in either layer | None for the Register leg (already enforced in production); package leg needs B3-P1 schema to become real |
| 17 | Hold states (DISPUTED/BLOCKED) | FUTURE_CONTRACT / FIXTURE_SIMULATED | None on this branch | `responsePackageSimulator.ts` `setHold()`/`clearHold()` | 17 | Orthogonal to status; loop position preserved (contract §3.3, delta from Part E) | Simulated; reason required to set AND clear | Simulated audit entries `package_hold_set`/`package_hold_clear` | Needs contract packet B3-P6 |
| 18 | B3-P0 fixture-vocabulary reconciliation | DOCUMENTED (not a runtime object) | N/A | `tests/fixtures/r2-lifecycle/vocabulary-aliases.ts` | Referenced by 1-6, 25 (disposition vocabulary); 11 (transmittal numbering) | N/A | N/A | N/A | 2 of 4 legacy `dispositionType` values (`DEFER`, `VOID`) have **no** clean Build 3 mapping — recorded as CONFLICT, not silently resolved. See section below. |

## Packet B3-P0 assessment (required before Build 3 production implementation)

Per the frozen contract (§3.4 parenthetical, §7, §20 item 2, §24 dependency
graph "P0 ∥ P1 → P2 → ..."), a vocabulary reconciliation packet (B3-P0) must
land — docs/tests only, no schema — before Build 3 implementation begins.
This harness performed that evaluation (`vocabulary-aliases.ts`):

| Legacy fixture value (`ConsultantDispositionRecord`-style, borrowed as a Build 2/3 placeholder) | Frozen Build 3 `OriginatorDisposition.disposition` | Resolution |
|---|---|---|
| `APPROVE` | `ACCEPTED` | **Clean alias** — contract §3.4 states this mapping explicitly |
| `REJECT` | `REJECTED` | **Clean alias** — past-tense normalization only |
| `DEFER` | *(none)* | **CONFLICT** — no frozen value means "decision deferred"; `REVISE_AND_RESUBMIT` and `FIELD_VERIFICATION_REQUIRED` are both plausible but neither is contractually equivalent. Requires an explicit human decision, not a mechanical mapping. |
| `VOID` | *(none)* | **CONFLICT** — `VOID` is a `ResponsePackage`-level status (pre-transmit only) in the frozen contract, not an `OriginatorDisposition` value at all. A fixture using it at the disposition level conflates two different Build 3 concepts. |

Net-new Build 3 vocabulary with **zero** representation in any pre-existing
fixture (this harness authored these from scratch, per scenarios 2, 5, 6):
`ACCEPTED_WITH_COMMENTS`, `FIELD_VERIFICATION_REQUIRED`, `INFORMATIONAL`.

Transmittal numbering: existing fixtures use display strings like
`"TR-2024-031"` (year-scoped). The frozen contract requires an integer,
per-bid-monotonic `transmittalNumber` with a separate display format
`TX-{n} Response Rev {revisionIndex}` (contract §7). The legacy strings
cannot be mechanically converted into a monotonic sequence — this harness's
new fixtures adopt the frozen integer + display shape directly rather than
retrofitting the legacy strings.

**Conclusion: B3-P0 is required before Build 3 production implementation**,
and it is not fully mechanical — the `DEFER`/`VOID` conflicts need an
explicit operator/Fable decision. This harness does not resolve them; it
surfaces them, per the mission's instruction not to represent a fixture as
proof of production implementation.

## Namespace boundary (do not conflate)

`ConsultantDispositionRecord` (observation-level, Build 1, **IMPLEMENTED**,
real schema, append-only via `lib/prisma.ts` client extension) and
`OriginatorDisposition` (transmittal-level, Build 3, **FUTURE_CONTRACT**, no
schema on this branch) are explicitly distinct namespaces per contract §19.2:
neither reads nor writes the other. Nothing in this harness or its docs
proposes merging them.
