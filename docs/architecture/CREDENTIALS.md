# Credentials Vault — Security Model

Encrypted storage for third-party integration credentials (Beeline plan room,
Blue Book Network, ConstructConnect, iSqFt, Dodge). The vault is designed so
that:

- Credentials never appear in plaintext in the database
- The master encryption key never appears in the database or any AI prompt
- Decryption is gated behind a single audited code path on each side
- AI/prompt-building code is structurally prevented from reading credentials

## Three layers of AI isolation

### 1. Code-level
- Only `lib/services/credentials/credentialVault.ts` (Next.js) and
  `sidecar/services/credentials.py` (sidecar) can decrypt.
- An ESLint rule in `eslint.config.mjs` makes it a build-time error for any
  file in `lib/services/jobs/**`, `lib/services/spec/**`, `lib/services/briefing/**`,
  `lib/services/drawing/**`, `lib/services/submittal/**`, or `lib/services/meeting*/**`
  to import the vault, the credentials service, or the audit log.
- The Anthropic SDK is used heavily in those paths, so the rule effectively
  prevents AI/prompt code from ever touching credentials.

### 2. Process-level
- The Next.js app encrypts on write (Settings UI → `POST /api/settings/credentials/[service]`).
- The Next.js app NEVER decrypts. It only reads masked summaries via
  `listIntegrations()` and shows "(set)" or `••••••••` in the UI.
- Decryption only happens in the **sidecar Python process** at scrape time
  (when a Playwright login needs the username/password).
- The master key is loaded into both processes from `CREDENTIAL_MASTER_KEY`
  env var, but the Next.js process only uses it for ENCRYPTION; the actual
  `decrypt()` function lives in the Python sidecar.

### 3. Audit-level
- Every decryption call (in either process) appends a record to
  `/storage/audit/credentials-access.jsonl` (NDJSON, one event per line).
- Records include `timestamp`, `service`, `field`, `caller_module`.
- Path is mounted from `/opt/neuroglitch/storage/audit/` on the host.
- If anything containing `caller_module: sidecar:analysis*` or
  `caller_module: ai-*` ever shows up in those logs, that's a security
  alarm — the rule was bypassed somehow.

## Storage shape

`IntegrationCredential` table:

```
id              cuid
service         "beeline" | "blue_book" | "constructconnect" | "isqft" | "dodge"
field           "username" | "password" | "api_key" | "totp_secret" | "client_id" | "client_secret"
encryptedValue  base64 of AES-256-GCM ciphertext
iv              base64 of 12-byte GCM nonce
authTag         base64 of GCM authentication tag
algorithm       "aes-256-gcm"
createdAt
updatedAt
lastTestedAt    timestamp of last "Test connection" attempt
lastTestStatus  "success" | "failed" | NULL
lastTestError   short string for UI display

UNIQUE (service, field)
```

## Encryption parameters

- Algorithm: AES-256-GCM (RFC 5116)
- Key: 32 bytes, hex or base64 encoded in `CREDENTIAL_MASTER_KEY` env var
- IV: 12 bytes, random per row (`crypto.randomBytes(12)` / `os.urandom(12)`)
- Auth tag: 16 bytes (GCM default), stored separately

The IV is per-row, not per-write — but a fresh IV is generated on every
update, so the same plaintext at two points in time encrypts to different
ciphertext.

## Master key handling

- Generated once at deploy time. Append to `.env.local` (mode 660) and
  `sidecar/.env` (mode 660). Both processes load it on startup.
- Never committed. `.env.local` is in `.gitignore`.
- Rotation procedure (future): decrypt all rows with old key, re-encrypt
  with new key in a single transaction. Not implemented yet.

## What the Settings UI shows

- Per-integration card with each field marked "(set)" or `••••••••`
- "Edit" reveals input fields — leave blank to keep existing value, or type
  to overwrite
- "Test" button calls `/credentials/test/{service}` on the sidecar, which
  performs the actual login probe and returns `{ok: true | false, error?}`
- Last-tested timestamp + traffic-light status chip (green = success,
  red = failed, gray = untested)
- "Clear All" wipes every field for a service

## What the Settings UI never shows

- Plaintext credentials
- Decrypted excerpts of credentials (no "show password" eye icon)
- The master key
- Specific failure detail beyond a short error string
