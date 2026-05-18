// ──────────────────────────────────────────────────────────────────────────────
//  lib/runtime/banner.ts
//  Server-side startup banner. Phase R5 of
//  Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md.
//
//  Called once from instrumentation.ts at server boot. Prints a colored
//  ANSI banner so operators can confirm at a glance which tier they just
//  started.
//
//  The banner is the server-side equivalent of the in-app EnvironmentBanner
//  component. Both read from the same canonical APP_ENV value validated by
//  lib/env.ts. Drift between them is a misconfiguration signal.
// ──────────────────────────────────────────────────────────────────────────────

import type { AppEnv } from '@/lib/env'

interface BannerEnv {
  APP_ENV: AppEnv
  DATABASE_URL: string
  NEXTAUTH_URL: string
}

const ANSI = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
} as const

const BOX_WIDTH = 70

function colorForTier(tier: AppEnv): string {
  switch (tier) {
    case 'production': return ANSI.red
    case 'staging':    return ANSI.yellow
    case 'local':      return ANSI.blue
  }
}

function maskDatabaseUrl(url: string): string {
  if (url.startsWith('file:')) return url
  // Hide authToken in libsql URLs so the banner doesn't leak secrets to logs.
  return url.replace(/(authToken=)[^&]+/i, '$1***')
}

function pad(prefix: string): string {
  const closing = '│'
  const padding = Math.max(1, BOX_WIDTH - prefix.length - closing.length)
  return prefix + ' '.repeat(padding) + closing
}

export function printStartupBanner(env: BannerEnv): void {
  const color = colorForTier(env.APP_ENV)
  const authDisabled = process.env.AUTH_DISABLED === 'true'

  const lines = [
    '┌' + '─'.repeat(BOX_WIDTH - 2) + '┐',
    pad('│  GroundWorX  ·  APP_ENV=' + env.APP_ENV),
    pad('│  DB    : ' + maskDatabaseUrl(env.DATABASE_URL)),
    pad('│  URL   : ' + env.NEXTAUTH_URL),
    pad('│  Auth  : ' + (authDisabled ? 'DISABLED (solo-dev escape hatch)' : 'enabled')),
    pad('│  Boot  : ' + new Date().toISOString()),
    '└' + '─'.repeat(BOX_WIDTH - 2) + '┘',
  ]

  // Print on stderr-style separation: blank line, banner, blank line.
  // (stdout is fine; just visually separated from surrounding logs.)
  console.log('')
  for (const line of lines) {
    console.log(color + ANSI.bold + line + ANSI.reset)
  }
  console.log('')
}
