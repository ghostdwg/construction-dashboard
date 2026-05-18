// ──────────────────────────────────────────────────────────────────────────────
//  app/components/EnvironmentBanner.tsx
//  Visible tier indicator. Phase R5 of
//  Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md.
//
//  Renders a small operator-facing badge at the very top of every page. Reads
//  the canonical APP_ENV value from lib/env.ts (Zod-validated). Production
//  renders nothing — the absence of the banner combined with the X-App-Env
//  response header and the URL bar identifies prod.
//
//  Server component — runs on every render, no client JS shipped.
// ──────────────────────────────────────────────────────────────────────────────

import { env } from '@/lib/env'

interface TierStyle {
  bg: string
  text: string
  label: string
  height: number
}

const TIER_STYLES = {
  local: {
    bg: '#5b6471',       // subtle gray — solo-dev signal without distracting
    text: '#ffffff',
    label: 'LOCAL DEVELOPMENT',
    height: 18,
  },
  staging: {
    bg: '#f59e0b',       // visible orange — operator should not miss
    text: '#1a1a1a',
    label: 'STAGING',
    height: 22,
  },
  production: null,      // no banner in production
} as const satisfies Record<typeof env.APP_ENV, TierStyle | null>

export function EnvironmentBanner() {
  const style = TIER_STYLES[env.APP_ENV]
  if (!style) return null

  return (
    <div
      role="status"
      aria-label={`Environment: ${style.label}`}
      style={{
        backgroundColor: style.bg,
        color: style.text,
        textAlign: 'center',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        lineHeight: `${style.height}px`,
        height: `${style.height}px`,
        flexShrink: 0,
        fontFamily: 'var(--font-ibm-plex-mono), ui-monospace, monospace',
        userSelect: 'none',
      }}
    >
      {style.label}
    </div>
  )
}
