import { z } from 'zod'

// ── Canonical environment schema ────────────────────────────────────────────
//
// APP_ENV is the first-class tier discriminator (Phase R5). It is REQUIRED;
// missing or invalid values fail startup at import time via Zod parse below.
//
// Tier-to-DB / tier-to-auth fences are documented in
// runtime/env/README.md and Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md
// §6, but are NOT yet enforced here — that's a future hardening step.
//
// See runtime/runbooks/app-env-rollout.md for the rollout sequencing required
// before this code reaches a tier that doesn't yet have APP_ENV in its env file.
// Operator MUST set APP_ENV in live env files BEFORE deploying this code; the
// reverse order will brick startup.
//
// ────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  APP_ENV:             z.enum(['local', 'staging', 'production']),
  DATABASE_URL:        z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().default(''),
  AUTH_SECRET:         z.string().min(32),
  ANTHROPIC_API_KEY:   z.string().startsWith('sk-ant-'),
  NEXTAUTH_URL:        z.string().url().default('http://localhost:3000'),
})

export const env = schema.parse(process.env)
export type AppEnv = z.infer<typeof schema>['APP_ENV']
