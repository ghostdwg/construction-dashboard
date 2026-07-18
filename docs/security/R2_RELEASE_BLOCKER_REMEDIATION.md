# R2 release-blocker remediation

This change set repairs the non-media security and integrity findings raised
against the integrated R2 base at `40c35ce`. It is a local, synthetic-fixture
candidate for independent rereview. It does not certify staging or production,
perform a deployment, or apply a migration to a live database.

## Durable-history retention

Meeting transcript segments, corrections, register entries, extraction runs,
minutes, register revisions, and other durable meeting evidence now use
restrictive parent relations instead of cascading removal. Bid and meeting
deletion routes also check for durable history inside the deletion transaction
and return an explicit conflict instead of erasing evidence. The forward-only
SQLite migration preserves existing rows while rebuilding the affected foreign
keys. A replay test creates a pre-migration database, seeds canonical data,
applies the migration, checks values and constraints, and proves direct Prisma
deletes are rejected.

Legacy whole-transcript, speaker-mapping, and direct participant-name writes
are permitted only before transcript materialization or accountable history
exists. Accepted bootstrap mutations and their audit event commit in the same
transaction. After materialization these routes return a conflict and callers
must use the correction workflow.

The same centralized frozen-transcript boundary now covers direct status/job
re-arming, standard and hybrid upload, hybrid source mapping, and every
standard/hybrid polling completion or fallback. Once a segment, correction,
register entry, extraction run, or minutes revision exists, these routes return
409 before request-body parsing, BlobStore access, or provider polling. Every
permitted source mutation repeats the check inside its write transaction and
commits with its audit event; hybrid BlobStore writes are compensated if that
transaction fails. Post-materialization analysis always uses the stored
correction-overlay transcript and rejects alternate request-body wording.

## Analysis and register integrity

Initial segment materialization, analysis lifecycle writes, extraction-run
creation, register projection, and the mandatory audit event now share one
transaction. Synthetic failure tests at lifecycle, register, and audit stages
prove that no partial state commits.

Reruns are non-destructive. Exact action-item matches retain row identity,
human lifecycle state (`OPEN`, `CLOSED`, or `DEFERRED`), notes, and promotion
links; only genuinely new actions are inserted. Optional evidence text is part
of the exact match without excluding evidence-free rows. Rerun apply claims a
preview transactionally, so only one concurrent caller can apply it. Reconcile
counts classify same-anchor changed wording once rather than simultaneously as
both a match and a creation.

Both APPLY and DISCARD atomically claim a preview using its run, meeting, bid,
and `PREVIEWED` state inside the owning transaction. Concurrent double-discard
and apply-versus-discard tests prove one winner, one terminal state, and one
matching audit event.

Speaker merge keeps the source participant as an inactive, queryable record
with target, actor, and timestamp provenance. Segments move to the target and
the correction, transcript rebuild, disposition, and audit event commit
atomically. Active roster and downstream analysis/minutes/export paths exclude
inactive participants.

## Operations audit and attachment integrity

Consequential Field Report, Tracked Item, formal-response, and PM-review
mutations persist their `AuditEvent` in the same database transaction as the
domain write. Validation and existence checks occur before audit construction,
and audit persistence failure rolls back the domain change. Audit payloads use
identifiers, state, and lengths instead of confidential narrative bodies.

Field Report source files and Tracked Item attachments use server-generated
UUID path components. Upload compensation deletes only the newly written blob,
so a failed repeated-name upload cannot overwrite or delete an older object's
bytes. Tests cover repeated safe filenames and post-upload database/audit
failure.

## Authentication fence

`AUTH_DISABLED=true` is accepted only when `APP_ENV=local`. Configuration
validation rejects the bypass in staging, production, and other non-local
environments before application startup.

## Scope and remaining gates

Media-sidecar transport, multipart authentication order, and ASGI integration
testing are intentionally excluded and owned by the separate media remediation
branch. This branch also does not add an archive workflow; it prevents unsafe
deletion with explicit conflicts. Independent security rereview, integration,
staging certification, migration planning for a target environment, and
production release remain separate gates.
