# Staging Release Bridge Runbook

Operator procedure for moving the `integration/foundation-ci-divergence`
line — currently a long chain of local-only work (CI guardrails, divergence
tooling, Spec Book durable storage + file-integrity, ADR 0001/0002 credential
migrations across the AI surface, the provider-readiness truth surface, the
portfolio Morning Strip, MI-10 surface honesty, the Drawing storage preflight
brief, and the BlobStore reconciliation dossier) from "never deployed or
validated against real staging" to a controlled, evidenced staging rollout.
This is the **foundation** document only:

- **This runbook is documentation.** No Compose file, Dockerfile, runtime
  config, or source file was modified while authoring it. No Docker command
  and no live/HTTP request to staging (or anywhere else) was run.
- **This is a STAGING-only exercise.** It does not touch, resolve, or claim
  to resolve the production BlobStore reconciliation blocker (§8). Production
  promotion is a separate, still-blocked concern.
- **The existing Spec Book staging smoke helper is NOT storage-only.** Its
  upload step fires real outbound Anthropic calls in the background
  regardless of operator intent (§4). Read §4 before running anything from
  `runtime/runbooks/specbook-staging-validation.md`.

---

## Scope

Covers the rebuild-and-activate sequence needed to bring the
`app` / `sidecar` / `worker` staging tier (per
`runtime/compose/overrides/staging.active.yml`) up to the current tip of
`integration/foundation-ci-divergence`, plus one deliberate, minimal,
real-provider verification step and the existing Spec Book smoke, in a safe
order. Does not cover: production promotion (§8), the `cron` overlay
(out of scope for this rollout — see §2.4), or writing any new
backup/restore/rollback script (those remain documentation-only per
`runtime/runbooks/staging-backup-restore.md`).

---

## 0. Baseline this runbook assumes

Per this task's brief, the currently-documented staging image baseline is:

| Service | Tag | Given as |
|---|---|---|
| app | `e5d50b0-specbook-storage-smoke` | task-supplied |
| sidecar | `5c1877c-integration-smoke` | task-supplied |
| worker | unchanged | task-supplied |
| cron | unchanged | task-supplied |

**No file in this repo's docs (`runtime/runbooks/`, `runtime/STATUS.md`,
`runtime/compose/`, `docs/architecture/REALITY.md`,
`docs/architecture/CURRENT_STATE.md`) independently confirms the exact tag
strings `e5d50b0-specbook-storage-smoke` or `5c1877c-integration-smoke`.**
`grep -rl "e5d50b0\|5c1877c" **/*.md` finds the bare SHA `e5d50b0` mentioned
only in `docs/architecture/REALITY.md` §3 ("only Spec Book has \[migrated
onto BlobStore\] (commit `e5d50b0`)") — confirming `e5d50b0` as *a* real,
meaningful commit on this branch, but not confirming it as a staging image
tag, and not confirming `5c1877c` anywhere. This runbook uses both tags
exactly as given in the task brief, per instruction, without inventing
additional specifics.

**Anomaly worth a human's attention (not resolved here):** the two given SHAs
do not actually correspond to an "app baseline" / "sidecar baseline" split in
the source history:

- `e5d50b0` ("fix(specbook): persist artifacts to durable storage",
  2026-07-04) touches only `app/api/bids/[id]/specbook/**`,
  `lib/storage/blobStore.ts`, and their tests — **zero files under
  `sidecar/`**.
- `5c1877c` ("feat(portfolio): add grouped portfolio launcher",
  2026-07-03 — chronologically **before** `e5d50b0`) touches only
  `app/components/AppSidebar.tsx` and `app/portfolio/page.tsx` — **also zero
  files under `sidecar/`**, and nothing about the sidecar at all.

Neither commit is a sidecar-specific milestone. Both are app-layer-only
commits from the same linear history (`5c1877c` is an ancestor of `e5d50b0`).
Treat the "sidecar pinned at 5c1877c" framing as a label of convenience from
the task brief, not a source-verified sidecar release point — flagged in
§10 for a human to confirm what the sidecar's *actual* last-good staging tag
is before running any of the steps below for real.

---

## 1. Compose topology as it actually is (read before planning anything)

Source: `runtime/compose/base.yml`, `runtime/compose/overrides/staging.yml`,
`runtime/compose/overrides/staging.active.yml`, `runtime/compose/TOPOLOGY.md`.

- `base.yml` defines seven services (`caddy`, `app`, `sidecar`, `worker`,
  `landing`, `hello`, `api`); staging only ever starts `app sidecar worker`
  (explicit service list in every documented invocation — `staging.yml`'s
  and `staging.active.yml`'s header comments both say so).
- Image tags are **not** literal `:tag` strings baked into `base.yml`. They
  are set entirely in the tier override, and in the actually-activatable
  file (`staging.active.yml`) they are expressed as **one shared env-var
  substitution**, `${APP_SHA:?APP_SHA must be set to the staging deploy SHA}`,
  applied identically to all three images:
  ```
  app:      ghcr.io/ghostdwg/groundworx-app:${APP_SHA:...}
  sidecar:  ghcr.io/ghostdwg/groundworx-sidecar:${APP_SHA:...}
  worker:   ghcr.io/ghostdwg/groundworx-worker:${APP_SHA:...}
  ```
  **This is an important structural fact for §3 below:** the current override
  file has no mechanism to pin app/sidecar/worker to *different* tags (e.g.
  app at `e5d50b0-...`, sidecar at `5c1877c-...`) in a single `docker compose
  up` invocation — it's one `APP_SHA` for all three image repos. The task's
  own baseline table (§0) describing per-service tags is therefore already
  describing a state the current override file cannot express without being
  edited (which this task forbids). This is flagged as a gap for a human in
  §10, not resolved here.
- The placeholder file `runtime/compose/overrides/staging.yml` (Phase R3,
  NOT invocable — its own header says so) uses per-service literal
  `<staging-sha>` placeholders instead, which *would* support independent
  tags, but it is explicitly documented as superseded by `staging.active.yml`
  for actual deploy use.
- `runtime/compose/overrides/cron.yml` is a **separate, additive** overlay
  (adds a `cron` service) that is not layered into either staging invocation
  above. Per its own header, activating it is "operator-gated" and "staging
  only until soaked" — a distinct feature line (O2.2 autonomous cadence), not
  part of this rollout's scope. See §2.4.

---

## 2. Which services actually need rebuilding — file-path evidence

Method: read each service's Dockerfile to determine its real build context,
then intersect that context against the full changed-file list since each
baseline SHA (`git diff e5d50b0..HEAD --name-only`,
`git diff 5c1877c..HEAD --name-only` — both captured against this
runbook's own commit; re-run fresh before trusting old output). Both diffs
are effectively the same file set (`5c1877c` is an ancestor of `e5d50b0`; the
10-line delta between the two diffs is exactly the Spec Book route +
`blobStore.ts` files `e5d50b0` itself introduced).

### 2.1 App — REBUILD REQUIRED

`Dockerfile` (repo root) build command, confirmed via
`runtime/runbooks/staging-activation-full.md:73`:
```
docker build -t ghcr.io/ghostdwg/groundworx-app:local -f Dockerfile .
```
Build context is **the entire repo root** (`COPY . .` at `Dockerfile:16`,
after `COPY package.json package-lock.json ./` + `COPY prisma ./prisma/` in
the deps stage). Every one of the following changed-file categories falls
inside that COPY scope and therefore requires an app rebuild:

- Every route under `app/api/**` and `app/**` that changed (drawings/analyze,
  schedule-v2/generate, specbook/{upload,split,gaps,analyze/complete,
  sections/[sectionId]/pdf,[uploadId]}, submittals/{generate-ai,packages},
  market-intelligence/docs/[id]/analyze, settings/ai-readiness, plus the
  UI files `DocumentsTab.tsx`, `SubmittalsTab.tsx`, the `market-intelligence/`
  page tree, `portfolio/{MorningStrip.tsx,page.tsx}`,
  `settings/AiSettingsCard.tsx`, `submittals/page.tsx`).
- `lib/services/ai/{gateway.ts,aiUsageLog.ts,providerReadiness.ts}`,
  `lib/services/jobs/specAnalysisAutomation.ts`,
  `lib/services/marketIntelligence/sidecarMarket.ts`,
  `lib/services/portfolio/morningStrip.ts`,
  `lib/services/specbook/{fileAvailability.ts,sourceSectionLink.ts}`,
  `lib/services/submittal/organizeWithAi.ts`,
  `lib/storage/blobStore.ts`, `lib/observability/metrics.ts`.
- `package.json` (dependency/lockfile-adjacent — always forces a rebuild).
- `governance/guardrails/allowlist.json` (read by app-side guardrail checks
  at runtime, per the same COPY scope).

**Conclusion: app image must be rebuilt from `Dockerfile` at repo root.**

### 2.2 Sidecar — REBUILD REQUIRED

`sidecar/Dockerfile` build command, confirmed via
`runtime/runbooks/staging-activation-full.md:74`:
```
docker build -t ghcr.io/ghostdwg/groundworx-sidecar:local -f sidecar/Dockerfile sidecar
```
Build context is **`sidecar/` only** (`COPY . .` at `sidecar/Dockerfile:23`,
run with build context `sidecar`, not the repo root). Changed files under
that scope since the baseline:

- `sidecar/routers/drawings.py`, `sidecar/routers/market.py`,
  `sidecar/routers/parse.py`, `sidecar/routers/__tests__/test_market_gateway.py`
- `sidecar/services/ai_extractor.py`, `sidecar/services/drawing_intelligence.py`,
  `sidecar/services/meeting_intelligence.py`,
  `sidecar/services/schedule_intelligence.py`,
  `sidecar/services/spec_intelligence.py`,
  `sidecar/services/submittal_intelligence.py`, and their six matching
  `__tests__/test_*_credential.py` / `test_*.py` files.

This confirms the task brief's premise: `sidecar/routers/parse.py` and
`sidecar/routers/market.py` were extensively modified (ADR 0002 credential
migrations), but the actual footprint is larger than just those two files —
it includes essentially every sidecar AI-adjacent module
(`ai_extractor.py`, `drawing_intelligence.py`, `meeting_intelligence.py`,
`schedule_intelligence.py`, `spec_intelligence.py`,
`submittal_intelligence.py`, plus `drawings.py`).

**Conclusion: sidecar image must be rebuilt from `sidecar/Dockerfile`, build
context `sidecar/`.**

### 2.3 Worker — NO REBUILD NEEDED (with one operational caveat)

`runtime/worker/Dockerfile` build command, confirmed via
`runtime/worker/README.md` ("Build invocation... Build context is
`runtime/worker/` — the Dockerfile and entrypoint.sh."):
```
docker build -t ghcr.io/ghostdwg/groundworx-worker:<sha> runtime/worker/
```
Build context is **only `runtime/worker/`** (two files: `Dockerfile`,
`entrypoint.sh`). Checked both diffs (`git diff e5d50b0..HEAD --name-only`,
`git diff 5c1877c..HEAD --name-only`) for any path under `runtime/worker/`
— **zero matches in either diff.** Neither `runtime/worker/Dockerfile` nor
`runtime/worker/entrypoint.sh` changed since either baseline.

**Conclusion: no rebuild is needed for the worker image.** The already-built
worker image content at the current baseline tag remains valid.

**Caveat (see §1):** because `staging.active.yml` pins app, sidecar, *and*
worker to the same `${APP_SHA}` variable, an operator who bumps `APP_SHA` to
a new candidate tag for the app/sidecar rebuild will also cause Compose to
try to pull `ghcr.io/ghostdwg/groundworx-worker:<new-tag>` — an image that
does not exist under that tag unless someone also re-tags/re-pushes the
existing (unchanged) worker image content under the new tag. This is not a
rebuild in the "new content" sense, but it is a required **re-tag-and-push**
action purely to satisfy the override file's shared-tag mechanics. Flagged
in §10.

### 2.4 Cron — OUT OF SCOPE for this rollout; would need a rebuild if ever activated

Two separate findings:

1. **Out of scope today.** `runtime/compose/overrides/cron.yml` is a
   separate, additive overlay not referenced by either staging Compose
   invocation this runbook drives (`base.yml` + `staging.active.yml`,
   `app sidecar worker` only). Bringing cron up requires an operator to
   explicitly add `-f runtime/compose/overrides/cron.yml` and start the
   `cron` service by name — not part of this rollout's activation command
   (§3.3).
2. **If it were activated, it would need a rebuild.** `runtime/cron/Dockerfile`
   header states plainly: "BUILD CONTEXT: `docker build -f
   runtime/cron/Dockerfile -t groundworx-cron:dev .` (build context = repo
   root so the COPY can grab the app source tree)", and its `COPY . .`
   (`runtime/cron/Dockerfile:51`) copies the same full repo tree as the app
   Dockerfile. Every file cited in §2.1 as forcing an app rebuild (in
   particular `lib/services/ai/gateway.ts`, which `scripts/run-cycle.ts`
   transitively imports via the runner dispatcher) also falls inside the
   cron image's build scope.

**Conclusion: the task brief's "worker/cron unchanged" framing is correct
for the worker (§2.3, verified) but is only correct for cron in the narrow
sense that cron is not part of this rollout's activation scope at all — not
in the sense that a cron image, if built today, would contain no changes.**
If a human is running a soaking cron overlay on staging independently of
this rollout, that image is stale relative to `integration/foundation-ci-divergence`'s
tip and should be rebuilt on its own schedule; this runbook does not drive
that rebuild.

---

## 3. Rollout layers, in order

### 3.1 Local image build (described, not executed)

```
# app — from repo root
docker build -t ghcr.io/ghostdwg/groundworx-app:<candidate-sha> -f Dockerfile .

# sidecar — from sidecar/ build context
docker build -t ghcr.io/ghostdwg/groundworx-sidecar:<candidate-sha> -f sidecar/Dockerfile sidecar

# worker — NOT rebuilt (§2.3); existing content re-tagged/re-pushed under
# <candidate-sha> only to satisfy staging.active.yml's shared APP_SHA var:
docker tag ghcr.io/ghostdwg/groundworx-worker:<current-baseline-tag> \
           ghcr.io/ghostdwg/groundworx-worker:<candidate-sha>
```
`<candidate-sha>` should be the actual reviewed/approved commit SHA of
`integration/foundation-ci-divergence`'s tip at rollout time (per
`staging.active.yml`'s own comment: "`APP_SHA=<reviewed-and-approved-sha>`"),
not a made-up label.

### 3.2 Temporary image-pin override (described, not edited)

`staging.active.yml` already reads `APP_SHA` from the invoking shell's
environment (`${APP_SHA:?APP_SHA must be set...}`) — no file edit is
required to point staging at a new candidate tag; the operator sets the
env var at invocation time:
```
APP_SHA=<candidate-sha> docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```
This is the existing, documented invocation shape (`staging.active.yml`
header) — this runbook does not introduce a new one.

### 3.3 App-only vs. app-plus-sidecar activation

**This rollout requires both app and sidecar**, confirmed explicitly by §2.1
and §2.2: the ADR 0001/0002 credential migrations touched
`sidecar/routers/parse.py` and `sidecar/routers/market.py` (per the task
brief) plus, per this runbook's own diff read, the remaining sidecar
AI-adjacent modules. An app-only activation would leave the sidecar serving
stale credential-resolution code while the app-side gateway/ADR changes
expect the new contract — an app-only rollout is not a valid option here.
Worker is re-tagged only (§2.3/§3.1), not functionally changed.

### 3.4 Health checks

Existing mechanisms, per `runtime/compose/base.yml` and
`runtime/deployment/health-check.sh`:

- App: `curl -sf http://localhost:3000/api/health` (Compose healthcheck,
  `base.yml:79-84`).
- Sidecar: `curl -sf http://localhost:8001/health` (Compose healthcheck,
  `base.yml:98-103`).
- `runtime/deployment/health-check.sh` is a **documented stub, not active**
  (its own header: "STATUS: STUB. NOT ACTIVE... prints the actions it would
  take and exits without contacting any container"). It describes the same
  two probes plus a worker tick-file probe (not yet applicable — no
  healthcheck is defined on the worker service in `base.yml` today) and a
  public-reachability probe against the tier hostname. Treat its printed
  plan as the intended checklist, not an executable tool today.
- Confirm both container healthchecks report healthy (`docker compose ps` —
  no live query performed by this runbook; this is what the operator runs)
  **before** proceeding to §3.5.

### 3.5 Provider-readiness route verification (safe, read-only, FIRST real check)

`GET {APP_URL}/api/settings/ai-readiness` — admin-only
(`isAdminAuthorized()` per `lib/auth.ts:84-95`), and per its own route
comment (`app/api/settings/ai-readiness/route.ts:6-8`): "This route NEVER
makes a live provider call and NEVER returns, logs, or serializes a
credential value — only classifications, booleans, counts, and timestamps."
Its response shape (`lib/services/ai/providerReadiness.ts`) includes
`credentialConfigured`, `credentialSource`, `stubMode`, `usageEvidence`, and
`liveProviderVerification` (always `"NOT_VERIFIED"` — see §10 and §3.6).
Run this **before** any real provider call, purely to confirm the credential
appears configured (source `"database"` or `"environment"`) before spending
a real call attempting to prove it.

### 3.6 Controlled provider verification (ONE deliberate, minimal real call)

**No dedicated "minimal ping" endpoint exists in this codebase.** Checked
`app/settings/AiSettingsCard.tsx` (the AI settings UI) — it calls
`/api/settings/{app,ai-tokens,ai-usage,ai-readiness}`, none of which fire a
live provider call. The smallest **synchronous** real-call route found is:

```
POST {APP_URL}/api/bids/{bidId}/intelligence/generate
```
(`app/api/bids/[id]/intelligence/generate/route.ts:124-152`) — unlike the
Spec Book upload route's fire-and-forget calls (§4), this route's `POST`
handler `await`s `generateBidIntelligence(bidId)` directly and returns the
real outcome synchronously: `200 { success: true, findingCount, coverage }`
on success, `503` if `ANTHROPIC_API_KEY` isn't configured, or `500` with the
real error message inline on failure (e.g. the known 401). This makes it the
best available "one deliberately minimal real Anthropic call" for this
step — run it once, against the disposable synthetic bid created in §5, and
capture the raw HTTP status + body as evidence (§7).

**Evidence gap, stated plainly (per `lib/services/ai/providerReadiness.ts`'s
own module doc, lines ~27-34):** there is no durable, source-backed record
in this codebase today that distinguishes "a real provider response was
received" from "a stub-mode code path logged the same row shape." The
`AiUsageLog` table (`lib/services/ai/aiUsageLog.ts`) records every call
attempt (model, tokens, cost, `status: "ok"|"error"`) but the same schema is
written whether the underlying call was real or stubbed — this is why
`providerReadiness.ts`'s `liveProviderVerification` field is hard-coded to
`"NOT_VERIFIED"` rather than computed. **This step currently has no way to
durably prove its own success beyond the raw HTTP response captured in the
moment** (a `200` with a plausible `findingCount` and no error, immediately
inspected and recorded by the operator) — flagged here as a gap, not solved
by this runbook.

### 3.7 Spec Book staging smoke

Only **after** §3.6 has been run deliberately — see §4 for why. Then follow
`runtime/runbooks/specbook-staging-validation.md` §2 (the six-step
upload → split → list → serve → delete → re-upload flow) and/or run
`scripts/specbook-staging-smoke.mjs` with `--base-url`, `--bid-id`,
`--cookie`, and `--execute` all supplied together (its dry-run default
otherwise — see that script's own header). Use the same disposable
synthetic bid from §5.

### 3.8 Cleanup

Per `scripts/specbook-staging-smoke.mjs`'s own documented behavior and
`specbook-staging-validation.md` §2.5: `DELETE
{APP_URL}/api/bids/{bidId}/specbook/{uploadId}` removes the `SpecBook` row
and its known BlobStore artifacts. Additionally remove the synthetic `Bid`
row created in §5, since it was created solely for this drill (per
`specbook-staging-validation.md` §5's "do not delete a bid a teammate is
using for something else" — this one has no such conflict because it was
synthetic to begin with).

### 3.9 Rollback

See §6.

---

## 4. Why the Spec Book smoke cannot run first, or alone, as "storage-only"

`app/api/bids/[id]/specbook/upload/route.ts` (the route both the manual
runbook and the smoke script drive for their Step 1) contains, immediately
after the `201` success path (lines ~187-192):
```ts
// Fire-and-forget intelligence regeneration — does not block upload response
generateBidIntelligence(bidId).catch((err) =>
  console.error("[specbook/upload] background intelligence generation failed:", err)
);
triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
  console.error("[specbook/upload] background brief refresh failed:", err)
);
```
Both `generateBidIntelligence` (`app/api/bids/[id]/intelligence/generate/route.ts`)
and `triggerBriefRefresh` (`lib/services/jobs/briefRefreshAutomation.ts`) make
real outbound Anthropic calls via the gateway. They are not awaited and do
not affect the `201` response or any of the six steps'
pass/fail criteria (`specbook-staging-validation.md` §6 documents this
correctly), but they **do fire** — every single time Step 2.1 (upload) or
Step 2.6 (re-upload) runs, regardless of operator intent. So: running the
smoke as a "storage-only, first, safe" step is a mistaken framing — it will
make two real outbound Anthropic requests during its very first step. The
correct sequencing is to treat §3.6 as the deliberate, acknowledged first
real provider call (made knowingly, with its own evidence captured), and
only run the smoke (§3.7) afterward — so the smoke's incidental
fire-and-forget calls land on a credential/pathway an operator has already
deliberately verified, rather than being the *accidental* first real call
of the whole rollout.

---

## 5. Required staging preconditions

- **Authenticated admin access.** Per `lib/auth.ts:84-95`
  (`isAdminAuthorized()`), a valid staging session with `role: "admin"` (or,
  in a non-production dev context only, `AUTH_DISABLED=true` — staging's
  `runtime/env/staging.env.example` requires `AUTH_DISABLED=false`, so a
  real admin session is required on staging).
- **A disposable synthetic Bid record**, not a real customer project.
  Operationally: created fresh at the start of the session (e.g. via the
  staging UI's normal bid-creation flow) with an obviously synthetic name
  (e.g. `"STAGING RELEASE BRIDGE DRILL <date>"`), used only for §3.6–§3.8,
  and deleted at the end of the same session (§3.8) — never reused across
  sessions, never a bid a teammate might also be using.
- **A synthetic PDF fixture.** Use
  `scripts/specbook-staging-smoke.mjs`'s existing in-memory
  `buildSyntheticPdf()` generator (per the runbook's own §10/§5 "no-secret-
  fixture rule": a small PDF with fake CSI-style section headers like
  "SECTION 09 91 00 — PAINTING") — never a real project document.
- **Expected cleanup path** — §3.8 above, matching
  `specbook-staging-validation.md` §2.5's documented delete behavior.
- **Image tags to be used** — the `<candidate-sha>` from §3.1/§3.2 for app
  and sidecar; the re-tagged worker image from §2.3's caveat.
- **Explicit rule:** no real customer document content is ever used in any
  step of this process — same no-secret-fixture discipline as
  `specbook-staging-validation.md` §5 and the no-secret-logging rules in
  `staging-backup-restore.md` §6.

---

## 6. Rollback boundaries

- **App-only image swap back to the `e5d50b0` baseline** is sufficient
  rollback **only if** the sidecar and worker were not part of what actually
  changed behavior during this rollout. That is **not** the case here — §2.2
  confirms the sidecar changed extensively (ADR 0001/0002 credential
  migrations across `sidecar/routers/{parse,market,drawings}.py` and six
  `sidecar/services/*.py` modules). **Rollback for this specific rollout
  must revert both the app image and the sidecar image together** — an
  app-only rollback would leave a new sidecar talking to an old app (or
  vice versa) against a contract neither side necessarily still expects.
- **Worker** was never functionally changed (§2.3) — no worker rollback
  action is needed beyond leaving its tag alone (or reverting the
  re-tag-and-push from §3.1's caveat, which is a no-op content-wise).
- **What must NEVER be touched, no matter what, during this entire
  rollout:**
  - The **production** Compose stack — a fully separate Compose project
    (`neuroglitch`, not `neuroglitch-staging`), separate network
    (`neuroglitch_neuroglitch` vs. `neuroglitch-staging_neuroglitch`),
    separate storage bind (`/opt/neuroglitch/storage` vs.
    `/opt/neuroglitch/storage-staging`), per
    `runtime/compose/TOPOLOGY.md` and `staging.active.yml`'s own isolation
    table. Production currently runs branch `feat/storage-auth-job-dedupe`
    at a distinct commit — not this integration branch — per
    `docs/architecture/REALITY.md` §3 and
    `docs/architecture/prod-blobstore-reconciliation-dossier.md`.
  - Any real customer data, on either tier.
  - The BlobStore production reconciliation — still explicitly unresolved
    per `docs/architecture/prod-blobstore-reconciliation-dossier.md` (§8
    below). This staging rollout is not, and must never be conflated with,
    production promotion.

---

## 7. Evidence checklist

Capture and record, at each numbered stage:

| Stage | Evidence to capture |
|---|---|
| §3.1 Build | Image digests (`docker inspect --format='{{.Id}}'`) for the newly built app and sidecar images, and for the re-tagged worker image — proves what was actually built, not just intended |
| §3.2 Activation | The exact `APP_SHA` value used in the `docker compose up` invocation |
| §3.4 Health | App and sidecar Compose healthcheck status (`healthy`/`unhealthy`/`starting`) and the container IDs actually running post-recreate (`docker compose -p neuroglitch-staging ps`) — proves what's actually deployed |
| §3.5 Readiness | The exact JSON body of `GET /api/settings/ai-readiness` (`credentialConfigured`, `credentialSource`, `stubMode`, `usageEvidence`, `liveProviderVerification`) |
| §3.6 Provider verification | HTTP status + full response body of the one `POST /api/bids/{bidId}/intelligence/generate` call (never log prompt/document content — only the JSON response shape already documented in §3.6) |
| §3.7 Spec Book smoke | Full pass/fail output for all six steps, per `specbook-staging-validation.md` §3/§4's own evidence-and-pass/fail tables |
| Worker/cron non-rebuild proof | This runbook's §2.3/§2.4 file-path citations (no live proof needed — the claim is about source, not runtime state) |
| Production untouched | Explicit note in the session record that no command in this session referenced the `neuroglitch` (non-`-staging`) Compose project, host, or branch — production is a fully separate Compose project per `runtime/compose/TOPOLOGY.md` |

---

## 8. Production promotion remains blocked (unchanged by this runbook)

Per `docs/architecture/prod-blobstore-reconciliation-dossier.md`: production
promotion is blocked by (a) production's absolute-file-path BlobStore
contract vs. integration's relative-key contract, and (b) real,
unresolved `git merge-tree` conflict markers in three Spec Book route files —
`app/api/bids/[id]/specbook/upload/route.ts`,
`app/api/bids/[id]/specbook/split/route.ts`, and
`app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts` — per the
dossier's own citations. **Nothing in this staging rollout plan changes,
resolves, or is intended to resolve that production blocker.** This runbook
is staging-only, start to finish.

---

## 9. What this runbook does NOT do

- Does not modify any Compose file, Dockerfile, runtime configuration, or
  source code.
- Does not run any Docker command or make any live/HTTP request to staging
  or anywhere else.
- Does not resolve the production BlobStore reconciliation blocker (§8).
- Does not build a "minimal ping" endpoint — none exists today (§3.6); this
  runbook names the best available substitute and states the gap plainly.
- Does not build the provider-invocation-evidence mechanism
  `providerReadiness.ts` itself says is missing (§3.6) — flagged, not built.
- Does not activate or rebuild the `cron` overlay — out of scope (§2.4).

---

## 10. Judgment calls for a human to double-check

1. **The baseline tags themselves.** Neither `e5d50b0` nor `5c1877c` is
   independently confirmed anywhere in this repo's docs as the literal
   staging image tag string given in the task brief, and `5c1877c` contains
   no sidecar-relevant change at all (§0). Confirm the actual last-known-good
   sidecar staging tag before relying on this runbook's baseline table.
2. **The shared-`APP_SHA` override mechanics.** `staging.active.yml` cannot
   express independent per-service tags today (§1/§2.3) — decide whether to
   accept the worker re-tag-and-push workaround (§3.1) each time, or to
   propose (separately, not in this session) a per-service SHA variable
   scheme in a future change to the override file.
3. **§3.6's provider-verification call site.** `POST
   /api/bids/{id}/intelligence/generate` is the best available minimal real
   call this task found, but it assembles a full review prompt (not a
   trivial "ping") — confirm the cost/token profile is acceptable for a
   verification-only call before running it against staging.
4. **The provider-invocation-evidence gap (§3.6).** `liveProviderVerification`
   is permanently `"NOT_VERIFIED"` by design in this codebase today. Decide
   whether closing that gap (a durable, source-backed "this was a real
   provider response" record) is worth a future, separately-scoped change
   before treating any future rollout's provider check as fully provable.
5. **`runtime/runbooks/README.md`'s own "Phase R1: Empty" framing** is
   already stale relative to its actual contents (ten-plus populated
   runbooks) — noted here only because this runbook adds an eleventh row to
   that same stale table (§ index update below); fixing the header framing
   itself is out of this task's scope.

---

## Canonical references

- `runtime/compose/base.yml`, `runtime/compose/overrides/staging.yml`,
  `runtime/compose/overrides/staging.active.yml`, `runtime/compose/TOPOLOGY.md`
- `Dockerfile` (repo root), `sidecar/Dockerfile`, `runtime/worker/Dockerfile`,
  `runtime/worker/README.md`, `runtime/cron/Dockerfile`, `runtime/cron/README.md`,
  `runtime/compose/overrides/cron.yml`
- `runtime/deployment/health-check.sh`
- `app/api/settings/ai-readiness/route.ts`, `lib/services/ai/providerReadiness.ts`
- `app/api/bids/[id]/intelligence/generate/route.ts`,
  `app/api/bids/[id]/specbook/upload/route.ts`,
  `lib/services/jobs/briefRefreshAutomation.ts`, `lib/services/ai/aiUsageLog.ts`
- `runtime/runbooks/specbook-staging-validation.md`,
  `scripts/specbook-staging-smoke.mjs`
- `lib/auth.ts` (`isAdminAuthorized`)
- `docs/architecture/REALITY.md`, `docs/architecture/prod-blobstore-reconciliation-dossier.md`
- `runtime/runbooks/staging-backup-restore.md` (no-secret-logging discipline
  this runbook's §5/§7 follow)
