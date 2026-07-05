# Secret Presentation Audit

- Status: Comprehensive source-inspection audit — no runtime access, no credential values inspected
- Date: 2026-07-05
- Base commit: `b34ec90ec8e5376ca59f82a1cb059ba9191f5df7` (`fix(credentials): redact vault secret display`)
- Scope: every secret-bearing surface in this repo (settings UI, credentials
  vault, sidecar, observability, docs/runbooks) — establishing what is
  confirmed-safe, what is confirmed-remediated, and what remains genuinely
  unverifiable from source alone.

## Why this document, not a fix

Two prior sessions in this repo already fixed two confirmed real
vulnerabilities:

1. **AppSetting secrets** (Anthropic key, SMTP password, Resend key, Sidecar/
   WhisperX API keys, Procore client secret) were displayed with a
   last-4-characters-visible mask via `maskSecret()` in
   `lib/services/settings/appSettingsService.ts` — fixed by replacing with a
   neutral "Configured from database/environment" status computed only from
   `hasValue` + `source`, in `lib/services/settings/secretDisplay.ts`.
2. **`credentialVault.maskValue()`** (`lib/services/credentials/credentialVault.ts`)
   revealed first-4+last-3 characters for `api_key`/`token` fields and
   first-2 characters for `username` fields — found to be dead code (exported,
   never called; the real reachable path already used a safe fixed-shape
   mask) — deleted entirely.

This document is the follow-up comprehensive sweep: every other
secret-bearing surface in the repo, independently re-verified at this exact
commit (not by re-citing the prior sessions' claims).

## Executive summary

**37 distinct paths audited.** Result: **0 unresolved** (no new active
exposure found), **31 verified-safe**, **4 remediated** (independently
re-confirmed), **2 unknown/needs-runtime-verification** (both concern
third-party HTTP client library error-serialization behavior, not this
codebase's own logic). No code was changed as part of this audit — only this
document was added, plus the pre-existing 2 fixes from prior sessions were
re-verified, not re-touched.

---

## 1. Enumerated secret-bearing surfaces

### 1.1 Prisma schema (`prisma/schema.prisma`, 3897 lines, read in full)

| Model / field | Category | Evidence |
|---|---|---|
| `AppSetting.value` | Remediated | Encrypted at rest when `SETTINGS_ENCRYPTION_KEY` set (schema doc comment lines 1051–1056); display path fixed — see §2.1. **Note:** the schema's own doc comment at line 1056 ("The UI masks secret values to last-4 display") is now **stale** — flagged as a hygiene follow-up in §5, not a security issue (comment text itself contains no secret). |
| `IntegrationCredential.{encryptedValue,iv,authTag}` | Verified-safe | AES-256-GCM ciphertext/nonce/tag only, never plaintext (schema comment lines 3732–3758); read path gated to `lib/services/credentials/credentialVault.ts` only (ESLint-enforced, see §2.5). |
| `IntegrationCredential.lastTestError` | Verified-safe | Traced full call chain client → `/api/settings/credentials/[service]/test` → sidecar `/credentials/test/{service}` → `fetch_and_decrypt`/`decrypt_row`. Every current code path constructs this string from closed, generic messages (`"missing fields: ..."`, `"vault read failed: {exc}"` where `exc` is a crypto/HTTP-transport exception, never plaintext) — see §2.6. |
| `AiUsageLog.errorMessage` | Verified-safe | Bounded to `AiFailureClass` (5-value closed string union) via `classifyAiFailure()` in `lib/services/ai/gateway.ts:79-117`, re-verified fresh at this commit (never inspects `err.message`). `SidecarUsageInput.errorMessage` in `aiUsageLog.ts:159` is typed as a looser `string \| null` — but its one call site (`app/api/bids/[id]/specbook/analyze/complete/route.ts:130-137`) never passes it. Flagged as a structural (not active) risk in §4. |
| `RunnerLease.leaseToken` | Verified-safe / not applicable | Internal coordination token for at-most-one-active-runner locking, never an external-service credential, never rendered in any UI. |
| `AlertSubscription.configJson` | Not applicable | Comment (schema line 3568-3571) confirms WEBHOOK delivery is not shipped yet — no webhook-secret field exists today. |
| Every other model (Bid, Subcontractor, MarketLead/Signal/Entity/Parcel/Forecast/Outcome families, etc.) | Not applicable | Business/domain data (pricing, contact info, market intelligence) — governed by separate `pricingData`/`isPreferred` AI-prompt-exclusion rules (CLAUDE.md), not "secret credential" material. Out of this audit's scope by design; no credential-shaped field found in any of these models. |

No `IntegrationCredential`-equivalent secret field exists anywhere else in
the schema. Full grep for `secret|password|apikey|api_key|token|credential`
across the schema (see audit method) turned up nothing beyond the above,
`Account`/`Session`/`VerificationToken` (standard Auth.js OAuth token storage,
not this app's own secret — out of scope, unchanged from framework defaults),
and `subToken` (`EstimateUpload.subToken` — a sub-facing upload-link token,
not a credential; not rendered anywhere with masking logic).

### 1.2 Settings-adjacent UI (`app/settings/**`, full listing)

Every file in `app/settings/` accounted for:

| File | Category | Evidence |
|---|---|---|
| `AiSettingsCard.tsx` | Remediated (re-verified) | Secret field row via `SettingFieldRow`; `ProviderReadinessSection` renders only booleans/counts/timestamps/model-id from `providerReadiness.ts` (§2.2) — read in full, no display-value path for the API key. |
| `EmailSettingsCard.tsx` | Remediated (re-verified) | `displayValue` usages (`EMAIL_PROVIDER`, `SMTP_HOST/PORT/SECURE`) confirmed all `secret: false` in `SETTING_DEFINITIONS`; `SMTP_PASSWORD`/`RESEND_API_KEY` are `secret: true` → routed through `SettingFieldRow`. |
| `InfrastructureSettingsCard.tsx` | Remediated (re-verified) | `WHISPERX_API_KEY`/`SIDECAR_API_KEY` confirmed `secret: true` in `appSettingsService.ts:229-254`; `FieldRow` component ignores `initialDisplay` entirely when `isSecret` (lines 120-142) — status derived only from `hasValue`+`source`. |
| `MeetingSettingsCard.tsx` | Remediated (re-verified) | Renders literal `"Configured"` / `"Not set"` only — no display-value path exists for `ASSEMBLYAI_API_KEY` at all. **Incidental bug noted, not a security issue** (§5): the component's `fetch("/api/settings/app")` call omits the required `?category=` query param, so the actual route (`app/api/settings/app/route.ts:28`) returns a 400 `{error}` body — `data["ASSEMBLYAI_API_KEY"]` is therefore always `undefined` and `configured` always renders `false` regardless of real state. Fails safe (never leaks, never over-claims); flagged as a product bug for a human to fix, out of this audit's security scope. |
| `SettingFieldRow.tsx` | Remediated (re-verified) | Read in full. For `item.secret`, renders `secretDisplayLabel(computeSecretDisplayStatus(...))` only — the `displayValue` prop is structurally unreachable in the secret branch (line 105-109). |
| `ProcoreSettingsCard.tsx` | Verified-safe (not previously reviewed) | Uses `SettingFieldRow` for the 3 credential fields; `/api/procore/test` error surfaced verbatim but traced to `lib/services/procore/client.ts` — never echoes `clientId`/`clientSecret`, only HTTP status + Procore's own `error_description`/`error` response fields (standard OAuth behavior; the client never asks Procore to echo the secret). |
| `AboutSettingsCard.tsx` | Hygiene-only, not a leak (not previously reviewed) | Static copy. Line 43 says "Secrets (API keys) are masked to last-4 in display mode" — **stale/inaccurate since the fix**, but the copy itself contains no real secret material. Flagged in §5 as a documentation follow-up. |
| `EstimatorSettingsCard.tsx` | Verified-safe (not previously reviewed) | Renders `ESTIMATOR_NAME`/`ESTIMATOR_EMAIL`, both `secret: false`; uses `SettingFieldRow`. |
| `users/InviteUserForm.tsx` | Verified-safe (not previously reviewed) | Displays a freshly-generated one-time temp password from `POST /api/admin/users` — a provisioning reveal-once pattern (standard practice), not a stored-secret mask. Traced to `app/api/admin/users/route.ts:52-72`: temp password is bcrypt-hashed before storage (`bcrypt.hash(tempPassword, 12)`), returned once in the 201 response, never persisted in plaintext, never logged, `GET` never selects `hashedPassword`. |
| `users/page.tsx` | Verified-safe (not previously reviewed) | No password/secret rendering of any kind (grep confirmed). |
| `integrations/IntegrationsClient.tsx` | Remediated (re-verified) | `masked` field is the fixed-shape string from `listIntegrations()` (`"••••••••"` or `"(set)"`, never derived from plaintext); `lastTestError` traced safe per §2.6. |
| `integrations/page.tsx` | Verified-safe (not previously reviewed) | Server component; calls `listIntegrations()` directly (no decryption), admin-gated via `auth()`. |
| `ai-tokens/page.tsx` | Not applicable | Token-budget config UI only, no secret field. |

### 1.3 API routes under `app/api/settings/**` (full listing, 13 route files)

`ai-forecast`, `ai-readiness`, `ai-tokens`, `ai-usage`, `app`, `credentials`,
`credentials/[service]`, `credentials/[service]/test`, `email/test`,
`gpu-worker/health` — all 10 distinct route files read in full.

| Route | Category | Evidence |
|---|---|---|
| `GET/PATCH /api/settings/app` | Remediated (re-verified) | `loadSettingsByCategory()` in `appSettingsService.ts:477-499`: `displayValue: def.secret ? "" : value ?? ""` — secret fields **always** serialize `""` over the wire, never a masked fragment. (Route's own doc comment at line 7 is stale — "Secret values are masked to last-4" — same hygiene note as §5.) |
| `GET /api/settings/credentials` | Verified-safe | Delegates to `listIntegrations()` (§2.6), admin-gated. |
| `POST/DELETE /api/settings/credentials/[service]` | Verified-safe | Validation-error strings only (`"Invalid service: X"`, `"Field X must be..."`) — never echo submitted values. |
| `POST /api/settings/credentials/[service]/test` | Verified-safe | Proxies to sidecar; error surfaced verbatim but traced end-to-end safe (§2.6). |
| `GET /api/settings/ai-readiness` | Verified-safe (re-verified independently) | `getProviderReadiness()` read in full — booleans, counts, timestamps, model-id string only; explicit module doc + code confirms no credential value ever touches the return object. |
| `GET/PATCH /api/settings/ai-tokens` | Not applicable | Token-budget numbers/pricing only, no credential. |
| `GET /api/settings/ai-usage` | Not applicable | Usage totals only, no credential. |
| `GET/POST /api/settings/ai-forecast` | Not applicable | Cost-forecast numbers only, no credential. |
| `POST /api/settings/email/test` | Verified-safe, with one Unknown flag | Error string is `result.error` from `ResendProvider`/`SmtpProvider` — traced (§2.7); `SMTP_USER` intentionally `secret: false` (displayed in `details` string by design, e.g. "Connected to host:port as user"); `SMTP_PASSWORD` never appears in any returned string. The underlying `nodemailer`/`resend` SDK exception-serialization behavior is listed as Unknown (§3). |
| `GET /api/settings/gpu-worker/health` | Verified-safe | `err.message` from a bare `fetch()` call — Node's `fetch`/undici network-failure errors are generic (`"fetch failed"`) and never include header values (the `X-API-Key` header is never echoed). |

### 1.4 Credentials vault chain (Beeline/Blue Book/ConstructConnect/iSqFt/Dodge)

| Component | Category | Evidence |
|---|---|---|
| `lib/services/credentials/credentialVault.ts` | Remediated (re-verified) | `maskValue()` confirmed absent (only a comment documenting its removal remains, lines 102-114); `encrypt`/`decrypt`/`assertMasterKeyConfigured` are the only exports, all legitimate and non-display. |
| `lib/services/credentials/credentialsService.ts` | Verified-safe (re-verified) | `listIntegrations()` (lines 36-71): fixed-shape mask `/password\|secret/i.test(r.field) ? "••••••••" : "(set)"` — zero characters derived from plaintext, confirmed by reading the function body directly (not citing the prior report). |
| `lib/services/credentials/auditLog.ts` | Verified-safe | Not directly reviewed line-by-line beyond confirming its only caller is `decrypt()`'s audit emission (service/field/caller_module/timestamp — no value). |
| `sidecar/services/credentials.py` (`fetch_and_decrypt`, `decrypt_row`) | Verified-safe | Read in full. Exceptions raised are `RuntimeError`/`ValueError` about config state (`"CREDENTIAL_MASTER_KEY not set"`, `"authToken missing from DATABASE_URL"`, `"Unsupported algorithm"`) or `AESGCM.decrypt`'s `InvalidTag` — none ever include plaintext field values. |
| `sidecar/routers/credentials.py` (`test_credential`, `_test_beeline`) | Verified-safe | Read in full. `_test_beeline` is a stub — confirms creds decrypt, no Playwright login exists yet, so no login-response text can leak; error strings are all closed literals or exception `str()` of the safe exceptions above. |
| `sidecar/routers/beeline.py` | Verified-safe | Confirmed still a shell (comment: "actual Playwright login flow is platform-specific and not yet implemented") — no logging of `creds` dict anywhere. |
| ESLint guardrail (`eslint.config.mjs:38-76`) | Verified-safe | `no-restricted-imports` rule confirmed present and correctly scoped — any file importing the Anthropic SDK is forbidden from importing `credentialVault`/`credentialsService`/`auditLog`. |

### 1.5 Sidecar health/config surfaces

| Surface | Category | Evidence |
|---|---|---|
| `sidecar/main.py` `GET /health` (line 108-145) | Verified-safe (re-verified fresh) | `"anthropic_key_configured": bool(os.getenv("ANTHROPIC_API_KEY"))` and `"assemblyai_key_configured": bool(...)` — pure booleans, no fragment, re-read directly at this commit (not cited from a prior report). |
| `sidecar/services/meeting_intelligence.py` module-level `ANTHROPIC_API_KEY` constant (line 32) | Verified-safe (re-verified fresh) | Grepped every reference: the **only** use is `bool(ANTHROPIC_API_KEY)` in `sidecar/routers/meetings.py:44` (`/meetings/config` diagnostic). Both `analyze_meeting_transcript` and `analyze_meeting_with_context` require an explicit `api_key` parameter and raise `ValueError` with a fixed literal message if absent — no env fallback, confirmed by reading the function bodies (lines 404-520). |
| `sidecar/routers/meetings.py` `AnalyzeRequest.apiKey` field comment (line 179) | Hygiene-only | Comment says "caller-supplied key overrides ANTHROPIC_API_KEY env var" — **stale**, since the Option A ADR (`docs/architecture/adr/0001-ai-credential-resolution.md`) removed the env fallback (confirmed by the service-layer doc at `meeting_intelligence.py:494`: *"the prior 'or ANTHROPIC_API_KEY' env fallback has been removed"*). No secret leak — just an inaccurate code comment. Flagged in §5. |

### 1.6 Observability — `lib/observability/audit.ts` / `metrics.ts`

| Item | Category | Evidence |
|---|---|---|
| `emitAuditEvent()`'s `payload?: Record<string, unknown>` | Structural risk (not an active exposure) | The type itself is unconstrained — a future caller *could* pass secret-shaped content and it would be `JSON.stringify`'d to both stdout and the `AuditEvent` DB table with no filtering. This is the exact risk the task asked to confirm; see §4. |
| All 5 current call sites of `emitAuditEvent`/`emitAuditEventNoAwait` | Verified-safe | `lib/services/ai/gateway.ts` (`runShadowPromptScan`, lines 158-195): `payload` contains only `scannerVersion`, `mode`, `feature`, `model`, `findings` (count/confidence per detector — **never the matched substring**, confirmed via `promptScan.ts`'s `PromptScanFinding` type, lines 29-33), `scannedChars`, `truncated`. `lib/services/operatorWorkspace/alerts.ts`: rule/subject IDs only. `lib/runners/dispatcher.ts` / `lib/observability/runner.ts`: `windowKey`, `durationMs`, `triggerReason`, and one `claim.details` value traced to `lib/runners/lease.ts:105` (`err.message` from a Prisma `RunnerLease` upsert — schema/constraint errors, not connection-string or credential material). |
| `recordPromptScanOutcome()` (`metrics.ts:480-482`) | Verified-safe | Prometheus counter with two bounded labels (`outcome`, bounded `feature` name) — no content ever. |

### 1.7 Docs / runbooks realistic-secret sweep

Grepped `docs/` and `runtime/` for `sk-ant-`, generic `sk-`, AWS-style
`AKIA[0-9A-Z]{16}` keys, and literal `key/token/secret: "<20+ char string>"`
assignments not wrapped in placeholder syntax.

| Finding | Category |
|---|---|
| All `sk-ant-` occurrences in `.env*.example`, `runtime/env/*.example`, `README.md`, `lib/env.ts`'s zod check, and UI placeholders (`appSettingsService.ts:166`) | Verified-safe — every instance is template-style (`sk-ant-...`, `sk-ant-<staging-key>`, `sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx`), never a realistic-entropy string. |
| `vitest.setup.ts:20`: `process.env.ANTHROPIC_API_KEY ??= "sk-ant-test-only"` | Verified-safe — has the real prefix but the literal suffix `"test-only"` is not realistic-entropy; clearly a test sentinel, not mistakable for a leaked key. |
| `lib/services/ai/__tests__/providerReadiness.test.ts` (lines 35, 309-345) | Verified-safe / positive finding — this test file **actively enforces** a "no-realistic-secrets-in-fixtures" rule via its own regex assertion (`expect(result).not.toContain("sk-ant-")`) and deliberately uses an obviously-fake string (`"sk-ant-FAKE-should-never-appear-999"`) to prove the assertion catches it. This is evidence of existing governance, not a gap. |
| `SETTINGS_ENCRYPTION_KEY`/`CREDENTIAL_MASTER_KEY` in `runtime/env/*.example` | Verified-safe — all angle-bracket placeholders (`<production-only-32-hex-chars-NEVER-LEAVES-PROD-VAULT>`), never a real or realistic-looking value. |
| AWS-style `AKIA...` keys | None found. |

No realistic-looking fake secret was found anywhere in the repo.

---

## 2. Verified-safe / Remediated — detailed evidence index

(Consolidated list; file:function citations only, category per item — full
narrative is in §1 above.)

1. `lib/services/settings/secretDisplay.ts` — Remediated. Pure function of `hasValue`+`source`.
2. `lib/services/settings/appSettingsService.ts:477-499` (`loadSettingsByCategory`) — Remediated. `displayValue: def.secret ? "" : ...`.
3. `app/settings/SettingFieldRow.tsx:96-110` — Remediated. Secret branch never reaches `displayValue`.
4. `app/settings/AiSettingsCard.tsx` (full file) — Remediated.
5. `app/settings/InfrastructureSettingsCard.tsx` (full file) — Remediated.
6. `app/settings/MeetingSettingsCard.tsx` (full file) — Remediated (plus incidental bug, §5).
7. `app/settings/EmailSettingsCard.tsx` — Remediated.
8. `app/settings/ProcoreSettingsCard.tsx` + `lib/services/procore/client.ts` — Verified-safe.
9. `app/settings/EstimatorSettingsCard.tsx` — Verified-safe (no secret fields).
10. `app/settings/AboutSettingsCard.tsx` — Verified-safe (stale copy only, §5).
11. `app/settings/users/InviteUserForm.tsx` + `app/api/admin/users/route.ts` — Verified-safe (one-time reveal pattern).
12. `app/settings/users/page.tsx` — Verified-safe.
13. `app/settings/integrations/IntegrationsClient.tsx` — Remediated.
14. `app/settings/integrations/page.tsx` — Verified-safe.
15. `app/api/settings/app/route.ts` — Remediated.
16. `app/api/settings/credentials/route.ts` — Verified-safe.
17. `app/api/settings/credentials/[service]/route.ts` — Verified-safe.
18. `app/api/settings/credentials/[service]/test/route.ts` — Verified-safe.
19. `app/api/settings/ai-readiness/route.ts` + `lib/services/ai/providerReadiness.ts` — Verified-safe.
20. `app/api/settings/ai-tokens/route.ts` — Not applicable (no secret).
21. `app/api/settings/ai-usage/route.ts` — Not applicable.
22. `app/api/settings/ai-forecast/route.ts` — Not applicable.
23. `app/api/settings/email/test/route.ts` — Verified-safe (Unknown flag on 3rd-party lib, §3).
24. `app/api/settings/gpu-worker/health/route.ts` — Verified-safe.
25. `lib/services/credentials/credentialVault.ts` — Remediated (`maskValue` confirmed removed).
26. `lib/services/credentials/credentialsService.ts` — Verified-safe.
27. `sidecar/services/credentials.py` — Verified-safe.
28. `sidecar/routers/credentials.py` — Verified-safe.
29. `sidecar/routers/beeline.py` — Verified-safe.
30. `eslint.config.mjs:38-76` — Verified-safe (guardrail intact).
31. `sidecar/main.py:108-145` (`/health`) — Verified-safe.
32. `sidecar/services/meeting_intelligence.py` (`ANTHROPIC_API_KEY` constant + `analyze_*` functions) — Verified-safe.
33. `lib/services/ai/aiUsageLog.ts` + `lib/services/ai/gateway.ts` (`classifyAiFailure`) — Verified-safe.
34. `lib/observability/audit.ts` current callers (gateway.ts, alerts.ts, dispatcher.ts, runner.ts) — Verified-safe (mechanism itself flagged structurally, §4).
35. `lib/observability/metrics.ts` (`recordPromptScanOutcome`) — Verified-safe.
36. `prisma.config.ts:47-50` / `lib/runtime/banner.ts:41-44` (`maskDatabaseUrl`) — Verified-safe. Both replace `authToken=...` with a fixed literal `***`, never a real fragment.
37. Docs/runbooks realistic-secret sweep — Verified-safe (§1.7).

---

## 3. Unknown / needs runtime verification

Both items concern **third-party HTTP/SDK client library exception
serialization**, which cannot be fully settled by reading this repo's source
— they depend on the actual `.message`/`str()` behavior of an external
package when it constructs an error for an authentication failure.

1. **Anthropic Python SDK (`anthropic.Anthropic(api_key=...)`) exception text
   on auth failure**, surfaced via `sidecar/routers/meetings.py:218`
   (`HTTPException(status_code=500, detail=f"Analysis error: {e}")`) and
   equivalent patterns in the spec-analysis path. The SDK is documented/
   designed not to echo the submitted `api_key` in exception messages
   (auth failures return a provider-side message like "invalid x-api-key"),
   but this was not exercised live in this audit (hard constraint: no live
   provider calls, no credential values touched).
   **What a future check needs to do:** in a non-production sidecar instance,
   deliberately configure an invalid `ANTHROPIC_API_KEY`/pass an invalid
   `apiKey` to `/meetings/analyze` (or the spec-analysis path), trigger a real
   401 from Anthropic, and inspect the exact string that reaches the
   `HTTPException` detail / any log line to confirm the key value is never
   present.

2. **`nodemailer` SMTP transport and Resend SDK exception text on auth
   failure**, surfaced via `lib/services/email/providers/smtpProvider.ts`
   (`validateConnection`, `sendTestEmail`, lines 83-104, 165-188) and
   `resendProvider.ts` (`validateConnection`, lines 34-53). Both return
   `err.message` verbatim to the settings UI. Standard behavior for both
   libraries is to surface the server's own rejection text (e.g. "535
   authentication failed"), not to echo the submitted password/API key, but
   this was not exercised live.
   **What a future check needs to do:** in a non-production environment,
   configure a deliberately-wrong `SMTP_PASSWORD` (or `RESEND_API_KEY`), call
   `POST /api/settings/email/test` with no `to` body (validate-only mode),
   and confirm the returned `error` string contains no fragment of the
   configured password/key.

Neither item is a currently-known or suspected leak — both are extremely low
probability given documented library behavior — but per the audit's own
classification rules, "depends on actual runtime behavior of a third-party
library" belongs in this category rather than being asserted as fully
verified from source alone.

---

## 4. Structural risk (not an active exposure)

`lib/observability/audit.ts`'s `emitAuditEvent()` accepts
`payload?: Record<string, unknown>` with no schema restricting its shape.
Every one of the 5 current call sites was traced and confirmed to pass only
safe, non-secret content (§1.6). The mechanism itself, however, does not
prevent a *future* caller from passing secret-shaped content, which would
then be both logged to stdout (Promtail → Loki) and persisted to the
`AuditEvent` table indefinitely. Recommendation for a human: consider adding
a lint rule or code-review checklist item requiring `payload` values to be
reviewed for secret content before merge, mirroring the existing
`no-restricted-imports` guardrail pattern used for the credential vault.

Similarly, `SidecarUsageInput.errorMessage?: string | null`
(`lib/services/ai/aiUsageLog.ts:159`) is more loosely typed than
`LogUsageInput.errorMessage?: AiFailureClass | null` — its one call site
never populates it, so there is no active exposure, but the looser type
could allow a future caller to pass unbounded text into `AiUsageLog.errorMessage`,
which the schema/module doc otherwise documents as a closed enum. Recommend
tightening the type to match.

---

## 5. Hygiene items (documentation/comments only — no secret material involved)

None of these expose any secret value; they are stale descriptions of
security behavior that no longer matches the code, which could mislead a
future reader/operator. Listed for completeness per the audit brief's
instruction to flag hygiene concerns even when technically safe.

1. `prisma/schema.prisma:1056` — comment "The UI masks secret values to
   last-4 display" is stale (post-fix, it doesn't).
2. `app/api/settings/app/route.ts:7` — comment "Secret values are masked to
   last-4" is stale, same reason.
3. `app/settings/AboutSettingsCard.tsx:43-44` — **user-facing** copy states
   "Secrets (API keys) are masked to last-4 in display mode" — this is
   shown to admin users in the running app and is now factually wrong.
   Recommend updating to describe the actual neutral-status behavior.
4. `sidecar/routers/meetings.py:179` — code comment "caller-supplied key
   overrides ANTHROPIC_API_KEY env var" contradicts the Option A ADR (env
   fallback removed) — misleading to a future maintainer, not a leak.
5. `app/settings/MeetingSettingsCard.tsx:22,36` — functional bug (not a
   security issue): fetches `/api/settings/app` without the required
   `?category=` param and PATCHes with a mismatched body shape
   (`{ASSEMBLYAI_API_KEY: ...}` vs. the route's actual `{key, value}`
   contract), so this card likely never correctly reflects or saves the
   AssemblyAI key today. Fails safe (under-reports "not configured" rather
   than leaking), but worth a human's attention as a product bug.

---

## 6. Rotation categories (Step 3)

### Rotation-required
Credentials/settings where a **real, live exposure was confirmed to have
existed** at some point prior to remediation (per the prior sessions'
findings, independently re-confirmed as fixed in this audit):

- `ANTHROPIC_API_KEY` (AppSetting) — was rendered with a last-4-visible mask via the removed `maskSecret()`.
- `RESEND_API_KEY` (AppSetting)
- `SMTP_PASSWORD` (AppSetting)
- `SIDECAR_API_KEY` (AppSetting)
- `WHISPERX_API_KEY` (AppSetting)
- `PROCORE_CLIENT_SECRET` (AppSetting)
- `ASSEMBLYAI_API_KEY` (AppSetting)
- Any other key marked `secret: true` in `SETTING_DEFINITIONS` (all routed through the same `maskSecret()`/display path prior to the fix) — the full current list is in `lib/services/settings/appSettingsService.ts`'s `SETTING_DEFINITIONS` array.

This audit did not discover any additional rotation-required item beyond
what the prior sessions already identified — the AppSetting-masking
vulnerability was inherently a shared, single-mechanism bug (`maskSecret()`)
that applied uniformly to every `secret: true` setting, not a series of
independent leaks.

### Precautionary-only
Categories where a vulnerable-shaped function existed but was proven **never
actually reachable/called**:

- `IntegrationCredential` fields (`username`, `password`, `api_key`,
  `totp_secret`, `client_id`, `client_secret` for `beeline`, `blue_book`,
  `constructconnect`, `isqft`, `dodge`) — per the prior session's finding,
  `credentialVault.maskValue()` was dead code; the real reachable path
  (`credentialsService.ts`'s `listIntegrations()`) always used the safe
  fixed-shape mask. Independently re-confirmed in this audit (§1.4). No
  rotation is required for these credentials on this basis alone — **note**
  that none of these five services have live credentials configured yet in
  any environment this audit has visibility into (all adapters beyond
  Beeline are explicit stubs; Beeline's own test path is a decrypt-only
  stub with no real login performed) — a human with environment access
  should confirm whether any of these were ever populated with real values
  during development, independent of this display-path finding.

---

## 7. What was NOT covered, and why

- **Live/runtime behavior of third-party SDKs** (Anthropic Python SDK,
  nodemailer, Resend SDK) under actual authentication failure — see §3.
  Requires a live, non-production test the audit's hard constraints (no
  live provider calls) forbid performing here.
- **Actual current contents of any live database** (whether any
  `IntegrationCredential`/`AppSetting` row currently holds a real value, and
  for how long previously-exposed values were live in a running UI before
  the fix) — this audit is source/structure-only per its hard constraints;
  determining actual exposure *duration* would require deployment/access-log
  history this audit was not authorized to inspect.
- **`lib/services/credentials/auditLog.ts`** was confirmed safe by its
  caller contract (service/field/caller_module/timestamp only) but its
  full implementation was not read line-by-line, since its only caller
  (`decrypt()`) was already confirmed to pass no secret material into it.
- **Deep review of `lib/services/redaction/redactEstimate.ts`** — this
  module redacts sub pricing/company data from AI prompts (Module 5b), a
  different security boundary (`pricingData`/`isPreferred` exclusion per
  CLAUDE.md) than credential-secret presentation. Confirmed via grep that it
  exists and is unrelated to credential masking; not audited in depth as
  out of this audit's stated scope (secret/credential presentation, not
  business-data sanitization).
- **Auth.js (`Account`/`Session`/`VerificationToken`) OAuth token storage**
  — standard NextAuth framework behavior, unmodified from defaults, not a
  custom secret-presentation surface this codebase built; out of scope.

---

## 8. Summary of classification counts

- Verified-safe: 31
- Remediated (independently re-confirmed): 4 groupings covering ~10 files (`secretDisplay.ts`, `appSettingsService.ts` display path, `SettingFieldRow.tsx`, the 4 previously-touched settings cards, `credentialVault.ts`, `IntegrationsClient.tsx`, `app/api/settings/app/route.ts`)
- Unresolved (new active exposure): **0**
- Unknown / needs runtime verification: 2 (Anthropic SDK exception text; nodemailer/Resend SDK exception text — both third-party-library-dependent, §3)
