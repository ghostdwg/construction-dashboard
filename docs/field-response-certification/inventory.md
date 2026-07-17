# Field Response Certification — Source / Schema / Route / Test Inventory

**Branch:** `gwx/r2-field-response-certification` · **Base:** `ffd5bd1`
**Date:** 2026-07-17

---

## 1. Prisma Schema

**File:** `prisma/schema.prisma`

| Model | Line | Key fields |
|---|---|---|
| `Trade` | 68 | `id`, `name`, `costCode`, `csiCode`, `isActive`, `trackedItems TrackedItem[]` |
| `FieldReport` | 4064 | `parseStatus @default("UNPARSED")` (V0 only), `sourceFileStorageKey`, `authorName`, `reportDate`, `originalFileName`, `mimeType`, `byteSize` |
| `TrackedItem` | 3965 | 9 `kind` values, 5 FSM `status` values, `formalResponse/By/At/Prior`, `sourceConsultantObservationId @unique`, `sourceMeetingActionItemId @unique`, `sourceFieldReportId`, `tradeId` (FK, nullable), `pmReviewRequired`, `sourceKind`, `evidenceExcerpt`, `sourceLocator`, `extractionMethod`, `citationVerified` |
| `TrackedItemComment` | 4037 | `body`, `authorName`, `authorEmail`, `createdAt` (append-only) |
| `TrackedItemAttachment` | 4240 | `kind` (photo/document), `storageKey`, `byteSize` |
| `ConsultantReport` | 4101 | `vendorName`, `reportType` (5 values), `status` (ACTIVE/VOIDED), `reportNumber`, `reportNumberNormalized` (soft dup only) |
| `ConsultantReportRevision` | 4135 | `storedKey`, `checksum`, `supersedesRevisionId @unique`, `@@unique([bidId, checksum])` |
| `ConsultantObservation` | 4167 | `observationText`, `sourcePage`, `consultantTargetDate`, `state` (4 values), `registerItemId` (SetNull), `spawnedItemId` (SetNull), `dismissedReason` |
| `ConsultantDispositionRecord` | 4200 | `dispositionType` (APPROVE/REJECT/DEFER/VOID), `disposedBy` (required), append-only |
| `ConsultantStreamExport` | 4223 | `storedKey`, `sha256`, `byteSize`, `observationCount`, `filtersJson`, `generatedBy` |

**Missing from schema (pending Fable's frozen contract):**

- `observationNumber` / sequence field on `ConsultantObservation`
- `photoRef` on `ConsultantObservation`
- `GCObservation` or GC commentary model
- `ReturnToOriginator` / transmittal model
- Response-package / originator-disposition model
- Hard uniqueness on `ConsultantReport.reportNumberNormalized`

---

## 2. Service Layer

**Directory:** `lib/services/consultantReports/`

| File | Exports |
|---|---|
| `index.ts` | `uploadConsultantReport`, `uploadCorrectedRevision`, `listConsultantReports`, `getConsultantReport`, `resolveServableRevision`, `voidConsultantReport`, `audit`, `actorLabel`, `Actor`, `ServiceResult` |
| `observations.ts` | `createObservation`, `editObservation`, `acceptObservationAsNewItem`, `spawnItemFromObservation`, `linkObservationToItem`, `relinkObservation`, `dismissObservation`, `reinstateObservation`, `OBSERVATION_STATES` |
| `formalResponse.ts` | `setFormalResponse` |
| `dispositions.ts` | `appendDisposition`, `listDispositions` |
| `streamExport.ts` | `buildStreamPayload`, `generateStreamExport`, `countExportObservations`, `MAX_EXPORT_OBSERVATIONS`, `MAX_EXPORT_PAYLOAD_BYTES` |
| `pdfValidation.ts` | `validatePdfMagicBytes` |
| `storagePath.ts` | `consultantReportRevisionKey` |

**Directory:** `lib/services/trackedItems/`

| File | Exports |
|---|---|
| `index.ts` | `listTrackedItems`, `getTrackedItem`, `createTrackedItem`, `promoteMeetingActionItem`, `createItemFromFieldReport`, `updateTrackedItem`, `transitionTrackedItem`, `addComment`, `listComments`, `recordAttachment`, `listAttachments`, `trackedItemExists`, `itemIdsWithDispositions` |
| `fsm.ts` | `ALLOWED_TRANSITIONS`, `TRACKED_ITEM_PRIORITIES`, `isTrackedItemKind` |

---

## 3. API Routes

### Consultant Reports — `app/api/bids/[id]/consultant-reports/`

| Segment | Methods | Notes |
|---|---|---|
| `route.ts` | GET, POST | List + upload |
| `[reportId]/route.ts` | GET | Inline PDF (Content-Disposition: inline) |
| `[reportId]/detail/route.ts` | GET | Full detail + observations |
| `[reportId]/download/route.ts` | GET | Attachment download |
| `[reportId]/void/route.ts` | POST | pm\|admin only |
| `[reportId]/revisions/route.ts` | POST | Corrected revision (supersedesRevisionId set-once) |
| `[reportId]/observations/route.ts` | GET, POST | List + create |
| `[reportId]/observations/[observationId]/route.ts` | PATCH | Pre-resolution edit |
| `[reportId]/observations/[observationId]/accept-new/route.ts` | POST | ENTERED → ACCEPTED_NEW_ITEM |
| `[reportId]/observations/[observationId]/spawn/route.ts` | POST | pm\|admin only; sets spawnedItemId + registerItemId |
| `[reportId]/observations/[observationId]/dismiss/route.ts` | POST | ENTERED → DISMISSED |
| `[reportId]/observations/[observationId]/reinstate/route.ts` | POST | DISMISSED → ENTERED |
| `[reportId]/observations/[observationId]/relink/route.ts` | POST | **ADDED** — ACCEPTED_LINKED_ITEM → ACCEPTED_LINKED_ITEM (correction) |
| `[reportId]/observations/[observationId]/dispose/route.ts` | POST, GET; 405 PATCH/PUT/DELETE | Append-only disposition log |
| `export-pdf/route.ts` | POST | SSE stream export |
| `export-pdf/[exportId]/download/route.ts` | GET | Authenticated download |

### TrackedItems — `app/api/bids/[id]/tracked-items/`

| Segment | Methods | Notes |
|---|---|---|
| `route.ts` | GET, POST | List (with filters) + create |
| `promote/route.ts` | POST | Promote from meeting |
| `[itemId]/route.ts` | GET, PATCH, DELETE | CRUD |
| `[itemId]/status/route.ts` | PATCH | FSM transition |
| `[itemId]/formal-response/route.ts` | PATCH | Set/update formal response |
| `[itemId]/link-observation/route.ts` | POST | Link observation to item |
| `[itemId]/comments/route.ts` | GET, POST | Comment thread |
| `[itemId]/attachments/route.ts` | POST | Upload attachment |
| `[itemId]/attachments/[attachmentId]/download/route.ts` | GET | Download attachment |
| `[itemId]/pm-review-flag/route.ts` | PATCH | PM review flag |

### Field Reports — `app/api/bids/[id]/field-reports/`

| Segment | Methods | Notes |
|---|---|---|
| `route.ts` | GET, POST | List + create |
| `[fieldReportId]/route.ts` | GET, PATCH | Detail + update |
| `[fieldReportId]/upload/route.ts` | POST | Upload PDF |
| `[fieldReportId]/download/route.ts` | GET | Download |
| `[fieldReportId]/tracked-items/route.ts` | POST | Create TrackedItem from report |

---

## 4. Test Files

### Existing tests

| File | Module | Coverage |
|---|---|---|
| `consultant-reports/__tests__/routes.test.ts` | OPS3 | Upload, list, revisions, void |
| `consultant-reports/__tests__/observations.test.ts` | OPS3 | Create, edit, freeze, accept-new, dismiss, reinstate |
| `consultant-reports/__tests__/spawn.test.ts` | OPS4 | Spawn vs accept-new vs link semantics |
| `consultant-reports/__tests__/dispositions.test.ts` | OPS3 | Append, GET, 405 guards |
| `consultant-reports/__tests__/download.test.ts` | OPS3 | Inline/attachment headers, tenancy, revisionId |
| `consultant-reports/__tests__/streamExport.test.ts` | OPS6 | SSE export + download route |
| `tracked-items/__tests__/routes.test.ts` | OPS2 | CRUD, filters |
| `tracked-items/__tests__/formalResponse.test.ts` | OPS3 | First/second save, audit bounds, stdout safety |
| `tracked-items/__tests__/linkObservation.test.ts` | OPS3 | Link action |
| `tracked-items/__tests__/download.test.ts` | OPS3 | Attachment download |
| `tracked-items/__tests__/pmReviewFlag.test.ts` | OPS4 | PM flag |
| `field-reports/__tests__/routes.test.ts` | OPS2 | CRUD, upload, re-upload, create item |
| `bids/[id]/__tests__/opsAcceptanceUxCopy.test.ts` | OPS3 | Nav labels, empty states, scope guards |
| `bids/[id]/__tests__/opsPolishUxCopy.test.ts` | OPS4 | Promote picker, status chips, OVERDUE |
| `lib/services/consultantReports/__tests__/pdfValidation.test.ts` | OPS3 | Magic byte validation |
| `lib/services/consultantReports/__tests__/storagePath.test.ts` | OPS3 | Key shape |
| `sidecar/routers/__tests__/test_consultant_stream_pdf.py` | OPS6 | Sidecar payload validation, summary |

### Certification tests added

| File | Gate |
|---|---|
| `consultant-reports/__tests__/numberedObservations.test.ts` | B2-01 |
| `consultant-reports/__tests__/pagePhotoCitations.test.ts` | B2-02 |
| `consultant-reports/__tests__/tradeGrouping.test.ts` | B2-03 |
| `consultant-reports/__tests__/responseRevision.test.ts` | B2-04 |
| `consultant-reports/__tests__/gcCommentary.test.ts` | B2-05 |
| `consultant-reports/__tests__/reviseAndResubmit.test.ts` | B2-06 |
| `consultant-reports/__tests__/acceptedClosure.test.ts` | B2-07 |
| `consultant-reports/__tests__/relink.test.ts` | B2-08 |
| `tests/field-response-certification/harness/e2e-dry-run.spec.ts` | All (dry run) |

---

## 5. Migrations

**Pending staging migrations** (from Ledger §9.6):

- `20260521020000_addendum_meeting_storage_keys`
- `20260521030000_background_job_dedupe_key`

**Schema changes required for Build 2 (pending Fable's contract):**

- None implemented in this certification pass.
- Future migrations must add: `observationNumber`, `photoRef`, GC model, transmittal model, originator-disposition model.

---

## 6. Fixtures

**Directory:** `tests/field-response-certification/fixtures/`

| File | Purpose |
|---|---|
| `synthetic-afr.json` | Synthetic Architect Field Report (7 obs) |
| `synthetic-efr.json` | Synthetic Engineer Field Report (5 obs, 3 contractor assignments) |
| `expected-extraction.json` | Extraction certification target (all obs, photo refs) |
| `expected-trade-grouping.json` | 8 trade groups, 8 active items, summary stats |
| `expected-contractor-responses.json` | 3 response scenarios (R&R, accepted, GC-responsible) |
| `expected-gc-review.json` | Compiled GC response (4 trade groups, commentary preserved) |
| `expected-originator-disposition.json` | 3 disposition records with transmittal numbers |

**Builder module:** `tests/field-response-certification/unit-integration-builders.ts`

Exports: `makeAFR`, `makeEFR`, `makeObservation`, `makeArchitecturalObservation`,
`makeStructuralObservation`, `makeMechanicalObservation`, `makeElectricalObservation`,
`makeInformationalObservation`, `makeDuplicateObservation`, `makeDisputedObservation`,
`makeTrackedItem`, `makeDisposition`, `groupByTrade`, `assignDisplayNumbers`,
`FIXTURE_TRADES`, `tradeById`, `buildReviseAndResubmitScenario`,
`buildAcceptedClosureScenario`, `nextId`, `resetIds`.
