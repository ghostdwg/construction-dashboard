# Spec Book Staging Validation Runbook

Operator procedure for manually validating the Spec Book flow on staging —
upload → split → serve a section PDF → delete → re-upload. This is the
**foundation** document only:

- **This runbook is documentation.** No HTTP request, browser action,
  provider call, Docker action, DB action, or storage inspection has been
  performed as part of authoring it.
- **No new script is required to use this runbook.** An optional, dry-run-by-
  default fixture helper is described in §11 for operators who want a
  scripted walkthrough of the same steps; using it is not mandatory and it
  was never invoked while authoring this document.
- **Staging currently has a known blocker: Anthropic 401.** See §6. Read
  that section before running anything, or a 401-caused partial failure
  will be misread as a storage/routing bug.

## Storage-only validation vs. real-AI validation — read this first

This runbook (and the helper script in §10) now supports **two distinct
modes**. They are NOT interchangeable and prove different things:

| | **Storage-only mode** (new) | **Real-AI mode** (original scope of this document) |
|---|---|---|
| What it proves | Upload/split/serve/delete/re-upload storage & DB mechanics ONLY | The same mechanics, **plus** that the fire-and-forget `generateBidIntelligence`/`triggerBriefRefresh` calls actually reach Anthropic and complete |
| What it does NOT prove | Anything about AI/provider behavior — it deliberately suppresses those calls | Nothing extra — but currently blocked by staging's known Anthropic 401 (§6) |
| How suppression engages | ALL FOUR of: (a) an **admin** session, (b) the `X-Specbook-Storage-Smoke: 1` request header, (c) server env `STORAGE_SMOKE_MODE_ENABLED=true`, (d) server `APP_ENV=staging` — see `app/api/bids/[id]/specbook/upload/route.ts`'s module doc for the exact contract | N/A — this is simply today's default (unsuppressed) behavior |
| Evidence in the response | `automationStatus: "suppressed_for_storage_smoke"` on the upload response | `automationStatus: "triggered"` (background calls fired; success/failure is async and not reflected in this response — see §2.1) |
| When to use it | Right now, while the Anthropic credential rotation is pending — this is the ONLY validation currently possible without risking a real (currently-broken) provider call | Only after the staging `ANTHROPIC_API_KEY` rotation lands and the 401 is confirmed resolved |
| Production use | **Prohibited, absolutely.** The suppression gate's condition (d) — `APP_ENV=staging` — is a server-side identity fact set exclusively by `/opt/neuroglitch/.env` vs `/opt/neuroglitch/.env.staging` per the Compose topology (see `runtime/env/production.env.example`, which has `APP_ENV=production`) and Zod-validated at boot (`lib/env.ts`). It cannot be true in production, so this mode is structurally inert there — but never attempt it regardless. | Real-AI mode is production's actual default behavior; nothing to prohibit |
| Real customer documents | **Prohibited in both modes**, same as always (§5) — always use the synthetic fixture | **Prohibited in both modes** |
| Cleanup after the run | **Required in both modes**, same as always (§5's rollback boundaries). When using `scripts/specbook-staging-smoke.mjs` for a storage-only run, this is now automatic on success — see §10's self-cleanup note — no manual `DELETE` needed afterward. A by-hand run through §2–§7 (no script) still requires manual cleanup as always. | **Required in both modes** (no scripted self-cleanup exists for real-AI mode; this script cannot perform that mode at all) |

**Bottom line:** storage-only mode lets you validate this runbook's §2
mechanics today, safely, without a working Anthropic credential. It proves
nothing about AI — do not report a storage-only pass as evidence that AI
generation works. Once the credential rotation lands, re-run in real-AI mode
(the script's historical default, before storage-only mode existed) for the
AI-inclusive validation this document originally described.

### Fail-closed server contract (work package: specbook-smoke-fail-closed)

Any request that carries the `X-Specbook-Storage-Smoke: 1` marker header is
now treated by `app/api/bids/[id]/specbook/upload/route.ts` as an **explicit
storage-smoke attempt**. If the marker is present but any of the other three
conditions (staging tier, `STORAGE_SMOKE_MODE_ENABLED=true`, admin session)
does not also hold, the request is now **rejected outright** — a controlled,
non-2xx response, returned before any BlobStore write or database
persistence — rather than silently falling through to normal (real-provider-
calling) automation. This closes a prior gap where a marker-bearing request
with one condition unmet would still complete as a normal upload and still
fire the real `generateBidIntelligence`/`triggerBriefRefresh` calls, exactly
as if the marker had never been sent — the operator's explicit intent to run
storage-only was silently ignored rather than honored or refused.

Checks run in this order, the moment the marker header is detected, before
the bid-existence lookup or any persistence:

1. `env.APP_ENV !== "staging"` → `403 { error: "Storage-only smoke mode is only permitted on the staging environment" }`
2. `STORAGE_SMOKE_MODE_ENABLED !== "true"` → `403 { error: "Storage-only smoke mode is not enabled on this server" }`
3. Not an authenticated admin session → `401` or `403` (whatever `isAdminAuthorized()` itself reports — `401 { error: "Authentication required" }` if unauthenticated, `403 { error: "Admin access required" }` if authenticated but non-admin)

If the marker is **absent**, none of the above runs at all — the route
behaves exactly as it did before this feature existed. If the marker is
present and all three checks pass, the upload proceeds exactly as before
(real persistence, real parse), only the two provider-bound background calls
are suppressed, and the response's `automationStatus` is
`"suppressed_for_storage_smoke"` as before.

### New helper preflight (work package: specbook-smoke-fail-closed)

`scripts/specbook-staging-smoke.mjs`'s `--execute --storage-only
--cookie-prompt` mode now runs a read-only **"0. preflight bid check"**
(`GET {base}/api/bids/{bidId}`, the plain bid route — not a specbook-specific
one) BEFORE attempting step 1's upload. This exists because a real run
previously failed with a confusing, late 404 mid-upload: staging almost
certainly has no `Bid.id=1` (or whatever id was guessed) by default — `Bid.id`
is an autoincrement integer a validator must obtain from a real `Bid` created
via the UI first (see §1's `bidId` row). The preflight surfaces that same
problem immediately, safely, and read-only, instead of mid-upload.

The preflight uses `redirect: "manual"` (as does every other authenticated
request this script makes, except the deliberately-unauthenticated
auth-posture check in §7/step 4b) — this matters because it turns a
bad/expired/missing session into an explicit, detectable `3xx` status instead
of silently following the redirect to `/login` and evaluating that page's
(HTML) response as if it were the real answer.

The preflight **passes** only when ALL of the following hold: HTTP status is
exactly `200`, the body is JSON-parseable and shaped like a `Bid` (a numeric
`id` field matching the requested `bidId`, per `app/api/bids/[id]/route.ts`'s
`GET` handler), AND the `X-App-Env` response header (set by `proxy.ts` from
the runtime's own Zod-validated `APP_ENV`) is exactly `"staging"`. It **fails
closed** — refuses to proceed to step 1 — on: a `404` (the bid does not
exist: create a real `Bid` via the UI and pass its actual id), a redirect/3xx
(bad or missing session), a non-JSON body (e.g. an HTML error/login page), a
missing or wrong `X-App-Env` header (pointed at the wrong tier — confirm
`--base-url` is actually staging), or any other non-`200` status.

The `--cookie-prompt`-collected value is also validated, before this
preflight (before any network request at all), to look like a well-formed
`name=value` cookie pair — a malformed value fails closed immediately with
the same "refuse before any network action" posture as the script's other
pre-network safety gates.

If a validator hits any of these preflight failures, the fix is almost
always one of: create a real `Bid` via the UI on the target host and pass its
actual id via `--bid-id`, confirm `--base-url` actually points at staging
(not production or a stale local URL), or re-run `--cookie-prompt` with a
fresh, valid admin session cookie.

---

## Scope

Covers the **Spec Book** module only, on the **staging** tier (`APP_ENV=staging`,
per `runtime/runbooks/staging-bootstrap.md` / `staging-first-activation.md`).
The routes under validation:

| Step | Method | Route |
|---|---|---|
| Upload | `POST` | `/api/bids/{id}/specbook/upload` |
| Split | `POST` | `/api/bids/{id}/specbook/split` |
| List sections (to obtain a `sectionId`) | `GET` | `/api/bids/{id}/specbook/gaps` |
| Serve section PDF | `GET` | `/api/bids/{id}/specbook/sections/{sectionId}/pdf` |
| Delete | `DELETE` | `/api/bids/{id}/specbook/{uploadId}` |
| Re-upload | `POST` | `/api/bids/{id}/specbook/upload` (same route as Step 1) |

Not covered: `POST /api/bids/{id}/specbook/analyze` (the AI section-analysis
trigger) and its `POST /api/bids/{id}/specbook/analyze/complete` webhook —
these exist and are described in §6 for context, but a validation pass
against them is out of scope while the Anthropic 401 stands, per the goal
of this document.

---

## 1. Environment inputs a validator needs

Referenced **by name only** — this runbook contains no real values. Source
actual values from the `GroundWorX-staging` 1Password vault or the staging
host, per `runtime/env/staging.env.example`:

| Name | Purpose |
|---|---|
| `APP_URL` / `NEXTAUTH_URL` | Base URL for all requests below (`https://staging.groundworx.neuroglitch.ai`) |
| A valid staging session cookie, OR staging credentials to sign in at `/login` | Auth Wall session — see §7; there is no separate API key for these routes |
| `bidId` | An existing staging `Bid.id` to run the flow against (create one via the UI first if none exists — do not invent one against production) |
| A small test PDF | The document to upload; must not be a real confidential project document (see §3 no-secret-evidence rule) |
| `SIDECAR_API_KEY` (context only) | Consulted by the app when calling the sidecar — a validator does not supply this directly, it is already configured on the staging host; listed here so a validator recognizes it if it appears (redacted) in logs |
| `ANTHROPIC_API_KEY` (context only) | The credential behind the known 401 — see §6; a validator does not need or use this value |

---

## 2. The exact flow to validate

### 2.1 Upload

```
POST {APP_URL}/api/bids/{bidId}/specbook/upload
Content-Type: multipart/form-data
  file: <test.pdf>   (application/pdf, or filename ending .pdf)
```

Server-side, per `app/api/bids/[id]/specbook/upload/route.ts`:
- Verifies the bid exists (`404` if not).
- Writes the raw PDF to BlobStore at the **canonical, single** key
  `plan-room/jobs/{bidId}/spec/original.pdf` — this **overwrites** any prior
  upload for the same bid (see §10 on why this matters for delete/re-upload).
- Deletes any existing `SpecBook` row for the bid (sections cascade), creates
  a new one (`status: "processing"`).
- Calls the sidecar's fast parser (`POST {SIDECAR_URL}/parse/specs`,
  PyMuPDF4LLM) to regex-split into provisional sections. **This call does
  not use Anthropic.** If the sidecar is unreachable or errors, the route
  falls back in-process to a `pdfjs-dist` text extraction — also not
  Anthropic-dependent.
- On success: `201` with the updated `SpecBook` JSON (`id`, `bidId`,
  `fileName`, `filePath`, `status: "ready"`, `_count.sections`,
  `coveredCount`, `gapCount`, `automationStatus`).
- On parse failure: `422` with `{ error: <message> }`; the `SpecBook` row is
  marked `status: "error"`.
- **Fire-and-forget side effects** (do not block the response, do not affect
  pass/fail of this step): document automation is **default-OFF** (Q03.2
  master gate). `generateBidIntelligence(bidId)` and
  `triggerBriefRefresh(bidId)` run in the background — and may themselves
  call Anthropic — ONLY when the deploy-controlled env flag is set to the
  exact literal `DOCUMENT_AUTOMATION_ENABLED=true`; absent, `false`, or any
  other value fails closed and the calls are never made. If automation IS
  enabled and the 401 is still live, expect async
  `[specbook/upload] background intelligence generation failed:` /
  `background brief refresh failed:` lines in the app logs a few seconds
  after the `201` — this is expected noise, not an upload failure (§6).
  `automationStatus` in the response body tells you which happened:
  `"disabled"` (the default — master flag off, no background call made),
  `"triggered"` (flag explicitly `true` — these background calls fired), or
  `"suppressed_for_storage_smoke"` (storage-only mode engaged — the calls
  were never made regardless of the flag; suppression takes precedence, per
  the four-condition contract in
  `app/api/bids/[id]/specbook/upload/route.ts`). A storage-smoke rehearsal
  proves storage mechanics and suppression only — it is never AI/provider
  validation; enabling real automation remains a separate, deliberate
  provider-validation gate.

### 2.2 Split

```
POST {APP_URL}/api/bids/{bidId}/specbook/split
(no body)
```

Per `app/api/bids/[id]/specbook/split/route.ts`:
- Requires a `SpecBook` row with `status: "ready"` for the bid (i.e. Step 2.1
  must have succeeded first) — `404 { error: "No spec book uploaded" }`
  otherwise.
- Resolves the uploaded PDF's BlobStore key to an absolute path
  (`localPathForKey`) and calls the sidecar's page-based splitter
  (`POST {SIDECAR_URL}/parse/specs/split`, PyMuPDF page ranges). **This call
  also does not use Anthropic.**
- Replaces all `SpecSection` rows for the book with the split result; each
  section gets `pdfPath: plan-room/jobs/{bidId}/spec/sections/{filename}`.
- On success: `200 { success: true, sectionsCreated, sectionCount, canonicalMatches }`.
- On sidecar-down: `422` with `{ error: "Sidecar unavailable — make sure the
  Python service is running (\`npm run dev:sidecar\`)" }` (this exact string
  only fires when the fetch itself throws, e.g. connection refused — a
  distinct failure mode from an HTTP error status from the sidecar, which
  instead forwards the sidecar's own status code and `detail`).

### 2.3 List sections (to obtain a real `sectionId`)

```
GET {APP_URL}/api/bids/{bidId}/specbook/gaps
```

Per `app/api/bids/[id]/specbook/gaps/route.ts`, returns the most recent
`SpecBook` plus its sections split into three JSON array fields — `covered`
(trade assigned), `missing` (a known trade matched but not yet on the bid —
referred to as "missingFromBid" in the route's own comments), and `unknown`
(no trade match) — each section including its `id`. Returns a bare `null`
body if no spec book exists for the bid yet. This is the route the Spec Book
UI itself calls to render section lists — use it to pick a real `sectionId`
for the next step rather than guessing one.

### 2.4 Serve a section PDF

```
GET {APP_URL}/api/bids/{bidId}/specbook/sections/{sectionId}/pdf
```

Per `app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts`:
- Looks up the section, confirms `section.specBook.bidId === bidId` (`404`
  otherwise — this also means a `sectionId` from a *different* bid correctly
  404s rather than leaking cross-bid).
- If `pdfPath` is not yet set (split never ran): `404 { error: "PDF not
  available — run Split first" }`.
- Otherwise reads the PDF from BlobStore and streams it back with
  `Content-Type: application/pdf`, `Content-Disposition: inline; filename=...`,
  `Cache-Control: private, max-age=3600`.
- **This call does not use Anthropic** — it is a pure BlobStore read.

### 2.5 Delete

```
DELETE {APP_URL}/api/bids/{bidId}/specbook/{uploadId}
```

`uploadId` here is the `SpecBook.id` (not a section id) — obtained from the
`id` field in the Step 2.1 response or the Step 2.3 listing's `specBook.id`.
Per `app/api/bids/[id]/specbook/[uploadId]/route.ts`:
- Confirms the `SpecBook` belongs to `bidId` (`404` otherwise).
- Nulls `specSectionId` on any `SubmittalItem` rows pointing at this book's
  sections, then deletes the `SpecBook` row (sections cascade).
- Best-effort deletes exactly the artifacts this book is known to own: the
  original PDF key and every section's `pdfPath` — **never a bid/project-wide
  prefix sweep** (see the route's own comment to this effect).
- On success: `204` with an empty body, regardless of whether the underlying
  blob delete found anything (`BlobStore.delete` is a no-op on a missing
  key) — a `204` does not by itself prove the blobs were present or absent
  beforehand; see §4's evidence for how to actually confirm removal.

### 2.6 Re-upload

Repeat Step 2.1 (`POST .../specbook/upload`) against the **same** `bidId`
with a (same or different) test PDF. Because Step 2.1's BlobStore key is the
fixed, non-versioned `plan-room/jobs/{bidId}/spec/original.pdf` (§9), a
re-upload after a delete and a re-upload *without* an intervening delete are
indistinguishable at the storage layer — both simply overwrite the same key.
The DB-level distinction (a fresh `SpecBook` row either way, since upload
always does `deleteMany` then `create`) is what actually proves re-upload
works; the storage key does not.

---

## 3. Safe evidence to capture at each step

Capture only what is listed below. Never capture request/response document
body content, prompts, or credentials — same no-secret discipline as
`runtime/runbooks/staging-backup-restore.md` §6 and
`governance/CONFIDENTIAL_DATA_POLICY.md` ("pricing/credentials never enter
any prompt" — the same fail-closed default applies to validation evidence,
not only AI prompts).

| Step | Evidence to capture |
|---|---|
| 2.1 Upload | HTTP status code; response JSON's `id`, `status`, `_count.sections`, `coveredCount`, `gapCount` (never `fileName` if the test file name itself is sensitive — use a synthetic name like `test-spec.pdf`); whether an app-log line names the sidecar path taken (`sidecar parsed N sections` vs `using pdfjs-dist fallback`) |
| 2.2 Split | HTTP status code; `sectionsCreated`, `sectionCount`, `canonicalMatches` from the response |
| 2.3 List | HTTP status code; count of sections returned per array (`covered`/`missing`/`unknown`, or `coveredCount`/`missingCount`/`unknownCount` from the response body directly); the chosen `sectionId` (a DB integer id — not sensitive, safe to record) |
| 2.4 Serve PDF | HTTP status code; `Content-Type` and `Content-Disposition` response headers; byte length of the response body (`Content-Length` or measured size) — never the PDF's text content |
| 2.5 Delete | HTTP status code (`204` expected); confirm via a **repeat** of Step 2.3 (`GET .../specbook/gaps`) that it now returns `null` (no spec book) for this bid |
| 2.6 Re-upload | Same evidence as 2.1, plus: confirm the returned `SpecBook.id` differs from the Step 2.1 id (proves a fresh DB row, not a stale one) |
| All steps | Any `X-Request-Id`/correlation id the platform emits (check response headers — if none exists, note "no correlation id observed" rather than inventing one) |

---

## 4. Pass/fail criteria per step

| Step | Pass | Fail |
|---|---|---|
| 2.1 Upload | `201`; `status: "ready"`; `_count.sections > 0` | Any other status; `status: "error"`; `_count.sections === 0` when the test PDF has real CSI-style section headers |
| 2.2 Split | `200`; `sectionsCreated > 0` and `sectionsCreated === sectionCount` | `404` (means Step 2.1 didn't actually leave a `ready` `SpecBook` — investigate 2.1 first); `422` — read the error message: sidecar-down text vs. a forwarded sidecar error are different failure classes, treat them differently |
| 2.3 List | `200`; JSON body is non-null and contains at least one section with a numeric `id` | `null` body (no spec book found — re-run 2.1/2.2); `400` (bad `bidId` in the URL — operator error, not a product bug) |
| 2.4 Serve PDF | `200`; `Content-Type: application/pdf`; non-zero body length | `404 "PDF not available — run Split first"` (2.2 didn't actually attach `pdfPath` — investigate 2.2); `404 "Section not found"` (wrong `sectionId`/`bidId` pairing — operator error); a redirect to `/login` (see §7 — this is actually a **pass** for the auth-posture check, but a **fail** for this functional step if you expected to be authenticated) |
| 2.5 Delete | `204`; the follow-up Step 2.3 re-check returns `null` | Any non-`204` status; the follow-up re-check still shows the spec book — deletion did not fully take |
| 2.6 Re-upload | Same criteria as 2.1, plus a new `SpecBook.id` distinct from 2.1's | Same `SpecBook.id` reappearing (would indicate the delete in 2.5 did not actually run, or a caching layer served a stale row) |

---

## 5. Rollback boundaries — what a validator must NOT do mid-flow

- **Do not** delete or touch any `SpecBook`/`SpecSection`/`Bid` row other
  than the one the validator created for this run. Never run a prefix sweep
  or bulk delete against staging storage or the staging DB "to be safe" —
  the delete route itself is scoped to one book's known artifacts for
  exactly this reason (§2.5); a validator manually going further defeats
  that scoping.
- **Do not** loop retries against the `analyze` step (or anything sidecar-
  bound) while the Anthropic 401 stands. A failing AI call is expected right
  now (§6) — repeated retries only generate noisy failed-job rows and
  duplicate cost-log attempts, they will not make the 401 resolve itself.
- **Do not** treat a mid-flow failure as license to improvise a fix against
  staging (e.g., hand-editing a `SpecBook.status` row via Prisma Studio to
  force the flow to continue). If a step fails, stop, capture the evidence
  in §3, and hand off — consistent with `staging-first-activation.md`'s "If
  any step in this runbook fails, abort and document. Do not improvise on
  production" applied here to staging.
- **Do not** use a real, confidential project spec PDF as the test fixture.
  Use a small synthetic PDF with a couple of fake CSI-style section headers
  (e.g. "SECTION 09 91 00 — PAINTING") so that section-count assertions are
  meaningful without ever putting real project content through a tier with
  a known-broken AI credential.
- **Do not** delete the `Bid` row itself as part of cleanup unless the
  validator created it solely for this drill — deleting a bid a teammate is
  using for something else is out of scope and irreversible from this
  runbook's procedure.

---

## 6. Expected behavior while the Anthropic 401 stands

> Staging's `ANTHROPIC_API_KEY` is currently rejected by the provider (401).
> This affects only the AI-analysis leg of Spec Book, not the flow this
> runbook validates. Read this section fully before running anything below,
> so a 401-caused partial failure is not misdiagnosed as a storage/routing
> bug.

| Step | Depends on a successful Anthropic call? | Provable now? |
|---|---|---|
| 2.1 Upload | No — sidecar fast-parse (`/parse/specs`) uses PyMuPDF4LLM only; the pdfjs-dist fallback is pure text extraction | **Yes** |
| 2.2 Split | No — sidecar split (`/parse/specs/split`) is page-range splitting via PyMuPDF only | **Yes** |
| 2.3 List sections | No — pure DB read | **Yes** |
| 2.4 Serve section PDF | No — pure BlobStore read | **Yes** |
| 2.5 Delete | No — DB delete + BlobStore delete | **Yes** |
| 2.6 Re-upload | No — same as 2.1 | **Yes** |
| `POST .../specbook/analyze` (out of scope, listed for context) | **Yes** — triggers the sidecar's Pass 2 per-section Claude analysis (`sidecar/services/spec_intelligence.py`, reads `ANTHROPIC_API_KEY`) | **No, until the 401 is fixed** — expect the background job to fail and the `analyze/complete` webhook to receive `status: "error"` |
| Fire-and-forget `generateBidIntelligence` / `triggerBriefRefresh` triggered by 2.1 | Likely — these call into the AI-backed intelligence pipeline | **No** — but their failure is asynchronous and does not change 2.1's HTTP response; see §2.1 |

**Bottom line:** all six steps of the upload → split → serve → delete →
re-upload flow are independent of Anthropic and are fully provable on
staging today. Only the AI analysis *content* (what Claude actually
extracts from a section) remains unprovable until the 401 is resolved. If
any of the six steps above fails, the 401 is not a valid explanation —
look at the sidecar, BlobStore, or DB instead.

---

## 7. Auth-posture verification

The Spec Book routes above carry **no route-level auth check of their own**
(confirmed by reading `app/api/bids/[id]/specbook/upload/route.ts`,
`split/route.ts`, `sections/[sectionId]/pdf/route.ts`, and
`[uploadId]/route.ts` — none call `auth()`, `getUser()`, or `requireUser()`
from `lib/auth.ts` / `lib/auth-helpers.ts`). Auth is enforced **once, for
every route**, by the Next.js middleware in `proxy.ts` (renamed from
`middleware.ts` — see `AGENTS.md` on this fork's breaking changes from
stock Next.js), which wraps `auth()` from `lib/auth.ts` and redirects any
unauthenticated request to a non-public path to `/login`.

This means a validator confirming auth is enforced must check for a
**redirect**, not a `401` JSON body — a `401`/`403` JSON response from these
specific routes would actually indicate something unusual (there is no code
path in the four route files that returns one).

**Checks a validator should run:**

1. **Unauthenticated GET is rejected, not silently served.** Issue
   `GET {APP_URL}/api/bids/{bidId}/specbook/sections/{sectionId}/pdf`
   with no session cookie / no `Authorization` header attached (e.g. a fresh
   client, or explicitly stripped cookie jar). Pass: a `3xx` redirect whose
   `Location` header points at `/login` (with `callbackUrl` set to the
   original path), or the response body is HTML/redirect — **not** a `200`
   with `Content-Type: application/pdf`. Fail: any `200` PDF response, which
   would mean the middleware's route matcher is somehow not covering this
   path.
2. **`AUTH_DISABLED` is confirmed `false` on staging before relying on check
   #1.** Per `runtime/env/staging.env.example`, `AUTH_DISABLED=false` is
   required in staging and the Phase R5 Zod fence refuses to boot the
   process otherwise. If `AUTH_DISABLED=true` were somehow set, `proxy.ts`
   bypasses the auth gate entirely and check #1 would falsely appear to
   fail. This is a **config precondition to check first**, not a Spec Book
   behavior — if it's wrong, the whole staging tier's auth posture is
   compromised, not just Spec Book.
3. **Authenticated request succeeds.** Repeat check #1 with a valid staging
   session cookie attached. Pass: `200` with `Content-Type: application/pdf`
   (or the section's real not-found/needs-split JSON if that's the honest
   state per §2.4's other codes). This proves the middleware isn't
   over-blocking a legitimate session, complementing check #1.
4. **Cross-bid isolation still holds under auth.** With a valid session,
   request a `sectionId` that belongs to a **different** `bidId` than the
   one in the URL. Pass: `404 { error: "Section not found" }` (per the
   route's explicit `section.specBook.bidId !== bidId` check) — proves the
   route's own authorization-adjacent check (row ownership) works
   independently of the session-level gate in `proxy.ts`. This is a
   different concern from #1–#3 (authentication vs. row-scoping) and both
   should be checked.

---

## 8. Versioned-key follow-up recommendation (future — not implemented here)

**Current state** (per `lib/storage/blobStore.ts` and the routes read in
this task): every Spec Book artifact lives at a fixed, non-content-addressed
key —

```
plan-room/jobs/{bidId}/spec/original.pdf
plan-room/jobs/{bidId}/spec/sections/{filename}
```

`BlobStore.put()` unconditionally overwrites whatever is at a key. Upload,
split, and re-upload all reuse the same key shape, so there is exactly one
"current" spec book per bid at any time, and a re-upload after a delete is
byte-for-byte indistinguishable, at the storage layer, from an upload that
simply replaced a prior one (§2.6). This is fine for today's product model
("only one active spec book per bid") but it means:

- There is no way to recover the *previous* original PDF once a re-upload
  has overwritten it — a mistaken re-upload is not undoable via storage
  alone (only a DB-level audit trail, if one exists elsewhere, could tell
  you what was there before).
- A delete-then-reupload validation drill cannot distinguish "delete
  actually removed the blob and upload wrote a fresh one" from "delete's
  blob-removal step silently no-op'd and upload just overwrote it anyway" —
  both produce the same end state. (§2.5's evidence works around this by
  checking the DB via `/specbook/gaps`, not the blob itself, precisely
  because the blob key alone can't prove it.)

**Recommendation for a future, separately-approved phase:** consider
content-hash-addressed or version-suffixed keys for Spec Book artifacts
(e.g. `plan-room/jobs/{bidId}/spec/{sha256}.pdf`, or a monotonic version
segment `plan-room/jobs/{bidId}/spec/v{n}/original.pdf`), with the current
"active" version referenced by a pointer in the `SpecBook` row rather than
by key convention alone. `BlobStore.put()` already returns a `sha256` in its
`PutResult` (unused today by the upload route, which discards it) — a
first, small step toward this would be persisting that hash on the
`SpecBook`/`SpecSection` rows even before changing the key shape, purely as
an audit trail.

This is **explicitly a recommendation for a future change** — this runbook
and this validation pass do not implement it, and no current storage key or
route was modified while producing this document.

---

## 9. What this runbook does NOT do

- Does not execute any HTTP request, browser action, provider call, Docker
  command, DB query, or storage inspection. None was run while authoring
  this document.
- Does not change any Spec Book route, `lib/storage/blobStore.ts`, or any
  other application behavior.
- Does not validate `POST .../specbook/analyze` or its
  `.../analyze/complete` webhook end-to-end — those depend on a working
  Anthropic credential (§6) and are out of scope until the 401 is fixed.
- Does not implement the versioned-key recommendation in §8 — that is a
  future, separately-approved phase.
- Does not define a live-incident procedure for the 401 itself (rotating
  the staging `ANTHROPIC_API_KEY`, escalation path, etc.) — that is a
  different, credential-rotation runbook that does not exist yet.
- Storage-only mode (see the table near the top of this document) does NOT
  validate Anthropic/provider functionality in any way — it proves
  storage/DB mechanics only, by deliberately suppressing the two
  provider-bound background calls that upload would otherwise fire. A
  storage-only pass is not evidence that AI generation works.

---

## 10. Optional fixture/smoke helper

A dry-run-by-default helper script,
`scripts/specbook-staging-smoke.mjs`, may exist alongside this runbook (see
that file's header for exact usage). If present:

- Running it with **no arguments** only prints the plan above and exits `0`
  — it performs no network action by default.
- **New read-only preflight (work package: specbook-smoke-fail-closed):**
  before step 1's upload, storage-only execute mode now runs a
  `0. preflight bid check` (`GET {base}/api/bids/{bidId}`) that confirms the
  bid exists, the session is valid, and the target host is actually staging
  — see "New helper preflight" above for the full contract. A failure here
  means step 1 is never attempted at all; fix the reported cause (usually a
  missing/wrong `--bid-id` or a non-staging `--base-url`) and re-run. The
  `--cookie-prompt`-collected value is also checked to look like a
  well-formed `name=value` pair before this preflight — before any network
  request at all.
- **This script now has exactly ONE real-run mode: storage-only.** It
  requires an explicit `--base-url` (which must reference a staging host —
  contain the substring `"staging"` — for any real run) **and** the new
  `--cookie-prompt` flag **and** the `--execute` flag **and** the
  `--storage-only` flag, all together, before it will perform any real HTTP
  request. `--execute` without `--storage-only` is refused outright — there
  is no way to make this script attempt a real-AI run; that must be done by
  hand per §2–§7 once the credential rotation lands.
- **`--cookie-prompt` is mandatory for storage-only execute mode, and is the
  only supported way to authenticate this script.** Passing `--cookie` or
  `--bearer` directly alongside `--execute --storage-only` is refused — a
  real session cookie must never be typed as a command-line argument, since
  argv ends up in shell history, in process listings visible to other
  processes/tools on the same host, and (if an AI assistant is the one
  invoking the command on an operator's behalf) echoed verbatim into that
  assistant's chat transcript. `--cookie-prompt` instead prompts
  interactively, with terminal echo disabled, and requires an interactive
  TTY — it refuses immediately, before any request, if invoked from a
  non-interactive context (CI, a piped/redirected invocation, etc.).
  **Run the script locally, on your own machine/terminal — never via a
  remote or shared execution context** — so the entered cookie value is
  never held or transmitted anywhere but your own local process memory.
- In storage-only mode, it sends the non-secret `X-Specbook-Storage-Smoke: 1`
  marker header on every upload call, and asserts the response's
  `automationStatus` field is exactly `"suppressed_for_storage_smoke"` —
  failing loudly if it is not (see step `1c.`/`6c.` in its output). A
  failure there means suppression did not actually engage server-side (wrong
  tier, opt-in not set, or non-admin session) and a real Anthropic call may
  have just fired.
- **Self-cleanup (work package: specbook-smoke-self-cleanup):** after the
  step-6 re-upload and its `automationStatus` assertion (`6c.`) complete, the
  script performs one further step — `7. final cleanup delete` — that issues
  a `DELETE` against the EXACT SpecBook the re-upload itself just created
  (never the first upload's id, never a guessed id). This runs regardless of
  whether `6c.` passed or failed, so a **successful storage-only run no
  longer requires a manual `DELETE` call afterward** — the script cleans up
  its own final artifact automatically. If that final delete itself fails
  (non-`204`), it is recorded as a clear `FAIL` (and contributes to a
  non-zero exit code) but the script still exits cleanly rather than
  crashing — in that case a manual `DELETE` of the reported SpecBook is
  still needed, exactly as before this change. The disposable synthetic
  `Bid` a validator creates for this drill may still remain after a run (per
  §5, deleting it is a separate, human-managed decision) — this self-cleanup
  is about the SpecBook artifact only, and after a successful run that bid
  should contain no SpecBook.
- It adds no new npm dependency — it uses only the global `fetch`/`FormData`
  already relied on by `app/api/bids/[id]/specbook/upload/route.ts`, the
  `node:*` builtins already used by `scripts/validate-staging.mjs`, and (for
  `--cookie-prompt`) direct `process.stdin` raw-mode handling — no new
  password-prompt package.
- It was never invoked against staging (or anywhere else) while producing
  this runbook or the script itself.

**A manual browser click-through is NOT an equivalent alternative to this
script for storage-only validation — do not substitute one for the other.**
Only this script can send the trusted `X-Specbook-Storage-Smoke: 1` marker
header; a browser session, `curl`, or any REST client driven by hand has no
way to attach it. Without that header, the four-condition suppression gate
in `app/api/bids/[id]/specbook/upload/route.ts` cannot engage, so the
request falls through to this app's normal (real-AI) upload behavior —
which, while the Anthropic 401 stands (§6), means a real, credentialed
attempt to reach Anthropic still fires in the background (and would fire
successfully, reaching a real provider call, once the 401 is resolved). A
by-hand pass through §2.1 therefore proves nothing about storage-only
suppression and risks the exact provider-call exposure storage-only mode
exists to avoid. If storage-only validation is what you need, use this
script — do not attempt to reproduce it manually.

Using this helper is optional in the sense that the procedure in §2–§7 is
complete and followable by hand with `curl`/a REST client without it **for
real-AI mode** (by-hand execution is in fact REQUIRED there, since this
script cannot perform that mode at all). For **storage-only** validation
specifically, this script is not merely convenient — it is the only way to
produce a valid storage-only result, per the previous paragraph.

---

## Canonical references

- `app/api/bids/[id]/specbook/upload/route.ts`,
  `split/route.ts`,
  `sections/[sectionId]/pdf/route.ts`,
  `[uploadId]/route.ts`,
  `gaps/route.ts`,
  `analyze/route.ts`,
  `analyze/complete/route.ts` — the routes this runbook validates or
  documents for context.
- `lib/storage/blobStore.ts` — `BlobStore`/`LocalBlobStore` interface and
  key-safety rules (`assertSafeKey`) underlying §8 and §2.6.
- `lib/auth.ts`, `lib/auth-helpers.ts`, `proxy.ts` — the Auth Wall
  middleware underlying §7's auth-posture checks.
- `lib/env.ts` — the Zod-validated `APP_ENV` schema; condition (d) of the
  storage-only suppression gate described above depends on this being a
  genuine, boot-time-only, deployment-controlled signal (see that file's own
  module comment and `runtime/runbooks/app-env-rollout.md`).
- `docs/architecture/STORAGE.md` — `plan-room/` key layout referenced in
  §2 and §8.
- `runtime/env/staging.env.example` — env var names referenced in §1 and
  §7 check #2.
- `runtime/runbooks/staging-bootstrap.md`,
  `runtime/runbooks/staging-first-activation.md` — staging tier identity
  (Compose project, storage bind, `APP_ENV` fence) this runbook assumes.
- `runtime/runbooks/staging-backup-restore.md` §6 — the no-secret-logging
  discipline §3 of this document follows.
- `governance/CONFIDENTIAL_DATA_POLICY.md` — fail-closed default for
  unclassified/confidential data referenced in §3 and §5.
- `scripts/validate-staging.mjs` — existing general staging health
  validator (app/sidecar health, migrations, Prometheus/Loki, AuditEvent,
  RunnerLease); this runbook is Spec-Book-specific and does not replace it.
