# Build 2 Acceptance Specification — R2 Field Response Certification

**Certification branch:** `gwx/r2-field-response-certification`
**Base commit:** `ffd5bd1`
**Date:** 2026-07-17
**Status:** FOUNDATION LAID — pending Fable's frozen domain contract

---

## Purpose

This specification defines the acceptance criteria for Build 2 of the R2
Meeting-to-Response Control Loop. Build 2 adds formal contractor response
management, GC compilation, and originator disposition on top of Build 1's
report upload and observation extraction foundation.

---

## Schema-Pending Capabilities (wait for Fable)

The following capabilities are intentionally deferred. Their fixtures and
expected output are documented here but implementation must wait for Fable's
frozen contract:

| Capability | Fixture | Status |
|---|---|---|
| Meeting Register schema | — | PENDING |
| Response-package schema | expected-gc-review.json | PENDING |
| Transmittal / return-to-originator schema | expected-originator-disposition.json | PENDING |
| Originator-disposition schema | expected-originator-disposition.json | PENDING |
| Closure state machine | — | PENDING |
| GC observation model | expected-gc-review.json `gcCommentary` field | PENDING |

---

## Build 2 Acceptance Gates

### Gate B2-01 — Numbered Observations

**Criterion:** Every observation within a report must receive a stable 1-based
display number in creation order (createdAt asc, id asc as tiebreaker).

**Current state:** No `observationNumber` field in schema. Display numbering
implemented as a pure utility (`assignDisplayNumbers`) in test infrastructure.

**Acceptance test:** `numberedObservations.test.ts` — ALL tests PASS.

**Blocker:** Schema field `observationNumber` or equivalent ordering contract
must be agreed with Fable before this gate is considered production-ready.

---

### Gate B2-02 — Page and Photo Citations

**Criterion:** `sourcePage` must be stored verbatim, frozen on first resolution,
and rendered in the PDF stream export. Photo references (`photoRef`) are documented
in fixtures as a future field — not yet in schema.

**Current state:** `sourcePage` is implemented and rendered in stream export
template. `photoRef` has zero schema footprint.

**Acceptance test:** `pagePhotoCitations.test.ts` — ALL tests PASS.

---

### Gate B2-03 — Trade Grouping

**Criterion:** `TrackedItem.tradeId` must be used to group items by trade in
the Operations Register. The `groupByTrade` utility sorts groups alphabetically;
items without a trade land in "Unassigned".

**Current state:** Schema relation exists (`TrackedItem.tradeId → Trade`);
no active code path writes or reads it in the OPS modules. UI shows flat table.

**Acceptance test:** `tradeGrouping.test.ts` — ALL tests PASS.

**Blocker:** Trade assignment UI and register grouping view must be implemented
before this gate is production-ready.

---

### Gate B2-04 — Formal Response + Revision

**Criterion:** Contractors must be able to submit a formal response and revise
it. Revision must record `formalResponsePrior`. Both saves are audited.
`formalResponseBy` must carry the authenticated user's identity.

**Current state:** Implemented and tested (`formalResponse.test.ts`,
`responseRevision.test.ts`). One response slot; revisions replace in place.

**Acceptance test:** `responseRevision.test.ts` — ALL tests PASS.

**Limitation:** No separate "contractor response" vs "PM response" role
distinction; no UI-visible revision history (prior stored for audit only).

---

### Gate B2-05 — GC Commentary Preservation

**Criterion:** GC commentary on an item must be preserved as a field separate
from `formalResponse`. It must appear in the compiled response output and the
return package. It must not be merged into `formalResponse` text.

**Current state:** `TrackedItemComment` (append-only) can carry GC commentary.
No dedicated GC commentary field or model yet — pending Fable's schema.

**Acceptance test:** `gcCommentary.test.ts` — ALL tests PASS.

**Blocker:** Dedicated `gcCommentary` field requires Fable's response-package
schema or a new model. Until then, `TrackedItemComment` is the interim carrier.

---

### Gate B2-06 — Revise-and-Resubmit Outcome

**Criterion:** An item on the R&R path must progress:
`OPEN → IN_PROGRESS → READY_TO_CLOSE` with an initial response, a REJECT/DEFER
disposition (originator level), and a revised response before final acceptance.

**Current state:** `TrackedItem` FSM supports `READY_TO_CLOSE`. Disposition
append is supported. Return-to-originator record requires Fable's schema.

**Acceptance test:** `reviseAndResubmit.test.ts` — ALL tests PASS.

---

### Gate B2-07 — Accepted Closure Outcome

**Criterion:** An item on the accepted-closure path must progress:
`OPEN → CLOSED` with a formal response and an APPROVE disposition. `closedAt`
and `closedBy` must be set by the FSM.

**Current state:** FSM implemented; `CLOSED` requires non-empty `closedBy`.
Disposition append implemented. Originator disposition record requires Fable's schema.

**Acceptance test:** `acceptedClosure.test.ts` — ALL tests PASS.

---

### Gate B2-08 — Relink Repair

**Criterion:** The `relinkObservation` service function must be reachable via
HTTP. `ACCEPTED_LINKED_ITEM` observations must be relinkable without passing
through dismiss+reinstate.

**Current state:** Route repaired in this certification pass —
`/api/bids/[id]/consultant-reports/[reportId]/observations/[observationId]/relink/route.ts`.

**Acceptance test:** `relink.test.ts` — ALL tests PASS.

---

### Gate B2-09 — PDF Stream Export

**Criterion:** The stream export must include formal responses (zero-copy rule:
first citation carries text, later citations reference). Dismissed observations
excluded by default. Cap: 500 observations, 2 MiB payload.

**Current state:** Fully implemented and tested (`streamExport.test.ts`).

**Acceptance test:** `streamExport.test.ts` — ALL tests PASS (existing).

---

### Gate B2-10 — GC Review Compilation (SCHEMA PENDING)

**Criterion:** GC must be able to compile all trade-grouped responses into a
single package and submit it for originator review.

**Current state:** Expected output documented in `expected-gc-review.json`.
No implementation pending Fable's frozen response-package schema.

**Blocker:** Fable's response-package contract required.

---

### Gate B2-11 — Return-to-Originator Record (SCHEMA PENDING)

**Criterion:** When the compiled response is sent back, a return record must
be created with: `transmittalNumber`, `returnedAt`, `originatorEmail`,
`trackedItemId`, `observationId`.

**Current state:** Expected structure documented in
`expected-originator-disposition.json`. No implementation yet.

**Blocker:** Fable's transmittal/originator-disposition schema required.

---

## Authorization Gaps Identified

The following authorization concerns were identified during this certification pass:

1. **`relink` route** (repaired): previously had no HTTP surface — the
   `relinkObservation` service existed but was unreachable, so any bid member
   with read access couldn't accidentally trigger it. Now properly guarded by
   `requireBidAccess` (matching other observation routes).

2. **No role distinction for formal response authors**: `formalResponseBy`
   records the authenticated user's name but there is no check that the user
   is a "contractor" role (no such role exists in the system). Any bid member
   with write access can set the formal response. This is by design in V1 but
   should be documented as a gap for future role-gating.

3. **GC commentary via TrackedItemComment**: the append-only comment model is
   guarded by bid access, but there is no check that a "GC" commenter is
   specifically an authorized GC representative. Any bid member can add
   comments labeled "GC Site Superintendent". This is an accepted V1 limitation.

4. **Observation extraction (permanently deferred)**: `parseStatus` remains
   `UNPARSED`. Any future extraction pipeline must be gated separately; the
   current harness intentionally never advances `parseStatus`.

---

## Local Evidence Commands

```bash
# Run all certification tests
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/numberedObservations.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/pagePhotoCitations.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/tradeGrouping.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/responseRevision.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/gcCommentary.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/reviseAndResubmit.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/acceptedClosure.test.ts
npx vitest run app/api/bids/\\[id\\]/consultant-reports/__tests__/relink.test.ts

# Run E2E harness in dry-run mode (no live server needed)
npx playwright test tests/field-response-certification/harness/ --reporter=list

# Run full unit test suite
npx vitest run

# Typecheck
npx tsc --noEmit

# Lint touched files
npx eslint \
  tests/field-response-certification/ \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/numberedObservations.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/pagePhotoCitations.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/tradeGrouping.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/responseRevision.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/gcCommentary.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/reviseAndResubmit.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/acceptedClosure.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/__tests__/relink.test.ts \
  app/api/bids/\\[id\\]/consultant-reports/\\[reportId\\]/observations/\\[observationId\\]/relink/route.ts
```
