# Rule: Secrets & AI Providers

Binding for any task that touches credentials, env files, `lib/services/ai/`,
`sidecar/`, or anything that could reach a paid provider.

- **Never read, print, echo, or commit secret values** — no `cat .env*`, no
  `printenv`/`env` dumps, no credential values in logs, tests, docs, commits,
  or chat. Key *names* are fine; values never. Credential handling of any kind
  is human-owned (Ledger §6).
- **Option A is settled** (Ledger §4.3): TypeScript resolves the key via
  `getSetting()` and forwards per-request; the sidecar never resolves its own
  key. Do not reintroduce env-key reads or module singletons.
- **Two gateways only** (Ledger §4.4): all provider construction lives in
  `lib/services/ai/gateway.ts` and `sidecar/services/ai_gateway.py`. The CI
  guardrail (`detect-ai-providers`, enforce mode) is the fence; its allowlist
  accepts NO new entries.
- **Real provider calls cost money and are gated:** exactly one controlled call
  has ever been approved (proof: `LAST_REAL_SUCCESS`). Any further real call
  requires an approved queue card (GWX-Q16 ladder) and per-invocation human
  approval. Local work uses stub modes (`*_STUB_MODE`) — which write honest
  `status:"stub"` AiUsageLog rows, never fake `ok`.
- **P2-A0 prompt scanning is shadow-only telemetry.** Never describe it as
  redaction, blocking, enforcement, or protection; never claim confidential
  data "cannot reach the provider" (Ledger §5).
- **Sub confidentiality:** `pricingData`/`rawPriceText`, sub names, companies,
  and `isPreferred` never enter prompts, client responses, or sub-facing
  exports.
- **Rotation status is UNKNOWN** for RESEND/WHISPERX/SIDECAR_API_KEY/
  WORKER_TOKEN — do not claim "all secrets rotated" (GWX-Q17 closes this).
