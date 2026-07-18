# R2 Build 2 trade response packages

This implementation completes the locally verifiable Part D workflow from a human report observation through an Operations Register item, a contractor response package, immutable response revisions, and GC review. It deliberately stops at `READY_TO_TRANSMIT`; Build 3 owns compiled responses, transmittals, originator dispositions, revise/resubmit, and closure.

## Domain and migration

The additive migration `20260718010000_r2b2_trade_response_packages` adds `ReportObservation`, `TrackedItemTradeAssignment`, `ResponsePackage`, `ResponsePackageItem`, `TradeResponseRevision`, `TradeResponseAttachment`, and `ResponseAccessToken`. The forward repair migration `20260718030000_r2b2_trade_response_reviewer_repairs` retains existing rows while rebuilding the Build 2 history relations with restrictive deletion, adds the exactly-one observation-source check, unique promotion provenance, immutable GC review decisions, and the shared external rate-limit bucket. It does not modify the separate legacy/base remediation lane. Status vocabularies remain application-validated strings.

`bidId` is denormalized on tenancy-sensitive children and indexed with their parent identifiers. Bid, Field Report, Consultant Report, package-contractor, package-member, response, attachment, token, and GC-review history use restrictive deletion. Responsible-contractor deletion has an effective restrictive database guard without rebuilding the large legacy `TrackedItem` table. Migrated-database tests prove failed parent deletion leaves every history row and blob reference intact. A package due date is independent of both the existing Tracked Item due date and consultant target date.

Package state is service-enforced and human-triggered:

`DRAFT -> ISSUED -> RESPONSES_IN -> GC_REVIEW -> READY_TO_TRANSMIT`

`VOIDED` is allowed from any pre-transmit stored state and atomically revokes every active package token. `OVERDUE` and `NO_RESPONSE` are read-time projections and are never persisted. External packages require exactly one validated portal or manual mechanism; internal packages require a recorded manual channel and can never mint/rotate a portal token. Readiness requires every member's latest revision to be accepted for transmittal.

Observation OPEN edits/dispositions, promotion/linkage, issue, and package transitions use conditional affected-row claims. Promoted Tracked Items carry a unique `sourceReportObservationId`, making repeated/concurrent promotion idempotent without orphan rows. Package numbers and response revision indexes use database uniqueness with bounded retry. Real migrated-database double-action tests verify truthful state/audit outcomes.

## Internal routes

The implementation adds bid-scoped routes for direct and report-backed observations, OPEN-only verbatim edits, human disposition, promotion/linking into `TrackedItem`, trade assignment, package creation/membership/detail, issue, token rotation/revocation, manual response entry, GC review, state transitions, and response attachments/downloads.

Every internal handler validates numeric child identifiers and calls `requireBidAccess(bidId)` before parsing JSON or multipart bodies and before database, blob, mutation, or provider work. Service lookups constrain the complete bid/package/item/revision/attachment chain; missing and foreign children return the same not-found result.

The Operations Register UI includes a focused package panel for draft creation, member selection, portal/manual issue, one-time link display, rotation, manual response capture, human state advancement, and GC accept/return actions.

## External token wall

The external workflow is rooted at `/external/response/[token]` with API routes under `/api/external/response/[token]`. A token grants only its assigned package projection: package metadata, assigned item title/description/locator/due date, response history, and that history's attachments. Pricing, subcontractor lists, unrelated packages, unrelated attachments, and foreign bids are not selected.

Portal credentials are 256-bit random values. Only their SHA-256 hashes are persisted; the raw value is returned once by issue or rotation and is not included in audit payloads. Rotation atomically revokes active package credentials, creates the replacement hash, and writes its audit event. Every token use also requires the package to remain in `ISSUED`, `RESPONSES_IN`, or `GC_REVIEW`. Unknown, malformed, expired, revoked, VOIDED/inactive, rate-limited, and foreign-chain probes all return 404. Successful uses update `lastUsedAt` and write a bounded audit event in the same transaction.

The shared database limiter permits 60 requests per server-derived credential bucket per minute. Routes trust no `x-forwarded-for` or caller-selected identity. A DB lookup maps known credentials to their non-secret stored digest and combines it with the trusted server route identity; every arbitrary unknown token string collapses into one identity, so unauthenticated paths cannot allocate unbounded rows. Only a derived bucket digest is stored; expired rows are deleted on consumption. The database table supplies the same coordination state to every application instance.

## Immutable responses and GC review

Portal and manual submissions only append `TradeResponseRevision` rows with a monotonically increasing per-item index. Manual entries reject `PORTAL`, preserve their actual channel, and record the entering GC actor. Prisma client extensions reject revision update-many/upsert/delete operations. Every GC decision and its detailed commentary appends an immutable `TradeResponseReviewDecision`; a later correction links to the prior decision through `correctionOfId`. Current review fields on the response row are only a readiness projection. Contractor response bytes are never merged with or rewritten by GC commentary.

`RETURNED_FOR_REVISION` writes a durable audit hook for later Build 3 notification wiring. It does not send a notification in this build. A newer immutable revision must become the latest accepted revision before `READY_TO_TRANSMIT` can be reached.

## Attachments and audit atomicity

Response attachments allow JPEG, PNG, WebP, and PDF up to 25 MiB. Storage keys are generated by the server under `plan-room/jobs/{bidId}/response-packages/{packageId}/` and include the revision identifier plus a random UUID and sanitized file name. Internal authorization or external token/full-parent-chain checks happen before multipart parsing or blob work. External uploads recheck after multipart parsing and at metadata commit; downloads recheck immediately before and after the blob read, so revocation/VOID between boundaries fails closed. Every external success/failure returns `private, no-store` and `nosniff`; download success also retains attachment disposition and MIME allowlisting. If metadata or its audit event fails after a blob write, the new blob receives best-effort cleanup.

Every accountability mutation writes a bounded, content-free `AuditEvent` inside the same database transaction as the domain mutation. Payloads contain identifiers, state labels, channels, counts, MIME/size metadata, and boolean presence flags—not observation bodies, contractor response text, GC commentary, file names, email addresses, or raw tokens. An audit failure rolls back the corresponding database mutation; focused injection tests cover observation, package, token, response, attachment metadata, and GC review paths.

## Verification boundary

Validation uses synthetic tokens, actors, response text, files, and a new throwaway local SQLite database. No migration was applied to a shared, staging, or production database, no deployment occurred, and no live project data or external AI service was used. The feature still requires independent security/tenancy review and integration before any staging certification or release claim.
