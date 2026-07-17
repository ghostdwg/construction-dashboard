# Field Response Parity Matrix

**Branch:** `gwx/r2-field-response-certification` · **Base:** `ffd5bd1`
**Date:** 2026-07-17

This matrix records the current implementation state for each capability
in the R2 Field Response domain, relative to the certification requirements
in `tests/field-response-certification/BUILD2-ACCEPTANCE-SPEC.md`.

Tag legend: `[V]` = verified locally / unit-tested · `[INF]` = inferred from code ·
`[UNK]` = unknown / not verifiable without live system · `[PEND]` = schema pending

---

## Capability Matrix

| # | Capability | Status | Tag | Evidence |
|---|---|---|---|---|
| 1 | Architect Field Report upload | Implemented | [V] | `routes.test.ts` upload cases |
| 2 | Engineer Field Report upload | Implemented | [V] | Same route; reportType validated |
| 3 | ConsultantReport metadata (vendor, type, number, date) | Implemented | [V] | Schema + service |
| 4 | ConsultantReportRevision (corrected file, supersedesRevisionId) | Implemented | [V] | `routes.test.ts` revision cases |
| 5 | Report voiding (ACTIVE → VOIDED, audit) | Implemented | [V] | `routes.test.ts` void cases |
| 6 | Numbered observations (stable display number) | Partial | [V] | `assignDisplayNumbers` utility — no schema field |
| 7 | Observation text, sourcePage (verbatim, frozen on resolution) | Implemented | [V] | `observations.test.ts` freeze guard |
| 8 | consultantTargetDate (captured, NOT copied to dueDate) | Implemented | [V] | `observations.test.ts` accept-new |
| 9 | Photo reference (photoRef field) | Not implemented | [PEND] | No schema field — documented in fixtures only |
| 10 | Structured location field | Not implemented | [PEND] | Free-text sourcePage only; location in fixtures |
| 11 | Observation extraction / OCR from PDF | Not implemented | [INF] | parseStatus permanently UNPARSED in V0 |
| 12 | Observation state machine (ENTERED/ACCEPTED_NEW/ACCEPTED_LINKED/DISMISSED) | Implemented | [V] | `observations.ts` service + tests |
| 13 | Accept-new → TrackedItem (with sourceConsultantObservationId) | Implemented | [V] | `spawn.test.ts`, `observations.test.ts` |
| 14 | Accept-linked → TrackedItem (registerItemId only) | Implemented | [V] | `spawn.test.ts` — link sets only registerItemId |
| 15 | Spawn → TrackedItem (sets spawnedItemId AND registerItemId) | Implemented | [V] | `spawn.test.ts` — spawn sets both |
| 16 | Dismiss observation (ENTERED → DISMISSED, reason optional) | Implemented | [V] | `observations.test.ts` dismiss |
| 17 | Reinstate observation (DISMISSED → ENTERED) | Implemented | [V] | `observations.test.ts` reinstate |
| 18 | Relink observation (ACCEPTED_LINKED → ACCEPTED_LINKED, audit prior) | Implemented | [V] | `relink.test.ts` — **route added this pass** |
| 19 | Human disposition (APPROVE/REJECT/DEFER/VOID, append-only) | Implemented | [V] | `dispositions.test.ts` |
| 20 | Disposition log (chronological, latest = current) | Implemented | [V] | `dispositions.test.ts` GET cases |
| 21 | TrackedItem promotion (OAC meeting → ops register) | Implemented | [V] | `routes.test.ts` promote route |
| 22 | TrackedItem from FieldReport (FIELD_ITEM, sourceFieldReportId) | Implemented | [V] | `field-reports/__tests__/routes.test.ts` |
| 23 | Formal response (formalResponse, formalResponseBy, formalResponseAt) | Implemented | [V] | `formalResponse.test.ts` |
| 24 | Formal response revision (prior recorded in formalResponsePrior) | Implemented | [V] | `formalResponse.test.ts` second-save |
| 25 | Formal response audit (bounded ≤500 chars in DB, true length on item) | Implemented | [V] | `formalResponse.test.ts` bounded values |
| 26 | Formal response stdout safety (never echoes response text) | Implemented | [V] | `formalResponse.test.ts` stdout check |
| 27 | Contractor-specific response role | Not implemented | [INF] | No contractor role in auth system |
| 28 | Multiple contractor assignments (by tradeId + assigneeName) | Partial | [INF] | tradeId exists; no assignment UI or write path |
| 29 | GC-responsible item (tradeId=GC or assigneeName="GC") | Partial | [INF] | No GC role; can be approximated via assigneeName |
| 30 | Disputed responsibility tracking | Not implemented | [PEND] | No `responsibleParty` field — documented in fixtures |
| 31 | Informational observation (dismissed on upload) | Partial | [V] | DISMISSED state exists; no `isInformational` flag |
| 32 | Duplicate observation marker | Not implemented | [PEND] | No `isDuplicate` field — documented in fixtures |
| 33 | Trade grouping in register view | Partial | [V] | `groupByTrade` utility — no UI implementation |
| 34 | TradeId write path (assigning a trade to a TrackedItem) | Not implemented | [INF] | No trade picker in CreateItemForm or UpdateItemForm |
| 35 | GC observation / GC commentary model | Not implemented | [PEND] | Zero schema footprint — pending Fable's contract |
| 36 | GC compiled response (response-package schema) | Not implemented | [PEND] | Expected structure in expected-gc-review.json |
| 37 | Return-to-originator record | Not implemented | [PEND] | Expected structure in expected-originator-disposition.json |
| 38 | Transmittal number sequencing | Not implemented | [PEND] | In fixture; no schema or service |
| 39 | Closure state machine (OPEN→IN_PROGRESS→READY_TO_CLOSE→CLOSED) | Implemented | [V] | `fsm.ts` ALLOWED_TRANSITIONS |
| 40 | Revise-and-resubmit outcome | Partial | [V] | READY_TO_CLOSE state reached; originator R&R record pending |
| 41 | Accepted-closure outcome | Partial | [V] | CLOSED state + APPROVE disposition; originator return pending |
| 42 | TrackedItem attachments (photo/document, MIME-gated, download) | Implemented | [V] | `download.test.ts` |
| 43 | ConsultantReport attachments (inline PDF + attachment download) | Implemented | [V] | `download.test.ts` content-addressed |
| 44 | FieldReport source file (upload, MIME gate, re-upload cleanup) | Implemented | [V] | `field-reports/__tests__/routes.test.ts` |
| 45 | PDF stream export (SSE, cap, zero-copy response, immutable record) | Implemented | [V] | `streamExport.test.ts` |
| 46 | PDF stream export — observation count precheck before sidecar | Implemented | [V] | `streamExport.test.ts` cap test |
| 47 | PDF stream export — per-bid 429 (in-flight guard) | Implemented | [V] | `streamExport.test.ts` 429 test |
| 48 | Stream export download (authenticated, tenancy-checked) | Implemented | [V] | `streamExport.test.ts` download test |
| 49 | Observation extraction in PDF template (sourcePage rendering) | Implemented | [V] | Jinja2 template `consultant_stream.html.j2` line 71 |
| 50 | PM review flag | Implemented | [V] | `pmReviewFlag.test.ts` |

---

## Standalone Field Response Parity

There is **no standalone "Field Response" object** in this codebase. The concept
is implemented as:

| Standalone concept | Current implementation |
|---|---|
| "Contractor formal response" | `TrackedItem.formalResponse` (single slot) + `FormalResponseEditor` component |
| "Response author" | `TrackedItem.formalResponseBy` (authenticated user's name) |
| "Response history" | `TrackedItem.formalResponsePrior` (one prior level, audit-only) |
| "Response in export" | `buildStreamPayload` zero-copy inclusion in PDF stream |
| "GC response vs contractor response" | No distinction — single slot, any bid member |

**Gap:** Build 2 will need to introduce role separation (contractor vs PM vs GC)
for formal responses before the return-to-originator loop can carry appropriate
attribution metadata.

---

## Summary

| Category | Implemented | Partial | Not implemented |
|---|---|---|---|
| Report identity & upload | 5 | 0 | 0 |
| Observation lifecycle | 8 | 1 | 3 |
| TrackedItem promotion | 3 | 1 | 0 |
| Formal response | 5 | 0 | 1 |
| Trade grouping | 0 | 3 | 1 |
| GC / contractor assignment | 0 | 2 | 3 |
| Compilation & return | 0 | 0 | 4 |
| Attachments & downloads | 3 | 0 | 0 |
| PDF export | 5 | 0 | 0 |
| State machine / closure | 3 | 2 | 0 |
| **Total** | **32** | **9** | **12** |

12 capabilities are pending Fable's frozen domain contract. No capability was
removed or regressed in this certification pass.
