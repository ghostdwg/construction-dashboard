# R2 Build 2 existing-code security hardening

This change closes the authorization gaps that blocked response-package work. It does not add response-package, transmittal, external-link, or closure-state schemas.

## Bid-scoped routes

Every Field Report and Tracked Item route now calls `requireBidAccess(bidId)` after numeric path validation and before request-body parsing, database access, blob access, or mutation. Resource queries remain constrained by both the resource ID and `bidId`; attachment queries are additionally constrained by their parent tracked-item ID. A cross-bid or unknown resource returns the same safe not-found response.

Field Report source downloads and Tracked Item attachment downloads authorize the bid first, resolve metadata through bid-scoped parent ownership, and only then pass the server-stored blob key to `BlobStore`. Request parameters cannot select storage keys. Responses retain private/no-store, safe content-disposition, MIME allowlisting, and `nosniff` headers.

Focused route tests prove authorization denial occurs before multipart/JSON parsing and before blob reads, blob writes, metadata reads, or mutations.

## Service authentication

`APP_ENV` is the explicit mode discriminator.

- Sidecar and WhisperX processing routes fail with an operator-visible configuration error when their service key is absent outside `local`, `development`, or `test`.
- Incorrect keys return unauthorized; matching keys proceed.
- Only the read-only `/health` endpoint is exempt. Sidecar API documentation and schema endpoints no longer inherit the exemption.
- Synthetic keyless testing requires `APP_ENV=test`; keyless behavior is never inferred from a missing key.
- Next.js environment validation requires `SIDECAR_API_KEY` in staging and production, preventing conditional-header callers from starting without their service credential.
- The sidecar-to-WhisperX client raises a configuration error before HTTP/transcription work when `WHISPERX_API_KEY` is required but absent.

Keys are compared without logging their values.

## Auditing

Existing Tracked Item domain history and canonical `sourceKind` behavior are unchanged. Audit coverage includes tracked-item creation, promotion, updates, status transitions, comments, attachments, formal responses, observation linkage, and PM-review flags. Field Report create, update, and file-record mutations now emit `register_action` audit events. Generic audit payloads contain bid/resource IDs, changed-field names, types, sizes, and state labels—not report bodies, comments, or formal-response content.

No Prisma schema or migration is changed by this hardening pass.
