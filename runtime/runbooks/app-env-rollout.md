# APP_ENV Rollout Runbook

How to deploy the Phase R5 `APP_ENV` enforcement code without bricking production startup. **Read this fully before deploying R5.**

---

## 1. Why ordering matters

Phase R5 introduces fail-closed Zod validation in `lib/env.ts`. After R5 lands:

- `APP_ENV` becomes a **required** env var (must be `local`, `staging`, or `production`).
- Missing or invalid values cause `lib/env.ts` to throw at the first import.
- The thrown error propagates out of `instrumentation.ts` and Next.js refuses to start serving requests.

This is intentional — wrong-tier writes are now structurally impossible. **But it means the operator must add `APP_ENV` to live env files BEFORE deploying R5 code.**

Wrong order → production app refuses to start.

---

## 2. Canonical rollout order — DO

```text
   1. Operator edits /opt/neuroglitch/.env on superglitch:
        append:    APP_ENV=production

   2. Operator recreates running containers so they re-read the env file:
        docker compose -p neuroglitch up -d --force-recreate app sidecar worker

   3. Operator verifies APP_ENV is loaded in EVERY container:
        docker exec neuroglitch-app     printenv APP_ENV   # → production
        docker exec neuroglitch-sidecar printenv APP_ENV   # → production
        docker exec neuroglitch-worker  printenv APP_ENV   # → production

   4. Operator confirms the app is healthy at the existing version:
        curl -sf https://groundworx.neuroglitch.ai/api/health
        # The current code does not yet require APP_ENV; this is the
        # baseline confirmation BEFORE deploying R5 code.

   5. PR (the R5 PR) is merged to main.

   6. Operator deploys R5 code via the normal flow (currently manual
      compose recreate; eventually deploy-prod.ps1 once Phase R7 lands).
      The app now reads APP_ENV from the env file populated in step 1,
      Zod validation passes, instrumentation banner prints, server starts.

   7. Operator confirms:
        a. Server logs show the startup banner with APP_ENV=production.
        b. curl -sI https://groundworx.neuroglitch.ai/  shows X-App-Env: production
        c. The UI continues to render normally; no visible banner appears
           on the page (production has no UI tier badge by design).
```

Same procedure applies to staging — but step 1 sets `APP_ENV=staging` and step 6 deploys to the staging Compose project.

---

## 3. Reverse order — DO NOT

```text
   1. R5 PR merged to main.
   2. Operator deploys R5 code (without step "add APP_ENV to env file" first).
   3. App container restarts; lib/env.ts imports during boot.
   4. Zod parse refuses: "APP_ENV is required".
   5. instrumentation.ts prints the diagnostic and re-throws.
   6. Next.js exits non-zero.
   7. Docker restart policy (unless-stopped) kicks in, container exits again.
   8. Production effectively down until APP_ENV is added.
```

**Recovery from this state:**

1. Add `APP_ENV=production` to `/opt/neuroglitch/.env`.
2. `docker compose -p neuroglitch up -d --force-recreate app sidecar worker`.
3. Verify with the steps in §2 step 7.

Recovery is fast (~30 seconds of operator action), but only if the operator has SSH access at the moment of failure. **Pre-deploy preparation is cheaper than mid-incident recovery.**

---

## 4. Rollback if R5 itself causes a problem

If R5 is deployed correctly (operator added APP_ENV first) but the new instrumentation or env validation surfaces an unexpected issue, the rollback procedure is:

```text
   1. Operator rolls back to the pre-R5 image:
        (Phase R8+ once GHCR is live)
          docker compose -p neuroglitch up -d --image <pre-R5-sha> --force-recreate

        (Pre-Phase R8, manual flow)
          ssh superglitch
          cd /opt/neuroglitch/construction-dashboard
          git checkout <pre-R5-sha>
          docker compose build app sidecar worker
          docker compose -p neuroglitch up -d --force-recreate app sidecar worker

   2. APP_ENV in /opt/neuroglitch/.env can REMAIN. The pre-R5 code does
      not read it; presence is harmless. Do not remove it.

   3. Verify health:
        curl -sf https://groundworx.neuroglitch.ai/api/health
        curl -sI https://groundworx.neuroglitch.ai/   # X-App-Env header absent on pre-R5
```

**Rollback does NOT require removing APP_ENV from the env file.** Adding it is forward-compatible. Removing it after a rollback would only complicate re-rollout later.

---

## 5. Verification checklist (post-rollout)

After step 6 of §2 completes, the operator confirms ALL of the following:

| # | Check | Expected |
|---|---|---|
| 1 | Server startup logs (container) | Colored ANSI box with `GroundWorX · APP_ENV=production` |
| 2 | Server startup logs (no validation error) | No "STARTUP FAILED" line; Next.js reports "ready" |
| 3 | Public health probe | `curl https://groundworx.neuroglitch.ai/api/health` → HTTP 200 |
| 4 | Response header presence | `curl -sI https://groundworx.neuroglitch.ai/` → `X-App-Env: production` |
| 5 | UI tier banner | No banner visible on production pages (intentional) |
| 6 | Smoke flow | Operator logs in, lists bids, opens one bid. No regressions. |

For staging, the symmetric checks plus:

- UI tier banner: **orange "STAGING" bar visible** at top of every page.
- `X-App-Env: staging` in response headers.

For local dev:

- UI tier banner: **gray "LOCAL DEVELOPMENT" bar visible** at top of every page.
- `X-App-Env: local` in response headers (when accessing via http://localhost:3000).
- `npm run dev:all` boot logs show the ANSI banner.

---

## 6. Symmetric rollout for staging (Phase R6 prerequisite)

When Phase R6 activates staging, the same ordering applies:

1. Operator populates `/opt/neuroglitch/.env.staging` with the full staging env, **including `APP_ENV=staging`** (using `runtime/env/staging.env.example` as the shape reference).
2. Operator brings up the staging Compose project for the first time.
3. The staging app reads APP_ENV from the env file; Zod parse passes; startup succeeds.

If `APP_ENV=staging` is missing from `.env.staging`, staging will refuse to start on first deploy. Same recovery procedure as §3 — add the var, recreate.

---

## 7. Local-dev rollout for the developer

On laptop, each developer adds `APP_ENV=local` to `construction-dashboard/.env.local` (their personal env file, gitignored). The R5 PR adds `APP_ENV=local` to `runtime/env/local.env.example` so developers copying the template get it by default.

Developers with existing `.env.local` files predating R5 must add the line manually:

```text
APP_ENV=local
```

If they don't, `npm run dev:all` refuses to start with the same Zod error as production would.

---

## 8. CI considerations

The R5 PR also updates:

- `.github/workflows/ci.yml` build step: adds `APP_ENV: "local"`.
- `.github/workflows/deploy.yml` build step: adds `APP_ENV: "local"`.
- `Dockerfile`: adds `ENV APP_ENV="local"` to the build stage.

CI builds now provide `APP_ENV` so `next build` doesn't fail Zod validation when bundling modules that transitively import `lib/env.ts`. The build-time value is `local` for all CI tiers; the real runtime value is injected by the deploy env file.

---

## 9. What changes for the existing `AUTH_DISABLED` escape hatch

`AUTH_DISABLED=true` continues to work in `local` tier (it was never tier-gated in code). Phase R5 does NOT yet add a fence rejecting `AUTH_DISABLED=true` outside `local` — that's a future hardening item per `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` §6e.

For now: the rollout document for R5 simply notes that production env files should never contain `AUTH_DISABLED=true` (operator hygiene, not yet enforced).

---

## 10. Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §5 (APP_ENV semantics) and §7 R5 (this phase).
- `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` §6 — the broader fence design that R5 implements step 1 of.
- `runtime/env/README.md` — per-tier env requirements.
- `runtime/env/{local,staging,production}.env.example` — templates that include `APP_ENV` for each tier.
- `lib/env.ts` — the Zod schema.
- `lib/runtime/banner.ts` — the startup banner.
- `instrumentation.ts` — the boot hook.
- `app/components/EnvironmentBanner.tsx` — the UI tier indicator.
- `next.config.ts` `headers()` — the `X-App-Env` response header.
