# GPU PC — Cleanup & Readiness Checklist (Market Intelligence Scraper context)

The Market Intelligence scraper (Phase 5I, deployed 2026-05-15) does **not**
require the Windows GPU PC at all in its current configuration — all work
happens in the sidecar container (HTTP + PDF extraction + httpx) and Claude API.

This document is what to clean up / be aware of on the GPU PC right now, and
what would change if/when the deferred Ollama prefilter (Phase 5I-5+ option) is
re-introduced.

## Current GPU PC role

- Hosts the WhisperX worker at `http://100.126.166.110:8002` over Tailscale.
- Used by the meeting intelligence pipeline (`/transcribe`, `/job/{id}`, `/artifacts/{id}`).
- **Not used by the market intelligence scraper.** The scraper makes no
  outbound calls to the GPU PC.

## Cleanup to do now (low priority, hygiene only)

1. **Confirm `ffmpeg` on PATH** (required for real WhisperX inference).
   Per [memory](project-groundworx-runtime-state), this was the gotcha that
   caused real-inference failures earlier.
   - `where ffmpeg` in PowerShell should resolve.
   - If not: `winget install --id=Gyan.FFmpeg -e`, then restart the worker
     Windows service.

2. **Verify worker mode matches your intent.**
   - Hit `http://100.126.166.110:8002/health` from this host.
   - Field `inference_enabled` is the source of truth. Scaffold mode is fine
     for orchestration testing; flip to real for actual transcription work.

3. **Disk space check.** WhisperX downloads ~1-2 GB of model weights on first
   real-inference run. Confirm at least 5 GB free on the worker's data drive
   to leave headroom for diarization model + audio temp files.

4. **Verify Tailscale is up and routing.**
   - From this host: `ping -c 2 100.126.166.110` (or whatever tailscale ping you use).
   - If down, the meeting pipeline fails — scraper continues to work since it
     never talks to the GPU PC.

5. **Ollama is now actively used by the scraper** — `qwen2.5:14b` runs on the
   GPU PC at `http://100.126.166.110:11434`. The sidecar calls it directly
   over Tailscale when a source has `prefilterMode: large | always`.

## Ollama tuning (2026-05-15)

The sidecar respects these env vars (set in `apps/construction-dashboard/sidecar/.env`):

| Env var | Default | Purpose |
|---|---|---|
| `OLLAMA_URL` | `http://100.126.166.110:11434` | Endpoint over Tailscale |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Default model. Pick per-source via UI. |
| `OLLAMA_KEEP_ALIVE` | `2m` | How long the model stays in VRAM idle. Drop to `30s` if you run WhisperX simultaneously and hit eviction lag. Raise to `30m` for sustained nightly bulk to avoid model-load latency between docs. |

### Per-doc behavior (after 2026-05-15 upgrades)

- Docs up to **100,000 chars** processed in one Ollama call (`num_ctx=32768`)
- Docs over 100k chars get **map-reduced**: split into ≤92k-char chunks with 1,500-char overlap, each chunk processed independently, results merged (excerpts deduped by exact text)
- Hard input cap at **500,000 chars** — tail of unusually long docs is dropped (rare for municipal data)

### 4070 Ti / 12 GB VRAM constraints

`qwen2.5:14b` is the sweet spot — fits cleanly, leaves room for WhisperX with the `2m` keep-alive. Bigger models trade off:

- `qwen2.5:32b` (Q4, ~19 GB) — won't fit, would offload to CPU/RAM → 5-10× slower
- `qwen2.5:32b-q3_K_M` (~14 GB) — barely fits with offload, modestly slower
- `qwen2.5:32b-q2_K` (~10 GB) — fits but quality drops ~10-15%
- Stick with `qwen2.5:14b` for routine use; pull a quantized 32b only for occasional "deep look" passes.

## What to monitor in prod now

After scraping a few sources, watch for:

- **VRAM eviction with WhisperX.** If you start a meeting transcription
  while a scrape is mid-flight (or vice-versa), one will evict the other.
  Symptoms: 5-15s extra latency on the cold-start side. Solution: drop
  `OLLAMA_KEEP_ALIVE` to `30s`, or schedule scrapes during off-hours via
  the "Queue tonight" button.
- **Empty-doc ratio.** In the doc viewer, if >30% of scanned docs show 0
  signals on sources with prefilter ON, the prompt may be too strict.
- **Cost per scrape run.** Without prefilter: ~$0.05-0.10 per doc. With
  prefilter (`large` or `always`): ~$0.005-0.01 per doc. If a single run
  goes over $1, check whether `maxDocs` was set too high.
- **Doc dedup behavior.** When a city re-uploads a doc with a new cache-buster
  `?t=...`, the canonical-URL dedup should treat it as the same doc and skip
  it. Watch `docsSkipped` in the scrape result panel — should be non-zero on
  the second run against the same source.
- **Chunked docs.** When a council packet exceeds 100k chars, the result
  strip shows the chunked behavior in `prefilter_chars_in / out`. If
  `chars_in` is hitting the 500k cap regularly, consider raising
  `OLLAMA_INPUT_MAX_CHARS` in the sidecar code.

## Quick health probe (run from this host)

```bash
# App + sidecar
docker ps --filter name=neuroglitch --format 'table {{.Names}}\t{{.Status}}'

# Sidecar's market routes registered
docker exec neuroglitch-sidecar curl -sS http://localhost:8001/openapi.json \
  | python3 -c "import json,sys; print('\n'.join(p for p in json.load(sys.stdin)['paths'] if '/market/' in p))"

# WhisperX worker reachable + mode
curl -sS http://100.126.166.110:8002/health

# Ollama reachability + currently loaded models (from sidecar)
docker exec neuroglitch-sidecar curl -sS http://100.126.166.110:11434/api/ps
```
