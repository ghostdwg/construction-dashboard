# GroundWorX Confidential-Data & AI-Routing Policy (repository copy)

Concise, enforceable summary of the approved policy (full spec: Governance G2).
This document is **normative** for code in this repository. Nothing here changes
runtime behavior on its own — it is enforced incrementally by the guardrails in
`governance/guardrails/` and, later, by the AI gateway (P1+).

## 1. Processing loci

- **LOCAL** — compute on the same physical host that holds the data; content
  never leaves that host.
- **PRIVATE MESH** — compute on a *different* endpoint reached only over our
  Tailscale WireGuard mesh, where **both** endpoints are hardware we control
  (e.g. the sanctioned local-AI host "TheBeast", RTX 4070 Ti, running WhisperX
  and Ollama `qwen2.5:14b`). A Tailscale peer we do **not** own is **not**
  Private Mesh. Private Mesh is **not** the same as same-host LOCAL.
- **SANITIZED CLOUD** — external provider (e.g. Anthropic Claude) receiving
  **only** a minimized/redacted excerpt that passed the sanitization gate **and**
  any required approval.
- **EXTERNAL PROHIBITED** — content that may never leave the environment:
  pricing/bid amounts, credentials/API keys, contract language, and
  contractually-restricted owner data.

## 2. Default rule

**Non-public project data defaults to LOCAL Only.** Unknown/unclassified content
is treated as *Project Confidential* and must not go to an external provider by
default. Raw project data (drawings, specs, contracts, bids, pricing, meeting
audio/transcripts, customer info, DB records, logs, credentials) must not be
sent to any external AI provider unless it has passed a defined sanitization
process and is explicitly classified as Sanitized-Cloud-permitted.

## 3. Classification → routing (summary)

| Classification | Default | Sanitized Cloud | Cloud prohibited? |
|---|---|---|---|
| Public Source | Local/Private-Mesh or cloud, **with provenance** | permitted | no |
| Internal | Local | permitted (sanitized) | no |
| Project Confidential | Local | **explicit per-artifact approval** | via approval only |
| Contractually Restricted | Local/Private-Mesh only | **prohibited** | yes |
| Legal / Financial Restricted | Local/Private-Mesh only | **prohibited** | yes |

Fail-closed: unknown ⇒ Project Confidential ⇒ Local. Pricing/credentials never
enter any prompt.

## 4. Public-source Market Intelligence distinction

Public-source acquisition/analysis (municipal agendas/minutes/permits, public
bid opportunities, press) is a **distinct, permitted** capability. It is **not**
the same as sending confidential project data to cloud AI. Public-source items
must retain **provenance**: source URL/reference + acquisition timestamp +
method + analysis engine. Public-source content must never be co-mingled with
Project-Confidential context in a single prompt.

## 5. Gateway requirement

All future AI/model calls must route through a single **AI gateway** (P1) — one
TypeScript entry point and one Python entry point — so classification, routing,
sanitization, approval, and audit can be enforced in one place. Direct provider
construction outside the gateway is prohibited (guardrail:
`governance/guardrails/detect-ai-providers.mjs`).

## 6. Current temporary exceptions (why they exist)

These exist at base commit `e10b799` and are tracked in
`governance/guardrails/allowlist.json`. They are **temporary** and are removed as
migration proceeds:

- **13 direct Anthropic/AssemblyAI call sites** (6 TS + 7 Py) predate the
  gateway. Allow-listed until P1 routes them through it.
- **Turso/libSQL** remains the currently approved **cloud data-store** exception
  (data-at-rest only; this does **not** authorize sending that data to an
  external AI provider). No migration in this phase; a future Restricted Project
  Storage Tier is designed for contracts requiring non-cloud storage.
- **WhisperX/pyannote on Private Mesh** is the default for transcription/
  diarization. **AssemblyAI is not an automatic fallback**; it may exist later
  only as a named, per-item, explicit break-glass approval.
- **`qwen2.5:14b`** is approved for local first-pass classification, redaction,
  extraction, and preliminary scope/risk — **advisory only**, never final
  authority for technical, contractual, legal, or cost decisions.

## 7. Prohibited unless explicitly approved

- **Fly.io** deployment paths (`runtime/fly/*.toml`) — latent, must not be
  activated (guardrail: `detect-deploy-storage.mjs`).
- **S3 / cloud object storage** (`STORAGE_BACKEND=s3`, `S3BlobStore`, cloud
  storage SDKs) — only `LocalBlobStore` is permitted today.

## 8. Existing mitigations to extend (not replace)

`lib/services/redaction/redactEstimate.ts`, `lib/exports/aiSafeExport.ts`, and
existing prompt guards are reused/extended by the future sanitization gate, not
replaced blindly.
