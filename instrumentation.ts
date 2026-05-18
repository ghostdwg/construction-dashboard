// ──────────────────────────────────────────────────────────────────────────────
//  instrumentation.ts — Next.js boot hook
//  Phase R5 of Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md.
//
//  Runs once when the Next.js server starts (both `next dev` and production
//  `next start`). Responsibilities:
//
//    1. Force evaluation of lib/env.ts at the earliest possible moment so
//       Zod env validation fails closed BEFORE any request is served.
//    2. Print a colored ANSI startup banner identifying the active tier.
//
//  If env validation fails, the process logs an operator-friendly diagnostic
//  and re-throws — Next.js refuses to serve requests.
//
//  See lib/env.ts for the schema and runtime/runbooks/app-env-rollout.md
//  for the rollout sequencing that must precede deploying this code.
// ──────────────────────────────────────────────────────────────────────────────

export async function register() {
  // Only run on the Node runtime. The Edge runtime has limited Node APIs
  // and cannot rely on the same env validation surface; it falls back to
  // per-import validation in lib/env.ts.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { env } = await import('@/lib/env')
    const { printStartupBanner } = await import('@/lib/runtime/banner')
    printStartupBanner(env)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('')
    console.error('═══════════════════════════════════════════════════════════════════')
    console.error('  STARTUP FAILED — environment validation refused')
    console.error('═══════════════════════════════════════════════════════════════════')
    console.error('')
    console.error(message)
    console.error('')
    console.error('Required env vars (see construction-dashboard/runtime/env/):')
    console.error('  APP_ENV              must be: local | staging | production')
    console.error('  DATABASE_URL         libsql:// or file://')
    console.error('  AUTH_SECRET          min 32 chars')
    console.error('  ANTHROPIC_API_KEY    must start with sk-ant-')
    console.error('')
    console.error('Rollout: runtime/runbooks/app-env-rollout.md')
    console.error('')
    throw err
  }
}
