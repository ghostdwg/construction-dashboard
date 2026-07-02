# P0 Confidential-Data Guardrails (warn mode)

Static, **network-free**, **secret-free** checks that make unsafe future changes
visible *before* the AI gateway (P1) exists. They **do not change runtime
behavior**, do not call any provider, and do not remove any existing code.

## Run

```bash
# warn mode (default): prints findings, always exits 0
./governance/guardrails/run-p0-checks.sh

# enforce mode (later / CI): non-zero exit if any WOULD-BLOCK finding
GUARDRAILS_MODE=enforce ./governance/guardrails/run-p0-checks.sh
```

Only Node (no npm install, no dependencies) and Bash are required.

## What the checks do

| Check | Detects | Legacy handling |
|---|---|---|
| `detect-ai-providers.mjs` | Direct construction/use of external AI clients — `new Anthropic(`, `@anthropic-ai/sdk`, `new OpenAI(`, `openai`, AssemblyAI (`api.assemblyai.com`), and any `.messages.create(` — in TS/JS (`app/`, `lib/`) and Python (`sidecar/`, `gpu-worker/`). | Pre-existing call sites are **allow-listed** in `allowlist.json` by exact path + justification and reported `[OK]`. Anything else is `[WARN]` = WOULD-BLOCK. |
| `detect-deploy-storage.mjs` | Activation of prohibited egress: `fly deploy`, `STORAGE_BACKEND=s3`, `new S3BlobStore(`, or a new cloud-storage SDK (`@aws-sdk/client-s3`, `@google-cloud/storage`, …). | The latent `runtime/fly/*.toml` files and the `STORAGE_BACKEND` selector are documented in `allowlist.json` as **blocked/deprecated** and reported but **not removed** this phase. |

## Modes

- **warn** (default): report everything, exit 0. No CI failure, no behavior change.
- **enforce** (flip later, after P1): exit 1 if any WOULD-BLOCK finding exists.
  Same rules, same allow-list — only the exit code changes (`GUARDRAILS_MODE`).

## Allow-list lifecycle

`allowlist.json` is a **temporary** record of pre-existing call sites at base
commit `e10b799`. As each call site migrates behind the P1 gateway, delete its
entry. `detect-ai-providers.mjs` prints `STALE` for allow-list entries that no
longer match, so the list stays honest. **Do not add new entries.**

See `../CONFIDENTIAL_DATA_POLICY.md` for the policy these checks enforce and
`../../` mission history for context (G1 inventory, G2 policy spec).
