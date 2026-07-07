# ADR 0003: Document AI Enrichment Is an Admin-Panel Setting, Default OFF

- Status: Accepted — **explicit operator decision (Josh), 2026-07-07**
- Date: 2026-07-07
- Work package: Q03.2b (admin-controlled document automation)
- Scope: how automatic document-event AI enrichment (the fire-and-forget
  `generateBidIntelligence` / `triggerBriefRefresh` calls on spec-book
  upload, drawings upload, and addendum delete) is enabled, disabled, and
  overridden. Manual/explicit Analyze/Generate actions are out of scope and
  unchanged.

## 1. Decision (operator-approved verbatim, 2026-07-07)

This is an actual operator decision, recorded here as the durable approval
artifact — a commit message is not the record of approval.

1. Document AI Enrichment is a **global persisted Admin-panel setting**
   (AppSetting key `documentAutomationEnabled`).
2. Its **initial/default state is OFF** (no row = OFF; only the stored
   literal `"true"` enables).
3. It is **enabled only through the authenticated Admin UI**
   (Settings → AI Configuration → Document AI Enrichment; admin-only
   GET/PATCH `/api/settings/document-automation`; every change audited with
   actor, old/new state, timestamp, global scope).
4. It **takes effect on the next applicable document action** — the gate
   reads the DB per event; no rebuild, no Compose recreate, no restart.
5. **`DOCUMENT_AUTOMATION_HARD_DISABLED=true` is an emergency override that
   always forces it OFF.** Exact-literal semantics: only the string `"true"`
   engages the lock; the lock can only force OFF (it can never enable);
   absent or malformed values neither engage the lock nor change anything
   else. The Admin UI explains when the lock is forcing automation off.
6. **The legacy `DOCUMENT_AUTOMATION_ENABLED` environment variable must not
   enable automation.** It is read nowhere in the codebase.
7. **Storage-smoke suppression remains the highest-priority state**
   (`suppressed_for_storage_smoke` unchanged; the 4-condition gate is
   checked before the Admin setting is consulted).

## 2. Effective-state precedence

storage-smoke suppression → hard-disable lock → persisted Admin setting →
default OFF. Route reporting: `suppressed_for_storage_smoke` |
`hard_disabled` | `disabled` | `triggered` (body `automationStatus` for the
gated uploads; additive `X-Automation-Status` header for the addendum
delete). A settings-lookup failure fails closed: no automation fires and the
event reports `disabled` (the document action itself still succeeds).

## 3. Implementation anchors

- Gate: `lib/services/settings/documentAutomation.ts` (deliberately NOT a
  `SETTING_DEFINITIONS` entry and NOT the cached `getSetting()` path — its
  env-fallback was the side-door this decision removes).
- Admin API: `app/api/settings/document-automation/route.ts` (audited via
  `emitAuditEvent`, category `operator_override`).
- Admin UI: `app/settings/DocumentAutomationCard.tsx` (AI Configuration tab).
- Gated routes: `app/api/bids/[id]/specbook/upload/route.ts`,
  `app/api/bids/[id]/drawings/upload/route.ts`,
  `app/api/bids/[id]/addendums/[addendumId]/route.ts`.

## 4. Claim discipline

Storage-smoke rehearsals prove storage mechanics and suppression only —
never real AI execution. Enabling enrichment for real remains a deliberate
Admin action, and validating real provider output remains a separate,
human-gated activity (GWX-Q16-class), not implied by this setting existing.
