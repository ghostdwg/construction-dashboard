import { z } from 'zod'

// ── Canonical environment schema ────────────────────────────────────────────
//
// APP_ENV is the first-class tier discriminator (Phase R5). It is REQUIRED;
// missing or invalid values fail startup at import time via Zod parse below.
//
// Tier-to-DB / tier-to-auth fences are documented in
// runtime/env/README.md and Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md
// §6. The production-DB fence and the non-local AUTH_DISABLED rejection
// below are that hardening step — ported from the production branch
// (feat/storage-auth-job-dedupe, commit 9be8c5d) and re-keyed from that
// branch's NODE_ENV discriminator onto this repo's APP_ENV discriminator,
// which stays the sole tier source of truth (see proxy.ts's X-App-Env header
// and the Spec Book storage-smoke gate's env.APP_ENV === "staging" check).
//
// Strictness note: the upstream production commit also RELAXED AUTH_SECRET's
// unconditional min(32) and ANTHROPIC_API_KEY's unconditional sk-ant- prefix
// into conditional rules (strict in production only, permissive elsewhere).
// That relaxation is deliberately NOT ported here — this schema already
// required strict values in every tier before this port, and loosening that
// is a separate dev-ergonomics decision, out of scope for a stabilization
// pass whose job is to close gaps, not open new ones. Only the two genuinely
// new safeguards (production-DB fence, non-local AUTH_DISABLED rejection)
// are added below.
//
// See runtime/runbooks/app-env-rollout.md for the rollout sequencing required
// before this code reaches a tier that doesn't yet have APP_ENV in its env file.
// Operator MUST set APP_ENV in live env files BEFORE deploying this code; the
// reverse order will brick startup.
//
// ────────────────────────────────────────────────────────────────────────────

// Hostname fragment that uniquely identifies the production Turso database.
// Update this if the production tenant slug changes. Ported verbatim (as
// versioned source, not a live env value) from production's PROD_DB_PATTERN.
const PROD_DB_PATTERN = /groundworx-prod-ghostdwg/

const schema = z.object({
  APP_ENV:             z.enum(['local', 'staging', 'production']),
  DATABASE_URL:        z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().default(''),
  AUTH_DISABLED:       z.string().default('false'),
  AUTH_SECRET:         z.string().min(32),
  ANTHROPIC_API_KEY:   z.string().startsWith('sk-ant-'),
  SIDECAR_API_KEY:     z.string().default(''),
  NEXTAUTH_URL:        z.string().url().default('http://localhost:3000'),
  ALLOW_PROD_DB:       z.string().default(''),
}).superRefine((env, ctx) => {
  const isProd = env.APP_ENV === 'production'

  if (env.APP_ENV !== 'local' && !env.SIDECAR_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SIDECAR_API_KEY'],
      message: 'SIDECAR_API_KEY is required outside local development',
    })
  }

  // AUTH_DISABLED is a solo-dev escape hatch only (see proxy.ts's solo-dev
  // bypass). Refuse to start in every shared tier — if it ever ends up set there it
  // is almost certainly an accident, and every request would receive fake
  // admin access.
  if (env.APP_ENV !== 'local' && env.AUTH_DISABLED === 'true') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AUTH_DISABLED'],
      message: 'AUTH_DISABLED=true is permitted only when APP_ENV=local',
    })
  }

  // Production-DB fence. Refuse to start when DATABASE_URL points at the
  // production Turso database from a non-production tier. The intent is to
  // keep a laptop or staging checkout with a stale prod env file from
  // quietly writing into prod. Two escape hatches:
  //   * APP_ENV=production — you have deliberately declared this process to
  //     be the production app
  //   * ALLOW_PROD_DB=1     — you understand the risk and want through anyway
  if (
    PROD_DB_PATTERN.test(env.DATABASE_URL) &&
    !isProd &&
    env.ALLOW_PROD_DB !== '1'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message:
        'Refusing to start: DATABASE_URL points at the production Turso database ' +
        'but APP_ENV is not "production". Set ALLOW_PROD_DB=1 to override ' +
        '(you almost certainly should not).',
    })
  }
})

export const env = schema.parse(process.env)
export type AppEnv = z.infer<typeof schema>['APP_ENV']

// AUTH_DISABLED is a solo-dev escape hatch (see proxy.ts's bypass branch).
// The superRefine above refuses shared tiers; make the explicit local bypass
// loudly visible as well.
if (env.AUTH_DISABLED === 'true') {
  console.warn(
    `[env] AUTH_DISABLED=true — authentication is bypassed (APP_ENV=${env.APP_ENV}). ` +
    'This must never be set outside local development.'
  )
}
