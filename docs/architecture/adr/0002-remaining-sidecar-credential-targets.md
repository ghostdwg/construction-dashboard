# ADR 0002: Credential Delivery for the Remaining Sidecar AI Call Sites

- Status: Accepted
- Date: 2026-07-05
- Work package: N4 (follow-on to N3 / ADR 0001)
- Scope: how `ANTHROPIC_API_KEY` reaches the four sidecar sites ADR 0001 §6
  flagged as future migration targets but did not migrate:
  `sidecar/services/ai_extractor.py`, `sidecar/services/schedule_intelligence.py`,
  `sidecar/services/submittal_intelligence.py`, and `sidecar/routers/market.py`
  (ADR 0001 names this last one `sidecar/services/market.py`; the actual
  Anthropic-client-constructing file at this path in the working tree is
  `sidecar/routers/market.py` — there is no `sidecar/services/market.py`. This
  ADR uses the real path throughout). This ADR is written **before** any of
  the four migrations are implemented; it contains no code changes.

## 0. Relationship to ADR 0001 and the fourth migration (`spec_intelligence.py`)

ADR 0001 decided Option A (TS resolves once via `getSetting()`, forwards the
resolved value per request; the sidecar never resolves its own credential) and
was applied to three named bypasses in one session
(`organizeWithAi.ts`, `drawing_intelligence.py`, `meeting_intelligence.py` —
commit `e1de9be`) and, in a second session, to `spec_intelligence.py`
(commit `c2d87b7`), which established the pattern this ADR treats as
precedent for jobs that outlive the originating HTTP request:

> The credential is resolved once, TS-side, at kickoff time and threaded
> through as a plain function argument through the whole background-task
> chain — it is never written into the sidecar's in-memory `_jobs[job_id]`
> record, never included in the callback payload, and never touches the
> durable `BackgroundJob` row.

Concretely, in `sidecar/routers/parse.py`'s `/specs/analyze_split` +
`_run_analyze_split`: `api_key` is a parameter on the Pydantic request model,
a parameter on the `asyncio.create_task(...)` background function, and a
parameter on `spec_intelligence.analyze_split_sections()` — at no point does
it become a value read back out of `_jobs[job_id]` or attached to the
callback POST body. TS-side, `lib/services/jobs/specAnalysisAutomation.ts`
resolves it via `getSetting("ANTHROPIC_API_KEY")` once, before creating the
durable `BackgroundJob` row, and forwards it in the initial request body only.

This ADR's central finding (§2) is that all four remaining targets can reuse
this exact pattern, because — verified by reading the actual invocation
chains, not assumed — **every one of them is triggered by TS/Node code that
runs before the sidecar is ever called**, even the ones that originate from a
cron container rather than a browser session. Sections 1–4 show the work;
§5 is the decision; §6 is the sequenced implementation plan.

## 1. What each target actually is (verified from source)

### 1.1 `ai_extractor.py` — request-scoped, zero live TS callers today

`extract_from_section()`/`extract_from_sections()` (`sidecar/services/
ai_extractor.py:120,157`) read `os.getenv("ANTHROPIC_API_KEY")` directly and
build no client of their own — they call `ai_gateway.create_message(...,
api_key=api_key)` (the gateway builds the client). Two sidecar router entry
points call it, both in `sidecar/routers/parse.py`:

- `POST /parse/specs/ai` (`parse_specs_ai`, line 101) — synchronous,
  request/response, no job/polling. Calls `extract_from_sections()` inline
  and returns the AI results in the same HTTP response.
- `POST /parse/specs/async` (`parse_specs_async` → `_process_async`, lines
  190–288) — asynchronous background-job pattern identical in shape to
  `spec_intelligence.py`'s `analyze_split`: returns a `job_id` immediately,
  `asyncio.create_task(_process_async(...))` runs in the background, a
  separate `GET /parse/specs/status/{job_id}` polls for the result. Inside,
  `extract_from_section` is called per-section via `loop.run_in_executor`
  only `if extract_types and os.getenv("ANTHROPIC_API_KEY")` (line 251).

**Neither entry point has a TS caller.** A repo-wide search of `app/` and
`lib/` for `specs/ai` or `specs/async` (as literal path fragments, matching
how every other sidecar route is called via `fetch(\`${SIDECAR_URL}/...\`)`)
returns nothing. This mirrors `spec_intelligence.py`'s `run_spec_intelligence`
before its own migration ("Currently unreachable from any Next.js route").
`ai_extractor.py` is, today, **entirely dead from the Next.js app's
perspective** — both its sync and async entry points.

**Finding: request-scoped (both a sync-request shape and an async-job shape
exist, matching two already-established precedents exactly), with no live
caller to coordinate with.** This is the lowest-risk of the four targets:
mechanical parameter-threading with zero behavior-preserving constraints on
a real, currently-working user flow.

### 1.2 `schedule_intelligence.py` — request-scoped async job, live caller

`generate_schedule_intelligence()` (`sidecar/services/
schedule_intelligence.py:280`) reads `os.getenv("ANTHROPIC_API_KEY")`
directly (line 292) and calls `ai_gateway.create_message(..., api_key=api_key)`
— no client of its own, same shape as `ai_extractor.py`. Its only caller is
`sidecar/routers/parse.py`'s `POST /parse/schedule/generate` (line 666) →
`_run_schedule_generate` (line 704), an `asyncio.create_task` background job
with a `GET /parse/schedule/status/{job_id}` poll endpoint — structurally
identical to `spec_intelligence.py`'s `analyze_split` (kickoff returns
`job_id`, background task calls the service function, result lands in the
in-memory `_jobs` dict, no callback URL in this case but the same
non-durable-storage property).

The TS caller is real and live: `app/api/bids/[id]/schedule-v2/generate/
route.ts:180` does `fetch(\`${SIDECAR_URL}/parse/schedule/generate\`, ...)`.
This is a genuine, currently-working, user-triggered flow (a bid's Schedule
V2 tab, "Generate with AI").

**Finding: request-scoped-async, reuses the `spec_intelligence.py` pattern
directly — no new design required.**

### 1.3 `submittal_intelligence.py` — request-scoped async job, live caller

`generate_submittal_intelligence()` (`sidecar/services/
submittal_intelligence.py:59`) reads `os.getenv("ANTHROPIC_API_KEY")` (line
74) and — unlike the two above — builds its own client via
`ai_gateway.build_client(api_key)` (line 78), the same shape
`drawing_intelligence.py` and `spec_intelligence.py` use post-migration. Its
only caller is `sidecar/routers/parse.py`'s `POST /parse/submittals/generate`
(line 759) → `_run_submittals_generate` (line 792), again an
`asyncio.create_task` background job with a `GET /parse/submittals/
status/{job_id}` poll endpoint — same shape as §1.2.

The TS caller is real and live: `app/api/bids/[id]/submittals/generate-ai/
route.ts:116` does `fetch(\`${SIDECAR_URL}/parse/submittals/generate\`, ...)`
(the drawing-cross-reference submittal-gap feature from `CURRENT_STATE.md`'s
"Last completed").

**Finding: request-scoped-async, reuses the `spec_intelligence.py` pattern
directly — no new design required.** (Confirms, rather than merely repeats,
the prior session's note that "schedule_intelligence.py and
submittal_intelligence.py share the same background-job router pattern in
parse.py" — verified here against the actual router code, not assumed.)

### 1.4 `market.py` — module-level singleton, three endpoints, three trigger shapes

`sidecar/routers/market.py:32-34` constructs a client **once, at import
time**, at module scope:

```python
router = APIRouter()
anthropic = ai_gateway.build_client(
    os.getenv("ANTHROPIC_API_KEY", "")
)
```

There are exactly two places this module-level `anthropic` name is
referenced anywhere in the file: its construction (line 32) and its one use
site, `client=anthropic` inside the shared helper `_scan_text()` (line 424).
`_scan_text()` is itself the single chokepoint used by **all three** of the
router's Claude-calling endpoints:

- `POST /market/scan-document` (`scan_document`, line 454) → `_scan_text`
  (line 474)
- `POST /market/scrape-source` (`scrape_source`, line 903) → `_scan_text`
  (line 1084, inside its per-doc loop)
- `POST /market/analyze-text` (`analyze_text`, line 1212) → `_scan_text`
  (line 1227, only on the `engine == "claude"` branch; the `ollama` branch
  calls a separate, non-credentialed helper)

This means `market.py`'s credential problem is architecturally simpler than
its "module-level singleton" framing suggests in isolation: there is exactly
**one** function (`_scan_text`) and **one** client-construction call site to
change, even though three router endpoints and three Pydantic request models
sit above it.

**Is there ever zero TS code in the loop?** Tracing all three endpoints'
actual callers:

- `POST /market/analyze-text` ← `app/api/market-intelligence/docs/[id]/
  analyze/route.ts` — a plain user-triggered Next.js route (the "Analyze"
  button on a scraped document). Real TS HTTP request, no ambiguity.
- `POST /market/scan-document` ← `lib/services/marketIntelligence/
  sidecarMarket.ts`'s `callSidecarScan()` — called from
  `app/api/market-intelligence/scan/route.ts` (user-triggered "scan this
  URL/text" action). Real TS HTTP request.
- `POST /market/scrape-source` ← `sidecarMarket.ts`'s `callSidecarScrape()`
  — called from **two** places:
  1. `app/api/market-intelligence/sources/[id]/scrape/route.ts` — a
     user-triggered "scrape this source now" action. Real TS HTTP request.
  2. `lib/services/marketIntelligence/scrapeOneSource.ts`'s
     `scrapeOneSource()`, which is itself called from **two** places (its own
     header comment: *"Both the existing HTTP route and the future
     municipal-agenda-ingestion runner (PR-5) call scrapeOneSource — single
     source of truth"*):
     - `app/api/jobs/run-due/route.ts`'s `runMarketScrape()` — an
       HTTP route, but one gated by a shared-secret `X-Worker-Token` header
       (`WORKER_TOKEN` env var) rather than user auth, per its own comment:
       *"this route runs unattended by an internal worker."* Per
       `runtime/compose/TOPOLOGY.md` and `runtime/worker/README.md`, the
       `neuroglitch-worker` container is *"Alpine + tini + curl loop polling
       `/api/jobs/run-due` every 60s."* The trigger is a bare `curl` from a
       non-TS Alpine container — but the thing it curls **is a Next.js route
       handler**, i.e. real TS code (with full `getSetting()`/Prisma access)
       still runs, inside the app process, before `callSidecarScrape()` is
       ever invoked.
     - `lib/runners/municipalAgendaIngestion.ts` — registered with
       `registerRunner()` and invoked by `scripts/run-cycle.ts`, which the
       cron container's `scripts/cron-loop.mjs` spawns directly
       (`spawn("npx", ["tsx", "scripts/run-cycle.ts", "--runner=...",
       "--trigger=scheduled"], ...)`, per `runtime/cron/schedule.json`'s
       `"0 * * * *"` hourly entry). **This path never makes an HTTP request
       to the Next.js app at all** — `run-cycle.ts` imports
       `municipalAgendaIngestion.ts` and calls its runner body in-process,
       which calls `scrapeOneSource()` directly as a plain async function
       call, which calls `callSidecarScrape()` directly. There is no HTTP
       hop between "cron fires" and "the sidecar is called."

**This is the one genuinely new fact this ADR turns up relative to how the
task framed the risk:** the *absence of an HTTP request* on the
cron-container path does **not** mean the absence of TS code capable of
calling `getSetting()`. `scripts/run-cycle.ts` is `tsx`-executed TypeScript,
in the same repo, with the same module graph, the same `@/lib/prisma`
import, and therefore the same ability to call
`appSettingsService.getSetting("ANTHROPIC_API_KEY")` as any Next.js route
handler — it is simply not fronted by an HTTP listener. The crux the task
asked about — "can this run with NO TS caller in the loop at all" — resolves
to **no** for every one of `market.py`'s three endpoints, across all of
their trigger paths, once "TS caller" is understood correctly as "TS/Node
code with DB access that executes synchronously before the sidecar HTTP
call," rather than "an inbound HTTP request to the Next.js app." Nothing in
this codebase calls into `market.py` from a place that is *not* TS/Node code
(no APScheduler-equivalent inside the sidecar itself — confirmed by the same
grep ADR 0001 §1.7 already ran, re-checked here: no `schedule.every`/cron/
`@repeat_every` under `sidecar/`).

**Finding: `market.py` is request/call-scoped, not truly schedule-autonomous
from the sidecar's perspective — but its Python-side client is a singleton,
which is the one piece of this target that is architecturally distinct from
§1.1–1.3 and requires an actual code-shape change (not just a new parameter)
before it can accept a per-call key at all.**

## 2. Design comparison

Because §1 established that all four targets have *some* piece of
synchronous TS/Node code in the loop before every sidecar call, **Option A
(the `spec_intelligence.py` pattern) is structurally sufficient for all
four.** The three alternatives the task asked to weigh are compared below
against that baseline, primarily so the "why not" is on record rather than
assumed.

### 2.A Baseline — TS/Node resolves once, forwards per call (the precedent)

Exactly ADR 0001 Option A, exactly as implemented in `specAnalysisAutomation.
ts` + `analyze_split`/`_run_analyze_split`: `getSetting("ANTHROPIC_API_KEY")`
is called once by whichever TS/Node code initiates the sidecar call (a route
handler for `ai_extractor.py`/`schedule_intelligence.py`/
`submittal_intelligence.py`'s live routes; either a route handler or
`scrapeOneSource.ts` for `market.py`), forwarded as a `api_key` field in the
JSON body, threaded through the sidecar's background task (where one exists)
as a plain function argument, never assigned into `_jobs[job_id]`, never
included in a callback payload, never persisted to a DB row.

### 2.B Short-lived authenticated app→sidecar dispatch

A new endpoint where TS pushes a fresh credential to the sidecar ahead of
time, valid for a bounded window, which the sidecar then holds in memory and
uses for calls in that window. **Rejected for all four targets.** This
solves a problem none of the four targets actually have: every one of them
already has TS/Node code executing at the exact moment the credential is
needed (§1), so there is no "the sidecar needs to act later, unattended, with
no TS code nearby" gap to bridge. Building this would mean the sidecar holds
credential state across calls — reintroducing exactly the kind of
sidecar-side credential lifetime ADR 0001 §4.3/§4.4 rejected wholesale
(unpredictable rotation behavior, a new failure mode when the window
expires mid-batch, e.g. mid-way through `scrape_source`'s per-doc loop).

### 2.C App-owned provider proxy (sidecar never talks to Anthropic; calls back into TS)

Inverts credential custody entirely: the sidecar would call a TS endpoint
that itself calls Anthropic. **Rejected for all four targets**, for the same
reason ADR 0001 rejected Option B (independent sidecar-side resolution) but
more strongly: this doesn't just duplicate the DB/env precedence logic, it
also duplicates the *provider call* itself in a second network hop, adds
sidecar→TS reachability as a new dependency in the failure domain (todays'
env-only bypasses need nothing but a local env var; this design would make
every one of these four features depend on TS being reachable *from* the
sidecar container, a dependency edge that does not exist in either direction
today for the two `_process_async`/background-job cases), and gives up the
per-section streaming/progress-reporting shape `analyze_split_sections()`,
`generate_schedule_intelligence()`, and `_scan_text`'s per-doc loop already
have working today. No comment, TODO, or partial implementation anywhere in
the codebase gestures at this shape existing or being wanted.

### 2.D Ephemeral in-memory token vault

A shared component (TS or sidecar) holds a short-TTL, memory-only credential
any caller can request just-in-time. **Rejected for all four targets** on
the same grounds as 2.B: it is infrastructure to solve a "credential needed,
no TS code present" problem that this codebase's actual call graph (§1) does
not have. It would also be the *first* piece of shared mutable credential
state in either process (today: zero credential caches on the sidecar side,
one process-pinned cache on the TS side per ADR 0001 §4.3, itself already
flagged as a multi-instance caveat) — adding a second, differently-scoped
cache increases the number of places a stale/rotated key could be served
from, which cuts directly against ADR 0001's decision criteria (§4.3, §4.8).

### 2.E Existing infrastructure that could be reused, and why it isn't needed here

The task asked whether any existing cron-to-app callback or internal-secret
mechanism should be reused rather than inventing new infrastructure. Two
already exist and were inspected:

- `WORKER_TOKEN` / `X-Worker-Token` gating `app/api/jobs/run-due/route.ts` —
  this is exactly the "authenticated internal endpoint" pattern 2.B
  describes in the abstract, but it already runs in the *opposite*
  direction (external worker → TS app), and it already terminates in real TS
  code before the sidecar is ever touched. It requires no extension for this
  ADR's purposes — `runMarketScrape()` inside that route is simply one more
  place that can call `getSetting()` once, same as any other TS caller.
- `SIDECAR_API_KEY` / `X-API-Key` gating TS→sidecar calls (`sidecarHeaders()`
  in `sidecarMarket.ts`, the same header pattern in every other sidecar
  caller) — this is the transport-auth channel the resolved
  `ANTHROPIC_API_KEY` value rides over as a body field, exactly as it does
  today for `meetings/analyze` and `specs/analyze_split`. No new channel is
  needed; the existing one already carries a JSON body that can gain one
  more field.

Neither needs to change. This is additional evidence for 2.A: the "reuse
what's already here" instruction points at the same answer the call-graph
tracing does.

## 3. Rotation / retry / restart / failure / observability / testability / confidentiality

These properties were established generically in ADR 0001 §4.3–4.9 for
Option A; they hold identically for all four targets here since none of
them introduce a new mechanism, only new call sites for the same mechanism.
Target-specific notes:

- **Rotation.** Identical to ADR 0001 §4.3: `getSetting()` is re-read (with
  its existing DB-first/env-fallback/process-cache semantics) at the moment
  each of these four features' TS/Node trigger point fires — a route
  handler invocation, or (for `market.py`'s cron path) one
  `municipal-agenda-ingestion` cycle. A key rotated via the Settings UI is
  picked up on the *next* cycle/request in every case; nothing here holds a
  key across cycles. The one case worth flagging explicitly:
  `scrape_source`'s per-doc loop inside `_scan_text` — if a batch scrape
  processes many documents in one call, the key is read once at kickoff and
  used for the whole batch (matching `analyze_split_sections`' per-section
  loop, which already does exactly this for spec analysis) — a rotation
  mid-batch does not retroactively affect docs already scanned in that same
  call, which is the same behavior `spec_intelligence.py` already has and
  ADR 0001 already accepted.
- **Retry.** `ai_extractor.py`'s two entry points, `schedule_intelligence.py`,
  and `submittal_intelligence.py` have no automatic retry today (a failed
  job just lands `_jobs[job_id]["status"] = "error"`; the TS caller decides
  whether to re-trigger). A re-trigger is a brand-new HTTP request from TS,
  which re-resolves `getSetting()` fresh — retry-safety is free, the same
  way it already is for `analyze_split`. `market.py`'s `_scan_text` retries
  429/529 provider errors internally in `spec_intelligence.py`'s sibling
  functions but **not** in `market.py` itself today (no retry loop found
  around `_scan_text`'s call site) — this ADR does not add one; if a future
  change adds provider-side retry to `market.py`, the credential does not
  need re-resolution mid-retry since it was already captured as a function
  argument before the first attempt, identical to how `_analyze_section`'s
  existing 5-attempt retry loop in `spec_intelligence.py` already reuses one
  `client` across attempts.
- **Sidecar restart.** All four targets hold the credential only as a
  function-call argument for the lifetime of one in-flight request/task,
  same as the four already-migrated sites. A sidecar restart mid-flight
  loses the in-memory `_jobs` entry entirely (already true today, pre-ADR,
  for every background job in `parse.py` — this is an existing, unrelated
  property of the in-memory job store, not something this ADR changes or
  needs to fix) and the credential along with it; the TS caller's poll
  request will 404 the job, and a fresh trigger re-resolves a fresh key. No
  credential outlives a sidecar process restart under any of the four
  migrations.
- **Failure modes.** Each of the four gains the same fail-closed shape
  `spec_intelligence.py` established: missing `api_key` → `ValueError`/
  `HTTPException(503, ...)` before any provider call is attempted, never a
  silent fallback to a possibly-stale env var. `market.py`'s three endpoints
  should adopt the same `if not request.api_key: raise HTTPException(503,
  ...)` shape already used by `analyze_split` and `drawings/analyze`,
  replacing today's implicit failure mode (an empty-string client built at
  import time, which only fails once a real provider call is attempted and
  reports a generic 401/403 from the provider rather than a clear
  "not configured" error).
- **Observability.** Per ADR 0001 §4.6/§4.9, extend the same single
  audit-emission point (`source: db|env|missing`, `real_call: boolean`) —
  this ADR does not add a second observability mechanism; it is the same
  one instrumentation point ADR 0001 already scoped, now fed by four more
  call sites.
- **Testability.** Unaffected by this ADR's decision: both gateways already
  support client injection (ADR 0001 §4.7); the new tests needed are
  sentinel-traversal/no-leak/fail-closed tests per target, mirroring the
  existing `test_spec_intelligence_credential.py` and
  `test_drawing_intelligence.py`/`test_meeting_intelligence.py` shapes (see
  §6). One test-suite implication specific to `market.py`: the existing
  `sidecar/routers/__tests__/test_market_gateway.py` explicitly "patches
  `ai_gateway.build_client` at import time to capture the eager module-level
  construction" — that assertion is testing the exact singleton this ADR
  recommends removing (§4), so that test needs to be rewritten (not merely
  updated) as part of the `market.py` package, not left as an
  incidental casualty.
- **Confidentiality boundaries.** Identical reasoning to ADR 0001 §4.8: all
  four migrations keep the number of processes that ever hold the plaintext
  key at one (the Next.js/Node process — including the cron container's
  `tsx` process, which is still the same Node/TypeScript codebase and the
  same `getSetting()`/Prisma access path, not a new decryption locus). None
  of the four call sites put the credential in prompt content;
  `governance/CONFIDENTIAL_DATA_POLICY.md` §5's gateway requirement is
  already satisfied by all four today (each routes through
  `ai_gateway.create_message`/`build_client`, confirmed — none of the four
  appear in `governance/guardrails/allowlist.json`'s `ai_providers` list,
  meaning none of them were ever flagged as a direct-provider-construction
  guardrail violation in the first place; this ADR does not touch that
  file).

## 4. `market.py`'s singleton — specific recommendation

**Yes, it needs to become a lazily-constructed, call-scoped client — not a
module-level singleton — and the refactor is small because of how
concentrated the current design already is (§1.4).**

Smallest safe refactor shape:

1. Delete the module-level construction (`sidecar/routers/market.py:32-34`).
2. Give `_scan_text()` (the one function that uses the client, line 415) an
   explicit `api_key: str` parameter (or `client: Any`, matching whichever
   shape the router's sibling files use — `drawing_intelligence.py` and
   `submittal_intelligence.py` take `api_key` and call
   `ai_gateway.build_client(api_key)` internally once per call; that shape
   is simplest here too, since `_scan_text` is called from three different
   endpoints with three different request models rather than looped many
   times per call the way `analyze_split_sections` is).
3. Each of the three Pydantic request models (`ScanRequest`, `ScrapeRequest`,
   `AnalyzeTextRequest`) gains an `api_key: str = ""` field, matching the
   precedent already set by `AnalyzeDrawingsRequest.api_key` in this same
   router file.
4. Each of the three endpoint handlers (`scan_document`, `scrape_source`,
   `analyze_text`) fails closed — `if not req.api_key: raise
   HTTPException(503, "ANTHROPIC_API_KEY not configured")` — before calling
   `_scan_text`, and passes `req.api_key` through.
5. TS-side, resolve once per call site: `sidecarMarket.ts`'s
   `callSidecarScan()` and `callSidecarScrape()` should resolve
   `getSetting("ANTHROPIC_API_KEY")` internally and add `api_key` to their
   request bodies — this single change covers **every** caller of both
   functions uniformly (the manual "scan"/"scrape now" routes, `run-due`'s
   `runMarketScrape()`, and `municipalAgendaIngestion.ts`'s
   `scrapeOneSource()` call, since all of them already funnel through these
   two functions — mirroring how `specAnalysisAutomation.ts`'s
   `triggerSpecAnalysis()` centralizes resolution for both its manual-route
   and internal-automation callers today). `app/api/market-intelligence/
   docs/[id]/analyze/route.ts` (the one caller that talks to
   `/market/analyze-text` directly, not through `sidecarMarket.ts`) needs
   its own one-line `getSetting()` call added directly in the route, only
   on the `engine === "claude"` branch (the `ollama` branch has no
   Anthropic credential to resolve).

**Is `market.py` ever invoked with zero TS HTTP request in the loop?** Yes —
the `municipal-agenda-ingestion` cron path (§1.4) never makes an HTTP request
to the Next.js app. **Does that change the design choice?** No, precisely
because "zero HTTP request" is not the same as "zero TS code": `getSetting()`
is callable from `scrapeOneSource.ts` exactly as it is from any route
handler, since both execute as ordinary TypeScript in the same module graph
with the same Prisma connection. If this codebase ever grew a *second*,
genuinely code-external trigger for `market.py` — e.g. the sidecar
scheduling its own scrape with no Node process anywhere upstream — *that*
would require reopening this decision in favor of §2.B or §2.D. Nothing
observed in this codebase does that today (§1.7 of ADR 0001's grep for
`schedule.every`/cron under `sidecar/` still returns nothing, reconfirmed
here).

## 5. Decision

**Adopt Option A (§2.A) for all four remaining targets, with no new
credential-delivery infrastructure.** Specifically:

1. `ai_extractor.py`'s two entry points gain an explicit `api_key: Optional[str]
   = None` parameter each, fail closed with a `ValueError`/`HTTPException(503,
   ...)`, and their router request shapes (`parse_specs_ai`'s query-based
   check, `AnalyzeSplitSectionsRequest`-equivalent for `/specs/async`) gain
   an `api_key` field/Form parameter, matching the already-unreachable
   `run_spec_intelligence` precedent exactly (migrate for consistency, no
   live caller to preserve).
2. `schedule_intelligence.py`'s `generate_schedule_intelligence()` gains an
   explicit `api_key` parameter; `ScheduleGenerateRequest` gains an
   `api_key` field; `app/api/bids/[id]/schedule-v2/generate/route.ts`
   resolves via `getSetting()` and forwards it — mirroring
   `specAnalysisAutomation.ts` exactly.
3. `submittal_intelligence.py`'s `generate_submittal_intelligence()` gains
   an explicit `api_key` parameter (replacing its own `os.getenv` +
   `ai_gateway.build_client` call with the caller-supplied value);
   `SubmittalGenerateRequest` gains an `api_key` field;
   `app/api/bids/[id]/submittals/generate-ai/route.ts` resolves via
   `getSetting()` and forwards it.
4. `market.py` loses its module-level singleton client entirely (§4);
   `_scan_text()` gains an `api_key` parameter; all three of its Pydantic
   request models gain an `api_key` field; `sidecarMarket.ts`'s
   `callSidecarScan()`/`callSidecarScrape()` resolve `getSetting()` once
   each, covering all of their callers (manual routes, `run-due`, and the
   cron-driven `municipalAgendaIngestion` runner) uniformly; `docs/[id]/
   analyze/route.ts` resolves it directly for its one non-`sidecarMarket.ts`
   caller.
5. No `governance/guardrails/allowlist.json` change is required for any of
   the four (none of them appear in that file's `ai_providers` list — all
   four already route Claude calls through `ai_gateway.create_message`/
   `build_client`, confirmed by inspection, same finding ADR 0001's
   `spec_intelligence.py` migration already made for itself).

**Rationale.** §1 established, by tracing actual call chains rather than
assuming router-comment claims, that every one of these four targets already
has TS/Node code executing synchronously immediately before the sidecar is
ever called — including `market.py`'s cron-triggered path, where the
absence of an HTTP request does not mean the absence of TS code capable of
calling `getSetting()`. Given that, Option A requires zero new
infrastructure (§2.A), and each of §2.B/§2.C/§2.D would add a new mechanism
to solve a "no TS code in the loop" problem this codebase does not actually
have anywhere in the paths that reach these four files. The one genuine
structural change needed — `market.py`'s singleton → call-scoped client
(§4) — is a Python-side code-shape change, not a credential-delivery
mechanism change, and is contained to one function and three call sites
because `_scan_text()` was already the sole chokepoint.

**What would change this decision:** if `market.py` (or any future sidecar
feature) ever gained a trigger path with no TS/Node code anywhere upstream
of the sidecar call — e.g. the sidecar container running its own scheduler,
or a non-Node worker curling the sidecar directly instead of going through
`run-due`/`scrapeOneSource` — Option A would no longer be sufficient for that
one path specifically, and §2.B (short-lived authenticated dispatch) would
be the next design to reach for, scoped narrowly to that path alone rather
than applied to all four targets pre-emptively.

## 6. Implementation packages

Small, sequenced, independently-committable, mirroring how the four prior
migrations were actually scoped (one file/flow's worth of sidecar + router +
TS-route + tests per package):

**Package 1 — `ai_extractor.py` (do first).** Lowest risk: no live TS
caller to coordinate with, both entry points already match established
patterns exactly (drawing_intelligence.py's sync-request shape for
`/specs/ai`; spec_intelligence.py's async-job shape for `/specs/async`).
- Files: `sidecar/services/ai_extractor.py` (add `api_key` param, fail
  closed); `sidecar/routers/parse.py` (`parse_specs_ai`'s check + call,
  `AnalyzeSplitSectionsRequest`-equivalent for `/specs/async`'s job body,
  `_process_async`'s threading).
- Tests: sidecar-side sentinel-traversal + no-leak + fail-closed unit tests
  for both entry points (mirroring `test_spec_intelligence_credential.py`'s
  8-test shape); extend `governance/guardrails/__tests__/
  test_n3_credential_bypass_grep.py` with `ai_extractor.py` assertions (no
  more bare `os.getenv("ANTHROPIC_API_KEY")`/`os.environ.get` outside a
  documented local-dev fallback, if one is kept). No TS test needed — there
  is no TS caller to test.
- Depends on: nothing new. Can start immediately.

**Package 2 — `schedule_intelligence.py` (do second, independent of
Package 3).** Direct reuse of the `spec_intelligence.py` pattern against a
live caller.
- Files: `sidecar/services/schedule_intelligence.py`; `sidecar/routers/
  parse.py` (`ScheduleGenerateRequest`, `schedule_generate`,
  `_run_schedule_generate`); `app/api/bids/[id]/schedule-v2/generate/
  route.ts` (resolve + forward, fail closed with 503 on missing key,
  mirroring `specAnalysisAutomation.ts`'s `TriggerError`).
- Tests: sidecar sentinel/no-leak/fail-closed tests for
  `generate_schedule_intelligence`; a new
  `app/api/bids/[id]/schedule-v2/generate/__tests__/route.test.ts` covering
  credential-forwarding + non-leakage into the job/result payload,
  mirroring `specAnalysisAutomation.test.ts`'s coverage shape; extend the
  grep regression test.
- Depends on: nothing new (does not depend on Package 1).

**Package 3 — `submittal_intelligence.py` (do third, independent of
Package 2 — the two can be reordered or done in parallel).** Same shape as
Package 2, against its own live caller.
- Files: `sidecar/services/submittal_intelligence.py`; `sidecar/routers/
  parse.py` (`SubmittalGenerateRequest`, `submittals_generate`,
  `_run_submittals_generate`); `app/api/bids/[id]/submittals/generate-ai/
  route.ts`.
- Tests: same shape as Package 2, scoped to this flow; extend the grep
  regression test.
- Depends on: nothing new (does not depend on Package 1 or 2).

**Package 4 — `market.py` singleton refactor (do last).** The one package
with an actual code-shape change rather than parameter-threading; benefits
from the muscle-memory of Packages 1–3 but has no hard technical dependency
on them, since (per §5) no new shared mechanism needs to be built first —
this package is self-contained.
- Files: `sidecar/routers/market.py` (remove the module-level `anthropic =
  ai_gateway.build_client(...)`; add `api_key` to `_scan_text()` and to
  `ScanRequest`/`ScrapeRequest`/`AnalyzeTextRequest`; fail-closed checks in
  `scan_document`/`scrape_source`/`analyze_text`); `lib/services/
  marketIntelligence/sidecarMarket.ts` (resolve `getSetting()` once inside
  `callSidecarScan`/`callSidecarScrape`, covering all their callers
  uniformly); `app/api/market-intelligence/docs/[id]/analyze/route.ts`
  (resolve directly, `engine === "claude"` branch only).
- Tests: **rewrite** (not just update) `sidecar/routers/__tests__/
  test_market_gateway.py`'s import-time-singleton-capture assertion, since
  that behavior is being deliberately removed — replace it with a
  call-scoped-construction assertion (client built per request, using the
  caller-supplied key, never at import time); add sentinel/no-leak/
  fail-closed tests for all three endpoints; new vitest coverage for
  `sidecarMarket.ts`'s two functions (credential forwarding, no leakage
  into `persistSidecarPayload`'s DB writes or `ScanSidecarResponse`/
  `ScrapeSidecarResponse`) and for the `docs/[id]/analyze` route; extend
  the grep regression test to cover `market.py`. Because `scrapeOneSource`
  and `run-due`'s `runMarketScrape()` both call `callSidecarScrape()`,
  testing `sidecarMarket.ts` directly (rather than re-testing each of its
  three callers separately) gives coverage of all three trigger paths
  (manual route, worker-polled `run-due`, cron-driven
  `municipalAgendaIngestion`) from one shared test file, the same
  "single source of truth, single test surface" property the file's own
  header comment already claims for its ingestion behavior.
- Depends on: nothing new-infrastructure-wise; sequenced last purely
  because it is the largest single diff and the one genuine structural
  change, not because it is blocked on anything built in Packages 1–3.

## 7. Consequences

- No new encryption key, DB table, Python DB client, credential-caching
  layer, or cross-process dispatch endpoint is introduced by this ADR —
  consistent with ADR 0001's consequences.
- After all four packages land, every sidecar site that calls
  `ANTHROPIC_API_KEY`-backed AI functionality resolves its credential
  exclusively via Option A; the "remaining migration targets" note in ADR
  0001 §6 is fully closed out.
- `market.py`'s test suite requires a genuine behavioral rewrite (not an
  incremental update) for its singleton-capture assertion — flagged here so
  it is not treated as an incidental test-fix inside a larger diff.
- The `municipal-agenda-ingestion` cron path's reliance on `getSetting()`
  being callable from `tsx`-executed scripts (not just Next.js route
  handlers) is now load-bearing for `market.py`'s credential resolution;
  this is already true of `appSettingsService.ts` today (it is a plain
  Prisma-backed async function with no Next.js-specific dependency) but is
  worth a coordinator's awareness since it is a new *reason* that property
  must keep holding, not merely an existing convenience.
