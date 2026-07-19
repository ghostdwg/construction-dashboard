# GroundWorX R2 — Auth/Durability Regression Pack — Coverage Matrix

Branch: `gwx/r2-auth-regression-pack` · Base: `c1312a7` · Owner: Builder-2 lane
(independent of the paused Codex SOL integration lane at
`gwx-sol-r2-ledger-integration`).

**Refreshed:** commit `59960cc` (`gwx/r2-auth-regression-pack-refresh`, on top
of `29f141b`) replaced the two Area F assertions that pinned the former
fail-open behavior of `acceptObservationAsNewItem` and
`linkObservationToItem` with `REQUIRED FAIL-CLOSED` assertions matching the
same in-transaction atomicity already proven for TrackedItem/FieldReport, and
added a third, previously-uncovered assertion for `relinkObservation`. This
matrix (`gwx/r2-auth-regression-coverage-refresh @ 59960cc`) reflects that
refresh. Only `__tests__/r2-regression/auditFailure.test.ts` changed in the
refresh commit — Areas A–E, G, H below are unchanged from the original pack.

All tests live under `__tests__/r2-regression/`. Run: `npx vitest run
__tests__/r2-regression/`. Every test uses in-memory mocked Prisma — no
staging, no production, no live provider, no real DB.

Status legend: **PASS** (proves correct behavior, currently true) ·
**EXPECTED PRODUCT FAILURE** (proves a real, reproducible gap — pinned, not
fixed here) · **REQUIRED FAIL-CLOSED (branch-local expected failure)** (asserts
the target fail-closed contract; this test-only branch's own product code is
deliberately unfixed, so the assertion fails here by design — see Area F) ·
**INFRASTRUCTURE BLOCKER** (could not be exercised in this environment) ·
**UNKNOWN** (not implemented / not testable on this branch) · **N/A**
(functionality does not exist on this branch — see note).

## A. Manual Meeting Register provenance

| Risk | Route/Service | Test file | Expected behavior | Actual | Status | Area | Rerun-safe on integrated branch? |
|---|---|---|---|---|---|---|---|
| Cross-bid segmentId accepted | `POST .../register` → `createManualEntry` | `registerProvenance.test.ts` | Rejected, zero writes | Rejected, zero writes | PASS | `lib/services/meetingRegister/register.ts` | Yes |
| Cross-meeting (same bid) segmentId accepted | same | same | Rejected, zero writes | Rejected, zero writes | PASS | same | Yes |
| Nonexistent segmentId accepted | same | same | Rejected, zero writes | Rejected, zero writes | PASS | same | Yes |
| Invalid segmentId (0/negative/non-integer) accepted | same | same | Rejected, zero writes | Rejected, zero writes | PASS | same | Yes |
| Probe distinguishes cross-bid/cross-meeting/nonexistent by error message | same | same | Identical error for all three | Identical (`"Segment not found"`) | PASS | same | Yes |
| Genuine own-meeting segmentId rejected (false positive) | same | same | Accepted, entry created with segmentId set | Accepted | PASS | same | Yes |

Route-level POST `.../register` had **no prior end-to-end test** (only
service-level in `lib/services/meetingRegister/__tests__/register.test.ts`
and route-level 403/404 guard checks in `.../register/__tests__/security.test.ts`)
— this file closes that gap independently.

## B. Transcript-correction atomicity

| Risk | Route/Service | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|---|
| Cross-bid meetingId in URL accepted | `POST .../segments/corrections` | `correctionAtomicity.test.ts` | 404, zero writes | 404, zero writes | PASS | `lib/services/meetingRegister/corrections.ts` | Yes |
| Cross-bid segmentId (valid meeting) accepted | same | same | Rejected, zero writes | Rejected, zero writes | PASS | same | Yes |
| Invalid correctionType reaches the service | same | same | 400 before service call | 400, zero writes | PASS | same | Yes |
| PATCH/PUT/DELETE mutate correction history | same | same | 405 always | 405 | PASS | same | Yes |
| Overlay mutation fails — history/audit still written? | `applyCorrection` (service) | same | No history/audit row created | None created | PASS | same | Yes |
| Correction-history append fails — overlay rolls back? | same | same | Segment text unchanged | Unchanged | PASS | same | Yes |
| Mandatory AuditEvent write fails — overlay+history roll back? | same | same | Both rolled back | Both rolled back | PASS | same | Yes |
| Repeated identical correction request — deduplicated? | same | same | NOT deduplicated (documented append-only contract); state converges, history does not | 2 correction rows, 2 audit rows, state converged | PASS (pins documented contract) | same | Yes |

## C. Meeting Register rerun durability

| Risk | Route/Service | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|---|
| Promoted / all 7 disposition states / manual-confirmed entries preserved in one combined rerun | `computeReconcile` | `rerunDurability.test.ts` | All `preserve`, none replaced | All `preserve` | PASS | `lib/services/meetingRegister/extractionRuns.ts` | Yes |
| SUPERSEDED entries re-touched by a later rerun | same | same | No outcome emitted at all | No outcome | PASS | same | Yes |
| Identical re-extraction duplicated | same | same | `unchanged`, no duplicate create | `unchanged` | PASS | same | Yes |
| Changed-wording draft double-classified (supersede AND create) | same | same | Classified once | Classified once (`supersede` only) | PASS | same | Yes |
| Two PENDING entries collapsing onto one draft become two independent creates | same | same | `supersede` + `merge`, zero creates | `supersede` + `merge`, zero creates | PASS | same | Yes |
| Promoted entry (`TrackedItem.sourceMeetingRegisterEntryId` origin) ever becomes a supersede/merge target | same | same | Always `preserve` — id/FK never orphaned | Always `preserve` | PASS | same | Yes |
| **Human-edited-but-still-PENDING entry survives a rerun that anchors a differently-worded draft to its segment** | same | same | Should preserve the human's edit | **Entry is `supersede`d — the edit is discarded from the active view** | **EXPECTED PRODUCT FAILURE** | `lib/services/meetingRegister/extractionRuns.ts` (`computeReconcile`'s Pass-0 preserve gate is `reviewState !== PENDING`; `editEntry()` never changes `reviewState`, so an edited-but-undispositioned entry is indistinguishable from an untouched one) | Yes — pins current behavior; test will need updating (not deleting) if this is ever fixed |

**Contrast note (not a test, evidentiary):** the sibling
`MeetingActionItem` reconcile in `lib/meeting-analysis.ts` (fixed by commit
`ac26c56`) explicitly guards this exact scenario via
`isReplaceable()`'s `!editedSinceCreate(row)` check. The
`MeetingRegisterEntry` reconcile added in the same era never received the
equivalent guard. **Product follow-up recommended** (not implemented here):
either give `editEntry()` a way to flag "reviewed" without a full
disposition, or add an edit-timestamp guard to `computeReconcile`'s Pass 0
analogous to `isReplaceable()`.

## D. Authorization ordering

| Risk | Route | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|---|
| `analyze` route (actual sidecar/Claude call site) does provider work before/despite denial | `POST .../meetings/[id]/analyze` | `authOrdering.test.ts` | Zero prisma reads, zero `getSetting`, zero `fetch` to sidecar | All zero | PASS | `app/api/.../analyze/route.ts` | Yes |
| Attachment upload parses body / writes blob before authorization | `POST .../tracked-items/[id]/attachments` | same | Zero `formData()`, zero blob put/delete, zero prisma | All zero | PASS | `app/api/.../attachments/route.ts` | Yes |
| Attachment list bypasses guard | `GET .../attachments` | same | Zero prisma calls | Zero | PASS | same | Yes |
| 8-route call-count matrix (tracked-items, field-reports, register, corrections GET+POST) does any prisma work when denied | various | same | Zero prisma calls, 403, for every route | Zero for all 8 | PASS | multiple | Yes |
| Control: authorized request actually reaches the data layer (proves the counter isn't a false negative) | `GET .../tracked-items` | same | ≥1 prisma call | 1+ | PASS (control) | — | Yes |

This closes a real gap: `meetings/[meetingId]/analyze` — the route that
actually calls the Python sidecar → Claude — had **no dedicated test at all**
prior to this pack (confirmed by repo inventory).

## E. Tenant isolation

| Relationship | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|
| Bid → Meeting | `tenantIsolation.test.ts` | Cross-bid meetingId rejected | Rejected | PASS | `lib/services/meetingRegister/corrections.ts` | Yes |
| Meeting → Meeting Register Entry | same | `findEntry`/`dispositionEntry`/`editEntry` never resolve cross-bid or cross-meeting; zero mutation | Confirmed | PASS | `lib/services/meetingRegister/register.ts` | Yes |
| Meeting → Transcript Segment | same | Cross-bid segmentId rejected even with valid meetingId | Rejected | PASS | `lib/services/meetingRegister/corrections.ts` | Yes |
| Meeting Register Entry → Tracked Item | same | `linkEntryToItem` rejects cross-bid trackedItemId; `promoteEntry` cannot write outside caller's bidId | Rejected / structurally impossible | PASS | `lib/services/meetingRegister/promotion.ts` | Yes |
| Tracked Item → Consultant Observation | same | `linkObservationToItem` rejects cross-bid itemId, zero state change; `acceptObservationAsNewItem` cannot resolve a cross-bid observation | Rejected | PASS | `lib/services/consultantReports/observations.ts` | Yes |
| Tracked Item → Field Observation | same | `createItemFromFieldReport` rejects cross-bid fieldReportId, zero writes | Rejected | PASS | `lib/services/trackedItems/index.ts` | Yes |
| Observation → Response Package | — | N/A | `ResponsePackage`/`ResponsePackageItem`/`TradeResponseRevision`/`ResponseAccessToken` are **not implemented** as Prisma models on this branch — design spec only (`docs/architecture/R2_MEETING_RESPONSE_CONTROL_LOOP.md`). No route, no service, no migration exists to test. | **UNKNOWN / N/A** | — | Re-evaluate once GWX-Q07-class work lands the schema |
| `sourceMeetingRegisterEntryId` / `sourceMeetingActionItemId` cross-tenant reuse | see Area G | Unique-guarded, single-bid provenance | Confirmed | PASS | see Area G | Yes |
| Originating observation links | same as Observation row above | Rejected | Rejected | PASS | `lib/services/consultantReports/observations.ts` | Yes |
| Attachment ownership | `authOrdering.test.ts` (GET/POST attachments) | Cross-bid item never resolves; zero blob I/O | Confirmed (via authorization-denial path; tenancy check is the same `trackedItemExists(bidId, itemId)` gate) | PASS | `app/api/.../attachments/route.ts` | Yes |
| Response provenance | `tenantIsolation.test.ts` (`setFormalResponse`) | Closest existing analog to "response provenance" (`TrackedItem.formalResponse`) rejects cross-bid itemId, no leak of prior value | Rejected, prior value unexposed | PASS | `lib/services/consultantReports/formalResponse.ts` | Yes |

## F. Audit and domain-history failure

**Authoritative-history determination** (from source reading — see file
header of `auditFailure.test.ts` for full citations):
- TrackedItem / FieldReport: `AuditEvent` only, written **inside** the
  mutation's `$transaction` — fail-closed.
- Meeting Register: `MeetingRegisterEntryRevision` (domain-specific) +
  `AuditEvent`, both written in the same transaction — fail-closed.
- Consultant Report / Observation accept/link/relink: the mandatory
  audit/history record is now **required** to commit atomically with the
  product mutation — fail-closed is the target contract asserted by the three
  `REQUIRED FAIL-CLOSED` rows below (refreshed by commit `59960cc`, replacing
  the two rows that previously pinned fail-open behavior as an
  `EXPECTED PRODUCT FAILURE`).

**Two environments, by design:**
1. **This branch's own product code** (`lib/services/consultantReports/observations.ts`
   on `gwx/r2-auth-regression-pack-refresh` / `gwx/r2-auth-regression-coverage-refresh`)
   is **intentionally left unfixed** — mission scope for both the original
   pack and the refresh was tests-only, no product-code changes. It still
   routes accept/link/relink through the legacy `index.ts` `audit()` helper,
   which wraps `emitAuditEvent()` in try/catch and swallows failures. The
   three `REQUIRED FAIL-CLOSED` assertions therefore **fail on this branch by
   design** — that failure is the expected mirror image of the finding they
   replace, not a regression to fix here.
2. **A disposable, uncommitted clone of the repaired SOL candidate**
   (`gwx-sol-r2-ledger-integration @ 9b283b9`, built and torn down entirely
   under `/tmp`, never touching the real SOL worktree) carries a fix: accept,
   link, and relink run inside `prisma.$transaction(...)` and call
   `writeConsultantAuditTx` (`lib/services/consultantReports/txAudit.ts`),
   which does an unguarded `auditEvent.create` — a failure propagates and
   Prisma rolls the whole transaction back, architecturally identical to the
   TrackedItem/FieldReport pattern. Against that disposable candidate, all
   three assertions pass. The SOL candidate itself remains **uncommitted,
   unstaged, and blocked from commit approval** (see
   `/tmp/gwx-r2-ledger-integration-repair/r2-targeted-blocker-repair-validation.md`)
   — it is not committed, merged, approved, staged, or production-ready.

| Risk | Service | Test file | Expected behavior | Actual (this branch's own unfixed code) | Actual (disposable repaired SOL candidate) | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|---|---|
| Audit-store failure during TrackedItem create | `createTrackedItem` | `auditFailure.test.ts` | Throws, zero rows persist | Confirmed | Confirmed | PASS | `lib/services/trackedItems/index.ts` | Yes |
| Update on nonexistent item emits an audit row anyway | `updateTrackedItem` | same | Zero audit rows | Zero | Zero | PASS | same | Yes |
| Invalid patch (bad priority) emits an audit row anyway | same | same | Audit count unchanged | Unchanged | Unchanged | PASS | same | Yes |
| Audit-store failure during FieldReport create | `createFieldReport` | same | Throws, zero rows persist | Confirmed | Confirmed | PASS | `lib/services/fieldReports/index.ts` | Yes |
| Stdout telemetry failure un-persists an already-committed mutation | `createTrackedItem` | same | DB rows remain durable regardless of telemetry outcome | Rows present despite a thrown telemetry call | Rows present despite a thrown telemetry call | PASS | `lib/observability/audit.ts` | Yes |
| **`acceptObservationAsNewItem` rolls back entirely when AuditEvent writes are broken** | same | same | Rejects; zero TrackedItem row, observation stays `ENTERED`, zero AuditEvent row | **Fails — this branch's own code still commits fail-open** (expected, by design) | **Passes — rejects, zero TrackedItem row, `ENTERED`/`registerItemId: null` preserved, zero AuditEvent row** | **REQUIRED FAIL-CLOSED** (branch-local expected failure) | `lib/services/consultantReports/observations.ts` | Yes — assertion form is stable; only the branch under test differs |
| **`linkObservationToItem` rolls back entirely when AuditEvent writes are broken** | same | same | Rejects; `ENTERED`/`registerItemId: null` preserved, zero AuditEvent row | **Fails — this branch's own code still commits fail-open** (expected, by design) | **Passes — rejects, prior state preserved, zero AuditEvent row** | **REQUIRED FAIL-CLOSED** (branch-local expected failure) | same | Yes |
| **`relinkObservation` rolls back entirely when AuditEvent writes are broken (new — no prior dedicated coverage)** | same | same | Rejects; observation stays linked to the original item (no partial relink), no new AuditEvent row for the failed attempt | **Fails — this branch's own code still commits fail-open** (expected, by design) | **Passes — rejects, original link (item A) preserved, no new AuditEvent row** | **REQUIRED FAIL-CLOSED** (branch-local expected failure) | same | Yes |

On this branch, running `npx vitest run __tests__/r2-regression/` produces
**Test Files 1 failed \| 7 passed (8)**, **Tests 3 failed \| 65 passed (68)**
— the 3 failures are exactly the 3 `REQUIRED FAIL-CLOSED` rows above, and are
expected. Against the disposable repaired SOL candidate (full pack overlaid),
the same run produces **Test Files 8 passed (8)**, **Tests 68 passed (68)**.

**Product follow-up recommended** (not implemented on this test-only branch;
already delivered on the disposable SOL candidate above, which is not yet
committed anywhere): migrate
`lib/services/consultantReports/observations.ts`'s state-changing mutations
(accept/link/relink/dismiss/reinstate) to the same in-transaction
`persistAuditEnvelope` pattern already proven in `trackedItems/index.ts` and
`fieldReports/index.ts`. `setFormalResponse` in `formalResponse.ts` has the
identical fail-open shape and should be covered by the same follow-up.

### Builder-2 finding disposition

- **Finding 1 — rerun durability, human-edited PENDING Meeting Register
  entries not protected from supersession (Area C).** Not touched by this
  refresh — the refresh's mission scope was limited to the two Consultant
  Observation audit assertions plus adding relink coverage; Area C's own test
  row is unchanged. Independent SOL-candidate validation reports this
  **RESOLVED for supported application mutations**: revision-backed edits and
  other durable operational evidence (non-machine/manual origin, tracked-item
  link, prior/merge link, disposition evidence, creator evidence, promoted
  state) survive preview and apply. That validation also states an
  **unsupported direct database edit that writes no revision or other
  durable evidence remains indistinguishable from a pristine machine
  proposal** — this case is not, and must not be described as, protected.
- **Finding 2 — `acceptObservationAsNewItem` audit fail-open.** **RESOLVED**
  on the disposable repaired SOL candidate (transactional
  `writeConsultantAuditTx`, confirmed by inspection and by the refreshed
  assertion passing there). Not fixed on this test-only branch itself, by
  design.
- **Finding 3 — `linkObservationToItem` audit fail-open, including relink.**
  **RESOLVED** on the disposable repaired SOL candidate for both link and
  relink; both refreshed assertions pass there. Not fixed on this test-only
  branch itself, by design.

## G. Duplicate promotion and provenance

| Risk | Service | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|---|
| Duplicate promotion, same Register Entry (sequential) | `promoteEntry` | `duplicatePromotion.test.ts` | Second call rejected, 1 TrackedItem total | Confirmed | PASS | `lib/services/meetingRegister/promotion.ts` | Yes |
| Duplicate promotion, same Register Entry (race — P2002) | same | same | DB-level unique guard catches it, friendly error, no orphan revision row | Confirmed | PASS | same | Yes |
| Link after promotion | `linkEntryToItem` | same | Rejected (already linked) | Rejected | PASS | same | Yes |
| Duplicate promotion, same MeetingActionItem (sequential) | `promoteMeetingActionItem` | same | Second call rejected, 1 TrackedItem total | Confirmed | PASS | `lib/services/trackedItems/index.ts` | Yes |
| Duplicate promotion, same MeetingActionItem (P2002 mapping) | same | same | Friendly error, never a 500 | Confirmed | PASS | same | Yes |
| Duplicate accept-as-new, same ConsultantObservation | `acceptObservationAsNewItem` | same | Second call rejected (state machine), 1 TrackedItem total | Confirmed | PASS | `lib/services/consultantReports/observations.ts` | Yes |
| Many observations linking to ONE TrackedItem | `linkObservationToItem` | same | Both succeed — `registerItemId` not unique, contract allows it | Both succeed | PASS | same | Yes |
| Many TrackedItems citing ONE FieldReport | `createItemFromFieldReport` | same | Both succeed — `sourceFieldReportId` deliberately not unique | Both succeed | PASS | `lib/services/trackedItems/index.ts` | Yes |

## H. Real authenticated route behavior

| Risk | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|
| No session at all | `authenticatedRoute.test.ts` | Real `requireUser()` throws 401, route returns 401 | Confirmed | PASS | `lib/auth-helpers.ts` (real, unmocked) | Yes |
| Authenticated non-owner, non-admin | same | Real `assertBidAccess()` throws 403 | Confirmed | PASS | same | Yes |
| Authenticated owner | same | Real `assertBidAccess()` allows; route reaches data layer, 200/201 | Confirmed | PASS | same | Yes |
| Admin bypass | same | Real admin short-circuit allows access to a bid the admin doesn't own | Confirmed | PASS | same | Yes |
| Unknown bidId | same | 404 (never 403 — cross-project 404 discipline) | Confirmed | PASS | same | Yes |

**Genuinely authenticated:** `getUser()`/`requireUser()`/`bidScopeFilter()`/
`assertBidAccess()`/`requireBidAccess()` — real code, not mocked. **Mocked:**
next-auth's `auth()` session resolver (fixed session object, no real
JWT/cookie), Prisma (in-memory fixture). **Not verified here:** the
`proxy.ts` session wall itself (has its own `__tests__/proxy.test.ts`), real
next-auth JWT issuance, any real DB round-trip. `AUTH_DISABLED` is never set
anywhere in this pack.

## Summary

As of the refresh (commit `59960cc`), the pack is **68** `it()` assertions
across 8 files (was 67; the refresh replaced 2 Area F assertions with 3 —
adding dedicated `relinkObservation` coverage that did not exist before). On
this branch's own vitest run that is **65 raw-passing, 3 raw-failing (68
total)** — matching the file-level result recorded in Area F. The categories
below classify risk-row behavior (as in the original doc, not strictly 1:1
with individual `it()` blocks, and not a strict partition of the 68); the
Area C `EXPECTED PRODUCT FAILURE` row below is one of the 65 raw-passing
tests (it pins current, undesired behavior with a currently-green assertion).
None of Area F's 5 pre-existing PASS rows (TrackedItem/FieldReport/telemetry)
changed in this refresh — only the two accept/link rows changed category
(EXPECTED PRODUCT FAILURE → REQUIRED FAIL-CLOSED) and relink was added, so
the PASS count is unchanged from the original doc.

- **PASS (proves correct, desired behavior):** 65 risk rows (unchanged).
- **REQUIRED FAIL-CLOSED, branch-local expected failure (Area F):** 3 —
  `acceptObservationAsNewItem`, `linkObservationToItem`, and
  `relinkObservation` audit-rollback assertions. These fail on this test-only
  branch by design (its own `lib/services/consultantReports/observations.ts`
  is deliberately unfixed) and are independently verified to **pass 3/3**
  against a disposable, uncommitted clone of the repaired SOL candidate — see
  Area F for the full disposition. This replaces the former
  `EXPECTED PRODUCT FAILURE` entry for the same two mutations (accept/link),
  which is superseded by the refresh.
- **EXPECTED PRODUCT FAILURE (pinned, not fixed on this branch):** 1 —
  human-edited PENDING register entries not protected from rerun supersession
  (Area C). Unchanged by this refresh; see Builder-2 Finding 1 in Area F for
  the SOL-candidate disposition of this same finding.
- **INFRASTRUCTURE BLOCKER:** 1, resolved during the original pass — a fresh
  checkout's `node_modules`/generated Prisma client were absent
  (`npm install` + `npx prisma generate` fixed it; not a product defect, see
  the durable report).
- **UNKNOWN / N/A:** 1 — Response Package tenant isolation, because the
  schema does not exist yet on this branch.
- **PREEXISTING FAILURES:** 0 (per the original delivery report, once the
  Prisma client was generated, the full pre-existing suite — 159 files / 1723
  tests — passed cleanly; not re-run as part of this refresh).

**Broader focused validation (disposable repaired SOL candidate only, not
this branch):** with the refreshed pack overlaid, a combined focused run
across `app/api/bids/[id]/consultant-reports`,
`app/api/bids/[id]/tracked-items`, `lib/services/consultantReports`,
`lib/services/trackedItems`, and `lib/services/fieldReports` reports
**151/151 passing** (18 test files), including the SOL lane's own
`observations.test.ts`, `spawn.test.ts`, and `linkObservation.test.ts`. This
151/151 figure is a distinct scope from, and must not be merged with, the
repair-validation report's separate "158/158" reconstructed-historical-scope
figure (Meeting Register/upload/retention suites) — the two runs cover
different file sets.

Every PASS/EXPECTED-PRODUCT-FAILURE/REQUIRED-FAIL-CLOSED test in this pack
uses only in-memory mocked Prisma and mocked auth/storage/provider seams —
none of it depends on staging, production, or any branch-specific fixture
beyond the R2 domain models already in `prisma/schema.prisma` at this
branch's base commit. It is therefore safe to re-run unchanged against the
eventual integrated branch, PROVIDED the integrated branch has not
renamed/removed any of the imported service functions or route handlers
listed above (a normal merge of already-reviewed, non-conflicting work should
not do so). The disposable SOL candidate referenced throughout Area F remains
**uncommitted, unstaged, and blocked from commit approval** as of the
repair-validation report — nothing in this refresh changes that status.
