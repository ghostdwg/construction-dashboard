# Meeting media compatibility integration

This integration rebases the locally certified meeting-media repairs onto the
Build 2 security baseline without changing the Prisma schema or applying a
migration. It is local/synthetic evidence only; it does not prove live GPU,
AssemblyAI, Sidecar, staging, or production operation.

## Authorization and service authentication

The standard upload and status routes validate numeric route parameters and
then call `requireBidAccess(bidId)`. A denial returns before form parsing,
meeting queries, BlobStore access, BackgroundJob access, or Sidecar requests.
Meeting lookups remain scoped by both `meetingId` and `bidId`.

Next-to-Sidecar calls send `SIDECAR_API_KEY`. Missing configuration fails before
downstream work outside explicit `local`, `development`, or `test` modes. The
Sidecar-to-WhisperX client applies the same rule to `WHISPERX_API_KEY` and sends
it on both submission and status requests.

The WhisperX worker now authenticates at the ASGI boundary. Unauthorized or
misconfigured requests are rejected before FastAPI can parse multipart audio.
Only the exact `/health` path is exempt; `/transcribe`, `/jobs`, `/status/*`,
documentation paths, and health-like suffixes remain protected.

## Immutable audio and retry behavior

Standard uploads sanitize the display filename but never trust it as the full
storage key. Each attempt allocates a server-generated key:

`uploads/meetings/{meetingId}/{uuid}-{safeFileName}`

The route checks that the candidate is unused before `BlobStore.put`, persists
the bytes, and then stores the relative `audioStorageKey` before contacting the
Sidecar. A FAILED retry receives a new key, so the previous source recording is
not overwritten. Manual mode also retains the durable audio.

`UPLOADING` and `TRANSCRIBING` requests return 409. In addition to the early
status guard, an `updateMany` status claim prevents two requests that observed
the same retryable state from both submitting provider work.

## Meeting and BackgroundJob state

After durable storage, the route attempts to create a
`meeting_transcription` BackgroundJob. A successful provider submission sets
the Meeting to `TRANSCRIBING`, persists the prefixed external job id, and moves
the tracking row to `running`. Manual mode returns the Meeting to `PENDING` and
fails the tracking row. Storage errors and Sidecar failures set the Meeting to
`FAILED`; Sidecar failures also fail the tracking row when present.

BackgroundJob bookkeeping is deliberately best-effort. Creation, lookup, or
terminal tracking failures do not undo a valid Meeting transition. This is
necessary because the existing schema permits only one active job of a given
type per bid; changing that global concurrency contract would require a schema
decision outside this integration.

Status polling uses the prefixed external id stored on the Meeting. Completed
standard and hybrid/fallback paths complete the matching BackgroundJob. A
worker-restart 404 is translated by the Sidecar into an explicit error, causing
both Meeting and job to fail. Non-404 transport failures return 502 and leave
the running state intact for a later retry.

## WhisperX transport contract

- Submit: `POST /transcribe`, multipart field `audio`, response field `jobId`.
- Poll: one `GET /status/{jobId}` call.
- Completed: the worker's flat `transcript`, `rawTranscript`,
  `durationSeconds`, and `participants` payload passes through the Sidecar.
- Worker job missing (404): explicit restart/job-lost error.
- Other HTTP errors: propagated rather than converted to terminal job failure.

All automated coverage uses synthetic bytes and mocked network boundaries.
