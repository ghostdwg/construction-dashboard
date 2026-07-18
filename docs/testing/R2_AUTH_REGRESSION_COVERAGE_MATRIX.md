# GroundWorX R2 — Auth/Durability Regression Pack — Coverage Matrix

Branch: `gwx/r2-auth-regression-pack` · Base: `c1312a7` · Owner: Builder-2 lane
(independent of the paused Codex SOL integration lane at
`gwx-sol-r2-ledger-integration`).

All tests live under `__tests__/r2-regression/`. Run: `npx vitest run
__tests__/r2-regression/`. Every test uses in-memory mocked Prisma — no
staging, no production, no live provider, no real DB.

Status legend: **PASS** (proves correct behavior, currently true) ·
**EXPECTED PRODUCT FAILURE** (proves a real, reproducible gap — pinned, not
fixed here) · **INFRASTRUCTURE BLOCKER** (could not be exercised in this
environment) · **UNKNOWN** (not implemented / not testable on this branch) ·
**N/A** (functionality does not exist on this branch — see note).

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
- Consultant Report / Observation: legacy `emitAuditEvent()`/`audit()` path
  — wrapped in try/catch, swallows failures — **fail-open**.

| Risk | Service | Test file | Expected behavior | Actual | Status | Area | Rerun-safe? |
|---|---|---|---|---|---|---|---|
| Audit-store failure during TrackedItem create | `createTrackedItem` | `auditFailure.test.ts` | Throws, zero rows persist | Confirmed | PASS | `lib/services/trackedItems/index.ts` | Yes |
| Update on nonexistent item emits an audit row anyway | `updateTrackedItem` | same | Zero audit rows | Zero | PASS | same | Yes |
| Invalid patch (bad priority) emits an audit row anyway | same | same | Audit count unchanged | Unchanged | PASS | same | Yes |
| Audit-store failure during FieldReport create | `createFieldReport` | same | Throws, zero rows persist | Confirmed | PASS | `lib/services/fieldReports/index.ts` | Yes |
| Stdout telemetry failure un-persists an already-committed mutation | `createTrackedItem` | same | DB rows remain durable regardless of telemetry outcome | Rows present despite a thrown telemetry call | PASS | `lib/observability/audit.ts` | Yes |
| **`acceptObservationAsNewItem` commits despite a broken audit store** | same | same | Ideally rolls back (parity with TrackedItem/FieldReport) | **Commits — TrackedItem created, observation state advanced, zero AuditEvent row** | **EXPECTED PRODUCT FAILURE** | `lib/services/consultantReports/observations.ts` + `index.ts`'s fail-open `audit()` | Yes — pins current behavior |
| **`linkObservationToItem` commits despite a broken audit store** | same | same | Ideally rolls back | **Commits — link recorded, zero AuditEvent row** | **EXPECTED PRODUCT FAILURE** | same | Yes — pins current behavior |

**Product follow-up recommended** (not implemented here): migrate
`lib/services/consultantReports/observations.ts`'s state-changing mutations
(accept/link/relink/dismiss/reinstate) to the same in-transaction
`persistAuditEnvelope` pattern already proven in `trackedItems/index.ts` and
`fieldReports/index.ts`. `setFormalResponse` in `formalResponse.ts` has the
identical fail-open shape and should be covered by the same follow-up.

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

- **PASS:** 65 of 67 new assertions' worth of behavior (grouped above by
  risk row, not 1:1 with individual `it()` blocks — see the report for the
  raw test/assertion count).
- **EXPECTED PRODUCT FAILURE (pinned, not fixed):** 3 — human-edited PENDING
  register entries not protected from rerun supersession; consultant
  observation accept/link mutations are audit fail-open (2 mutations).
- **INFRASTRUCTURE BLOCKER:** 1, resolved during this pass — a fresh
  checkout's `node_modules`/generated Prisma client were absent
  (`npm install` + `npx prisma generate` fixed it; not a product defect, see
  the durable report).
- **UNKNOWN / N/A:** 1 — Response Package tenant isolation, because the
  schema does not exist yet on this branch.
- **PREEXISTING FAILURES:** 0 (once the Prisma client was generated, the
  full pre-existing suite — 159 files / 1723 tests — passes cleanly).

Every PASS/EXPECTED-PRODUCT-FAILURE test in this pack uses only in-memory
mocked Prisma and mocked auth/storage/provider seams — none of it depends on
staging, production, or any branch-specific fixture beyond the R2 domain
models already in `prisma/schema.prisma` at this branch's base commit. It is
therefore safe to re-run unchanged against the eventual integrated branch,
PROVIDED the integrated branch has not renamed/removed any of the imported
service functions or route handlers listed above (a normal merge of
already-reviewed, non-conflicting work should not do so).
