# Meeting Intelligence private worker client

This directory contains a bounded Python client skeleton for the durable Meeting Intelligence v2 queue. It is a standard-library, outbound-only process: it polls the application, processes one claimed job at a time, and never opens or requires an inbound worker port.

The supported runtime is Python 3.11 or newer. The package has no third-party Python dependencies.

The committed processor is deliberately a deterministic fixture. It does not perform speech recognition, diarization, model inference, or provider calls. Do not point this skeleton at staging, production, or any queue containing real work.

## Local Only boundary

Meeting media, transcripts, segments, and raw artifacts are Project-Confidential. The worker may communicate only with the configured GroundworX application origin through the committed `/api/worker/meeting-intelligence/*` routes. Plain HTTP is rejected unless the origin is loopback; non-loopback origins must use HTTPS. The client validates that media URLs remain on the configured origin and match the claimed job.

There is no cloud-transcription fallback and no third-party AI client in this package. The worker does not depend on the legacy meeting transcription pipeline, its server, its job state, or direct legacy transcript publication.

## Durable contract

For each job, the loop performs:

1. authenticated `POST .../claim` with `workerId`;
2. an immediate heartbeat and periodic heartbeat lifecycle;
3. authenticated media `GET` with the lease token in `X-Meeting-Worker-Lease`;
4. streaming download to a per-job temporary directory and SHA-256 verification against `X-Content-SHA256`;
5. progress updates for `media_fetch`, `normalize`, `transcribe`, `diarize`, and `persist`;
6. deterministic structured segment construction and a byte-compatible result checksum;
7. completion, or a bounded, content-free failure submission; and
8. unconditional removal of the per-job temporary directory.

Heartbeat and progress conflicts with `canceled` or `lease_lost` stop local work. Transport and retryable HTTP failures use bounded exponential backoff. Claim is intentionally not automatically retried because a lost claim response is ambiguous; server-side lease expiry and stale recovery safely requeue it. Completion is retried because the application contract makes exact duplicate completion idempotent.

## Configuration

`run` fails closed unless all required values are present and valid.

| Variable | Required | Meaning |
| --- | --- | --- |
| `MEETING_WORKER_BASE_URL` | yes | GroundworX application origin. HTTP is loopback-only; otherwise HTTPS is required. |
| `MEETING_WORKER_TOKEN` | yes | Shared worker secret sent as `X-Meeting-Worker-Token`. Never logged. |
| `MEETING_WORKER_ID` | yes | Stable worker identity, at most 160 characters. |
| `MEETING_WORKER_PROCESSOR` | yes | Must be `deterministic_fixture` in this skeleton. |
| `MEETING_WORKER_POLL_SECONDS` | no | Empty-queue poll interval; default `10`. |
| `MEETING_WORKER_HEARTBEAT_SECONDS` | no | Heartbeat interval below the 900-second lease; default `240`. |
| `MEETING_WORKER_REQUEST_TIMEOUT_SECONDS` | no | Per-request timeout; default `30`. |
| `MEETING_WORKER_REQUEST_ATTEMPTS` | no | Bounded attempts for retry-safe operations; default `3`, maximum `10`. |
| `MEETING_WORKER_BACKOFF_INITIAL_SECONDS` | no | Initial retry/poll-error delay; default `1`. |
| `MEETING_WORKER_BACKOFF_MAX_SECONDS` | no | Maximum backoff; default `60`. |
| `MEETING_WORKER_MAX_MEDIA_BYTES` | no | Hard download size bound; default 2 GiB. |
| `MEETING_WORKER_SCRATCH_DIR` | no | Per-job temporary directory root; default `run`. |
| `MEETING_WORKER_LOG_LEVEL` | no | Structured log threshold; default `INFO`. |

See `.env.example` for placeholder-only local values. Never place a real token in source control, command arguments, service files, or logs. Structured logging allowlists operational metadata and excludes request headers, transcript text, segment content, media names, raw artifacts, and exception messages. The configured worker token is also actively redacted.

## Offline fixture and tests

From this directory, create any harmless local fixture file and emit a deterministic completion object without loading worker configuration or making a network request:

```sh
python3 -m meeting_worker fixture --media /path/to/synthetic-local-fixture.bin --job-id 1
```

The repository does not include a media binary. Any non-sensitive local file can be supplied because the fixture processor uses it only to calculate `sourceMediaChecksum`. The command writes canned transcript content to standard output, so this mode is for synthetic local fixtures only.

Run all offline unit tests from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=meeting-worker \
  python3 -m unittest discover -s meeting-worker/tests -v
```

No installation or package download is needed.

## Future real processor adapters

The `Processor` protocol in `meeting_worker/processor.py` is the only inference seam. A future WhisperX adapter should implement that protocol, normalize audio locally, return validated `TranscriptSegment` values, and report its actual package/model version in `ToolVersions`. It must load models outside the HTTP client and must remain cooperative with the supplied cancellation event and progress callback.

A future pyannote adapter belongs behind the same processor seam. It should map advisory labels to `SPEAKER_<number>`, refuse to claim real work when required model authorization is absent, and report truthful diarization tool/model versions. Neither WhisperX, pyannote, Torch, CUDA, nor Hugging Face packages are installed or imported by this skeleton.

Operators should choose and document private model/cache paths before a real adapter is added. Candidate future settings are `MEETING_WORKER_MODEL_CACHE`, `HF_HOME`, `WHISPERX_MODEL`, and an operator-provisioned `HF_TOKEN`; none are read by the fixture implementation.

## Service supervision

`systemd/groundworx-meeting-worker.service.example` is a non-installed, non-enabled template for later operator review. It demonstrates restart behavior, non-root execution, filesystem hardening, and a writable scratch path. Its paths and environment-file ownership must be reviewed for the target host. Graceful `SIGINT`/`SIGTERM` handling stops new claims; an interrupted active fixture job submits a fixed `WORKER_SHUTDOWN` failure when its lease is still valid and then removes temporary files.

The template must not be enabled while `MEETING_WORKER_PROCESSOR=deterministic_fixture` is the only implementation.
