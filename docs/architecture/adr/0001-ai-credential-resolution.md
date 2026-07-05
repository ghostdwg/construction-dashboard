# ADR 0001: AI Provider Credential Resolution Across the TS App and Python Sidecar

- Status: Accepted
- Date: 2026-07-04
- Work package: N3 (Credential Architecture ADR)
- Scope: how `ANTHROPIC_API_KEY` (and the same class of AI-provider credential) is
  resolved and, where necessary, transported between `lib/services/ai/gateway.ts`
  and `sidecar/services/ai_gateway.py`, and between those and their callers. This
  ADR is written **before** any credential-unification code is implemented; it
  contains no code changes.

## 1. Context

### 1.1 The two sanctioned gateways do not resolve credentials themselves

Both sanctioned provider-construction sites are deliberately "transparent
relays" and take the credential as a plain parameter rather than resolving it:

- `lib/services/ai/gateway.ts` — `createMessage(req)` requires `req.apiKey:
  string` ("API key, resolved by the caller (env or app settings) exactly as
  before", line 37) and builds `new Anthropic({ apiKey: req.apiKey })` only
  when no test `client` is injected (line 142).
- `sidecar/services/ai_gateway.py` — `create_message(..., api_key:
  Optional[str] = None, client: Any = None)` calls `build_client(api_key)`
  only when `client is None` (lines 32–44, 61–62).

Neither gateway does DB lookups, env reads, or caching. Credential resolution
is entirely the caller's responsibility, and today callers do it in at least
four different, inconsistent ways.

### 1.2 The TS side already has a DB-first/env-fallback resolver — but only on the TS side

`lib/services/settings/appSettingsService.ts` (module SET1, GWX-004) is a
generic settings resolver: `getSetting(key)` returns the DB row if present
(decrypted via `lib/services/settings/crypto.ts`, AES-256-GCM keyed by
`SETTINGS_ENCRYPTION_KEY`), otherwise falls back to the env var named in
`SETTING_DEFINITIONS` (`getSetting`, lines 354–365; `ANTHROPIC_API_KEY` entry,
lines 159–167). Writes go through `setSetting()`, which encrypts and clears an
in-process cache (`clearAppSettingsCache`, lines 405–442). `getSettingSource()`
(lines 388–397) already exposes, without ever returning the value itself,
whether the effective value came from `"db" | "env" | "missing"`.

Every TS route that calls the AI gateway directly resolves through this path
today: `generateBidIntelligenceBrief.ts:228`, and the
`gap-analysis/generate`, `leveling/.../question`, `intelligence/generate`,
`addendums/.../delta`, and `meetings/[meetingId]/analyze` routes all call
`getSetting("ANTHROPIC_API_KEY")` before calling into the gateway or the
sidecar.

**The Python sidecar has no equivalent.** There is no ORM, no SQLite/libsql
client, and no `AppSetting`-reading code anywhere under `sidecar/` for AI
credentials. Every sidecar module that needs `ANTHROPIC_API_KEY` reads it with
a bare `os.getenv("ANTHROPIC_API_KEY")` (`schedule_intelligence.py:292`,
`spec_intelligence.py:411,513`, `ai_extractor.py:120`,
`submittal_intelligence.py:74`, `market.py:32-33`) or
`os.environ.get("ANTHROPIC_API_KEY", "")` (`drawing_intelligence.py:193`). None
of these six sites can see a DB-configured key set via the Settings UI — they
only ever see whatever is in the sidecar process's own environment.

### 1.3 One real precedent for crossing the boundary already exists

`sidecar/services/meeting_intelligence.py`'s
`analyze_meeting_with_context(..., api_key: Optional[str] = None)` computes
`effective_key = api_key or ANTHROPIC_API_KEY` (lines 460, 479) — an explicit,
documented seam: "`api_key`: caller-supplied key takes precedence over
`ANTHROPIC_API_KEY` env var, allowing the Next.js route to pass the key stored
in app settings" (lines 473–474). This is wired end-to-end today:
`app/api/bids/[id]/meetings/[meetingId]/analyze/route.ts` calls
`getSetting("ANTHROPIC_API_KEY")` (line 57) and forwards it as `apiKey` in the
JSON body (line 110) of its POST to the sidecar's `/meetings/analyze`, which
reads it as `api_key` (`sidecar/routers/meetings.py:201`). This is the only
place in the codebase where a DB-resolved AI credential actually reaches the
sidecar. It coexists with a redundant sidecar-side env fallback (see §3,
Option C).

### 1.4 A genuine "independent sidecar-side DB resolution" mechanism already exists — for a different credential class

`sidecar/services/credentials.py` decrypts `IntegrationCredential` rows
(scraper-site logins for Beeline/Blue Book/ConstructConnect/iSqFt/Dodge) by
calling the Turso HTTP pipeline API directly (`fetch_and_decrypt`, lines
88–156) and decrypting with `CREDENTIAL_MASTER_KEY` (a **different** key from
`SETTINGS_ENCRYPTION_KEY`) via `AESGCM` (lines 35–50, 69–85). Every decrypt
call is audit-logged to `/storage/audit/credentials-access.jsonl`
(`_audit`, lines 53–66), mirrored by the TS-side `credentialVault.ts` /
`auditLog.ts` audit trail described in `docs/architecture/CREDENTIALS.md`.

This proves independent, DB-first, sidecar-side credential resolution **is
buildable** in this codebase (the network/decryption plumbing exists) — it is
simply not wired to `ANTHROPIC_API_KEY` today, and `docs/architecture/
CREDENTIALS.md` §"Three layers of AI isolation" states this vault was
deliberately built so that "AI/prompt-building code is structurally prevented
from reading credentials" (an ESLint rule bans `lib/services/jobs/**`,
`lib/services/spec/**`, `lib/services/briefing/**`, `lib/services/drawing/**`,
`lib/services/submittal/**`, `lib/services/meeting*/**` from importing the
vault). That isolation principle was designed for scraper-login credentials,
which never need to reach AI-calling code at all. `ANTHROPIC_API_KEY` is the
opposite case — by definition it must reach the code that calls the AI
provider — so this particular ESLint-enforced boundary does not (and cannot)
apply to it, and importing that isolation model wholesale for the AI key would
require re-deriving an equivalent boundary from scratch. This is discussed in
§4.7.

### 1.5 Governance constraints already in force

- `governance/guardrails/allowlist.json` names `gateway.ts` and `ai_gateway.py`
  as the only sanctioned provider-construction sites, and lists exactly three
  pre-existing, temporary, tracked exceptions this ADR must address:
  `lib/services/submittal/organizeWithAi.ts`, `sidecar/services/
  drawing_intelligence.py`, `sidecar/services/meeting_intelligence.py`
  (entries 7–9).
- `governance/CONFIDENTIAL_DATA_POLICY.md` §3/§5: "Pricing/credentials never
  enter any prompt" and all AI calls must route through the one TS + one
  Python gateway. Nothing in this ADR proposes putting a credential value
  inside prompt/message content in any option — the key is transport-layer
  auth material, not prompt content, under every option compared below.

### 1.6 The three named legacy bypasses, characterized

| Site | Current resolution | Reaches gateway? | Reaches `getSetting`/DB? |
|---|---|---|---|
| `lib/services/submittal/organizeWithAi.ts:396` | `process.env.ANTHROPIC_API_KEY` direct, own `new Anthropic()` | No | No |
| `sidecar/services/drawing_intelligence.py:193` | `os.environ.get("ANTHROPIC_API_KEY", "")` direct, own `anthropic.Anthropic()` | No | No |
| `sidecar/services/meeting_intelligence.py:460-497` | `api_key` param (from TS `getSetting`) OR env fallback, own `anthropic.Anthropic()` | No (own client, not `ai_gateway.build_client`) | Partially — only when caller supplies `api_key` |

(Additional non-named sites discovered while reading — noted for completeness,
not itemized further here: `schedule_intelligence.py`, `spec_intelligence.py`,
`ai_extractor.py`, `submittal_intelligence.py`, and `sidecar/routers/
market.py` are all env-var-only with no DB path and no per-request override
parameter at all.)

### 1.7 A structural fact that simplifies this decision

There is no scheduler, cron, or background-task loop inside the sidecar
(`grep` for `APScheduler`/`schedule.every`/`cron`/`@repeat_every` under
`sidecar/` returns nothing). Every sidecar router endpoint that can call an AI
provider is invoked over HTTP, and in every case observed, the initiating
caller is the Next.js app (a user-facing route or a TS-side automation
service such as `lib/services/jobs/briefRefreshAutomation.ts`). The sidecar
never needs to originate an AI call with no TS request in the loop. This
matters directly for the "sidecar availability" criterion in §4.

## 2. Decision drivers

1. Eliminate the drift described in §1.2 — six sidecar sites cannot see a
   DB-configured key at all today.
2. Keep the credential out of prompt content (already satisfied by all
   options; not a discriminator).
3. Keep the blast radius of a misconfiguration or bug small and legible.
4. Preserve testability without real credentials (already partly true via
   existing client-injection seams in both gateways).
5. Resolve the three (plus discovered) legacy bypasses onto whichever pattern
   is chosen, so `allowlist.json` entries can eventually be removed.

## 3. Options considered

**A — TS resolves, passes per-request to the sidecar.** TS calls
`getSetting("ANTHROPIC_API_KEY")` (DB-first, env-fallback, already built) and
forwards the resolved value as a field in the JSON body of its call to the
sidecar, which uses only what it is given. This is the *existing* pattern for
`meetings/analyze` (minus its residual env fallback).

**B — Sidecar independently resolves.** Sidecar reads an encrypted DB row
first (reusing/extending the `sidecar/services/credentials.py` Turso-HTTP
pattern, generalized to `AppSetting`-shaped rows), falling back to its own env
var. The credential never crosses the TS→sidecar boundary. Both processes
resolve independently.

**C — Hybrid: per-request handoff as primary, sidecar env fallback for
resilience.** This is what `meeting_intelligence.py` already does today
(`effective_key = api_key or ANTHROPIC_API_KEY`): prefer the caller-supplied
value, but tolerate a caller that omits it by quietly substituting the
sidecar's own env var.

No fourth option is grounded in the source — there is no comment, TODO, or
partially-built "shared resolution service"/token-exchange endpoint anywhere
in the codebase gesturing at anything beyond A/B/C.

## 4. Comparison

### 4.1 Direct-env bypasses — effect of each option

- **`organizeWithAi.ts`** — under **A**: swap `process.env.ANTHROPIC_API_KEY`
  for `await getSetting("ANTHROPIC_API_KEY")` and route the call through
  `gateway.ts`'s `createMessage()`; pure TS-local refactor, no cross-process
  change, lowest risk of the three sites. Under **B**: no change needed here
  (already TS-side; B only concerns the sidecar's own resolution) — but B
  does nothing to fix this bypass either, since it isn't about the
  sidecar. Under **C**: same as A for this site (C only differs on the
  sidecar side).
- **`drawing_intelligence.py`** — currently has *no* per-request key
  parameter at all, unlike `meeting_intelligence.py`. Under **A**: needs the
  same param threading `meeting_intelligence.py` already has (`api_key`
  passed through to `ai_gateway.build_client(api_key)` instead of a direct
  `anthropic.Anthropic()` call), and its originating TS drawing-analyze route
  must resolve via `getSetting()` and forward it — mirroring the
  `meetings/analyze` route exactly. `allowlist.json` already flags this file
  as "highest-priority gateway + sanitization target," so this credential fix
  should be bundled with its already-planned gateway migration, not done
  twice. Under **B**: this file would instead call a new sidecar-side
  resolver directly; still needs to stop constructing its own client and
  route through `ai_gateway.build_client`.
- **`meeting_intelligence.py`** — already implements the Option-A/C shape.
  Under **A** (the recommendation, §5): remove the `or ANTHROPIC_API_KEY`
  fallback once every calling route reliably supplies `api_key`, so a missing
  key fails loudly instead of silently substituting a possibly different
  value. Under **B**: replace the `api_key` parameter with an internal DB
  lookup, discarding the one boundary-crossing precedent that already works.

### 4.2 DB-first vs env-fallback behavior

TS already has this exactly (`getSetting`, §1.2). Sidecar has *no* DB path
today for AI credentials at all — six sites are 100% env-only, one site
(`meeting_intelligence.py`) is param-or-env. Under **A**, DB-first/env-fallback
semantics are computed exactly once, in `appSettingsService.ts`, and every
consumer (TS or sidecar) simply receives the already-resolved effective value
— one implementation of the DB/env precedence rule, one place it can have a
bug. Under **B**, the precedence rule would need to be re-implemented on the
sidecar side (reusing `credentials.py`'s Turso-HTTP-fetch shape generalized to
`AppSetting` rows), giving two independent implementations of the same
precedence logic that must be kept behaviorally identical — the existing
divergence between the TS and Python resolvers (see §1.2) is itself evidence
that two independent implementations already drift apart when only one of
them is built. Under **C**, both rules exist simultaneously and can disagree
(TS's `getSetting()` returns the DB value; sidecar's local env fallback wins
only when the caller *forgets* to pass one, which is precisely the failure
mode a caller bug would produce silently).

### 4.3 Rotation behavior

- **A**: `setSetting()` calls `clearAppSettingsCache()` (line 441), and
  `getSetting()`'s cache reload check (`if (existing) return existing`, line
  305/306) means the *next* call in that same process re-reads the DB. Since
  the credential is fetched fresh per request and forwarded, the sidecar sees
  a rotated key on its very next call too — no sidecar restart, redeploy, or
  separate cache-invalidation channel required. The one caveat, inferable
  from the code and not from any runtime inspection: the cache is pinned to
  `globalThis` per Next.js process (`appSettingsService.ts:292-302`), so if
  the app runs as more than one process/instance, only the instance that
  handled the settings-UI write clears its own cache; other instances keep
  serving their last-loaded value until *they* independently clear/reload —
  this is a real potential lag window in a multi-instance deployment, though
  nothing in the source here confirms or rules out that topology.
- **B**: if implemented uncached (as `credentials.py`'s `fetch_and_decrypt`
  already is — no caching, a fresh Turso HTTP call every time), rotation lag
  could actually be *lower* than A's per-process cache. But the six sidecar
  sites that are env-only *today* have effectively infinite rotation lag —
  they need a process restart with a new env value, full stop — and that gap
  exists regardless of which option is chosen going forward, since it is a
  property of the current code, not of A vs B.
- **C**: identical to A whenever the caller supplies `api_key`; identical to
  the "restart required" env case whenever it silently falls through to the
  sidecar's own env var — meaning the *same rotation* can behave two
  different ways from one call to the next depending on whether the caller
  remembered to pass the key, which is a worse property than either A or B
  alone (unpredictable rather than uniformly one or the other).

### 4.4 Blast radius / failure modes

- **A**: failure is contained per-request and fails **before** any sidecar
  work starts. `generateBidIntelligenceBrief.ts:228-231` and the
  `meetings/analyze` route both already do "resolve, then explicit null
  check with a clear user-facing error" before ever calling the sidecar. One
  failed resolution affects one request.
- **B**: a bug in the sidecar-side resolver (bad master key, unreachable
  Turso endpoint, schema mismatch) would affect **every** sidecar AI feature
  simultaneously — spec analysis, schedule generation, drawing intelligence,
  submittal organization, market intelligence all currently read the env var
  independently today, so today's failure domain is already "one broken env
  var, isolated per site"; consolidating them behind one shared sidecar
  resolver **improves** consistency but also **concentrates** the failure
  domain into a single shared code path — a bug there breaks all of them at
  once rather than one at a time.
- **C**: strictly worse than A or B alone on this axis — a bug can manifest
  as "wrong key used" rather than "no key available," which is silent instead
  of loud, and silent wrong-credential use is a worse failure mode than a
  clear configuration error.

### 4.5 Sidecar availability

Per §1.7, no sidecar endpoint is ever invoked without a preceding TS request
in the loop, so "the sidecar is down" is not actually a distinct credential-
resolution failure mode under **A**: resolution completes in TS before the
network call to the sidecar is even attempted, and `app/api/settings/
credentials/[service]/test/route.ts:46-50`'s existing `fetch` try/catch
pattern (returning a clear "Sidecar unreachable" error) is the template for
handling that unrelated failure. Under **B**, "sidecar down" is likewise moot
for the same reason, but B introduces a *different* new dependency: every
sidecar-initiated AI call would newly depend on the sidecar's own network
reachability to Turso (the same DB the TS app already depends on, per
`DATABASE_URL`) — a dependency edge that does not exist today for the six
env-only sites, which need nothing but a locally-set env var.

### 4.6 Observability without secret leakage

`gateway.ts` already has a working, non-blocking audit pattern to extend: the
P2-A0 shadow prompt-scan (`runShadowPromptScan`, lines 89–137) calls
`emitAuditEventNoAwait` with a structured payload (`scannerVersion`, `mode`,
`feature`, `model`, `findings`, never the prompt's raw secret-bearing fields).
The same shape can carry a **credential-resolution** audit event — `source:
"db" | "env" | "missing"` (already computed today by `getSettingSource()`,
never the key value) plus `feature`/`correlationId` — emitted from **one**
place. Under **A**, that one place is naturally the TS resolution call site
(or the gateway entry point itself, since every real call passes through it),
so a single instrumentation point covers every feature. Under **B**, the
sidecar would need this instrumentation independently added to its own new
resolver, and the existing TS-side `emitAuditEventNoAwait`/audit-event
infrastructure has no sidecar-side equivalent for *this* event category today
(the sidecar's only existing audit sink, `credentials.py`'s
`/storage/audit/credentials-access.jsonl`, is scoped to the
`IntegrationCredential` vault, not `AppSetting`/`ANTHROPIC_API_KEY`) — so B
requires building a second, parallel audit-emission path rather than reusing
the one that already exists.

### 4.7 Testability

Both gateways already support DI of a fake client with no real credentials
needed: `gateway.test.ts:46` injects `{ client: { messages: { create } } }`;
Python's `create_message(..., client: Any = None)` takes the same shape. That
part is unaffected by this decision. What differs is testing the
*resolution* step itself: under **A**, `getSetting()` is a single in-process
async function backed by Prisma — trivial to mock in a TS unit test (as
existing route tests already do implicitly by mocking the settings/DB
layer), and Python-side tests need no credential-resolution mock at all,
since the sidecar only ever receives an already-resolved string parameter.
Under **B**, sidecar tests would need a new fake for the DB-resolution path
(`credentials.py`'s own tests already show the shape of what that harness
looks like — mocking the Turso HTTP pipeline response), which is strictly
more test surface than A requires for the same coverage.

### 4.8 Confidentiality boundaries

All three options equally satisfy the narrow rule "credentials never enter
any prompt" (§1.5) — none of them proposes putting the key inside message
content. The broader question is how many processes can ever hold the
plaintext key. Today, only `lib/services/settings/crypto.ts` (Next.js
process) can decrypt `ANTHROPIC_API_KEY`. Under **A**, that stays true: the
sidecar receives a plaintext value per request but never decrypts anything
itself and never persists it — it is a stateless recipient, and the value
travels only across the already-authenticated TS→sidecar channel (the
existing `X-API-Key: SIDECAR_API_KEY` header pattern, e.g.
`test/route.ts:37`), not a new exposure. Under **B**, the sidecar would need
its own decryption capability against `AppSetting`-shaped rows — widening the
set of processes that can decrypt this specific credential from one to two.
`docs/architecture/CREDENTIALS.md`'s explicit design philosophy for the
sibling `IntegrationCredential` vault is to *minimize* where decryption can
happen ("Decryption is gated behind a single audited code path on each side"
— note: "each side," i.e., one per process, but still two processes total,
and only because that vault's whole purpose is a sidecar-only Playwright
login flow). Extending sidecar-side decryption specifically to the AI-calling
code path runs against that same minimization principle for a credential
that, unlike scraper logins, has no PII/login-flow reason to be decrypted
sidecar-side at all — TS already has everything it needs to resolve it. A
keeps one locus of decrypt-and-hold; B would create a second one for no
functional benefit.

### 4.9 Real-vs-stub proof

`gateway.ts:142`'s `req.client ?? new Anthropic({ apiKey: req.apiKey })` (and
the Python equivalent, `ai_gateway.py:61-62`) is already the exact boolean
signal needed: "a real client was constructed" precisely when no test double
was injected. Under **A**, extending the existing audit-emission call in
`runShadowPromptScan`-adjacent code (or a sibling event) to record `real_call:
boolean` (client param absent) + `key_source: "db" | "env"` gives one
centralized, auditable "this was a genuine Anthropic call, using a
DB-configured key" signal, because every real call — TS or sidecar — passes
through one of the two gateways where this signal is already computable
today. Under **B**, the sidecar's independent resolution happens in a
different code path than where the "real vs. stub" client signal already
lives (`ai_gateway.py`), so proving "real call + DB-sourced key" would require
correlating two separate log emissions (one from the new sidecar resolver,
one from the gateway) rather than one.

## 5. Decision

**Adopt Option A: the TS app resolves the AI-provider credential exactly
once, via the existing `getSetting()` DB-first/env-fallback resolver, and
forwards the resolved value per request to the sidecar. The sidecar never
resolves this credential independently.** Concretely:

1. **`appSettingsService.getSetting("ANTHROPIC_API_KEY")` remains the single
   resolution point.** No new resolver is introduced on either side.
2. **Every sidecar function that needs the key gains (or keeps) an explicit
   `api_key` parameter**, following the shape `meeting_intelligence.py`
   already established, and calls `ai_gateway.build_client(api_key)` rather
   than constructing its own `anthropic.Anthropic(...)`.
3. **The sidecar-side "or fall back to my own env var" behavior in
   `meeting_intelligence.py` (`effective_key = api_key or ANTHROPIC_API_KEY`)
   is deprecated**, not kept as a permanent hybrid (rejecting Option C as
   analyzed in §4.3/§4.4: it produces a call-to-call-unpredictable failure
   mode). A bare `ANTHROPIC_API_KEY` env var may remain readable in the
   sidecar's local `.env` purely as a **local-development bootstrap
   convenience** (matching how the rest of this codebase treats env files
   per-process), but production/deployed code paths should not silently
   depend on it once the TS caller reliably supplies the key.
4. **All three named legacy bypasses migrate onto this pattern** (§4.1):
   `organizeWithAi.ts` switches to `getSetting()` + `gateway.ts`;
   `drawing_intelligence.py` gains an `api_key` parameter and routes through
   `ai_gateway.build_client`, fed by its originating TS route exactly as
   `meetings/analyze` already does; `meeting_intelligence.py` sheds its env
   fallback per point 3. Each migration removes that entry from
   `governance/guardrails/allowlist.json` once complete — this ADR does not
   perform those migrations itself.
5. **Observability**: extend the existing `emitAuditEventNoAwait`-based audit
   pattern already wired into `gateway.ts` (§4.6/§4.9) with a credential-
   resolution event (`source: db|env|missing`, `real_call: boolean`, feature,
   correlationId) emitted once per real call, never the key value.

**Rationale, tied to the criteria above:** Option A requires zero new
infrastructure (the resolver, the audit-emission pattern, and one working
end-to-end precedent already exist); it keeps the failure domain per-request
instead of concentrating it in a new shared sidecar resolver (§4.4); it
requires no new cross-process dependency for the sidecar (§4.5); it reuses
rather than duplicates the observability and testability seams that already
exist on the TS side (§4.6/§4.7); and it keeps the number of processes able
to decrypt this credential at one, consistent with this repo's stated
minimize-decryption-loci philosophy (§4.8). Option B's one genuine advantage —
potentially lower rotation lag if built uncached — does not outweigh the cost
of standing up and maintaining a second, independent resolver-and-audit
implementation for no sidecar-availability benefit (§1.7 established the
sidecar never needs to resolve this credential without a TS request already
in the loop). Option C is rejected outright because it is strictly worse than
either pure option on the blast-radius and rotation-predictability criteria
(§4.3, §4.4) despite already being partially implemented.

**What would change this decision:** if a sidecar endpoint were ever invoked
without an originating Next.js request (e.g. a future internal
scheduler/cron added directly to the sidecar, contradicting §1.7's current
finding), Option A would no longer be sufficient for that endpoint and Option
B (or a narrow, explicitly-scoped hybrid limited to that one endpoint) would
need to be reconsidered for it specifically. Confirming whether the Next.js
app runs as a single process or multiple replicas in any deployed environment
would sharpen the rotation-lag claim in §4.3, but does not change the
recommendation itself.

## 6. Consequences

- No new encryption key, DB table, or Python DB client is introduced.
- The three allow-listed legacy bypasses have a concrete, uniform target
  shape to migrate to (§4.1, §5.4); this ADR authorizes that migration but
  does not perform it.
- The sidecar's remaining bare `os.getenv("ANTHROPIC_API_KEY")` reads in
  `schedule_intelligence.py`, `spec_intelligence.py`, `ai_extractor.py`,
  `submittal_intelligence.py`, and `market.py` are, by the same reasoning,
  future migration targets under this same decision, even though they were
  not in the WP's named list of three — flagged here for a coordinator's
  awareness, not scoped into this ADR's required migrations.
- `meeting_intelligence.py`'s env fallback removal is a small behavior change
  (a caller bug that used to silently succeed with a possibly-wrong key will
  now fail loudly) and should be sequenced deliberately, not bundled silently
  into an unrelated change.
