/**
 * credentialVault — AES-256-GCM encryption for IntegrationCredential rows.
 *
 * ⚠ SECURITY-CRITICAL ⚠
 *
 * - Master key from CREDENTIAL_MASTER_KEY env var. NEVER appears in DB,
 *   NEVER in any AI prompt, NEVER in any committed file.
 * - Only files in `app/api/settings/credentials/**` and the sidecar bridge
 *   may import the decrypt() function. AI/prompt-building code is forbidden
 *   from importing this module (enforced by ESLint no-restricted-imports).
 * - Every decrypt() call appends an audit record via auditLog().
 *
 * See docs/architecture/CREDENTIALS.md for the full security model.
 */

import * as crypto from "node:crypto";
import { auditCredentialRead } from "./auditLog";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;     // GCM standard
const KEY_LEN = 32;    // 256 bits

let _key: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_key) return _key;
  const raw = process.env.CREDENTIAL_MASTER_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_MASTER_KEY env var is not set");
  }
  // Accept hex (64 chars) or base64 (44 chars)
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== KEY_LEN) {
    throw new Error(`CREDENTIAL_MASTER_KEY must decode to ${KEY_LEN} bytes (got ${key.length})`);
  }
  _key = key;
  return key;
}

export type Encrypted = {
  encryptedValue: string;   // base64
  iv: string;               // base64
  authTag: string;          // base64
  algorithm: string;
};

export function encrypt(plaintext: string): Encrypted {
  if (typeof plaintext !== "string") throw new Error("encrypt: plaintext must be string");
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString("base64"),
    iv:             iv.toString("base64"),
    authTag:        authTag.toString("base64"),
    algorithm:      ALGO,
  };
}

/**
 * Decrypt a stored credential.
 *
 * ⚠ This is the only function that produces plaintext. Every call is
 * audit-logged with the caller_module identifier.
 *
 * @param callerModule  Short identifier of the calling code path. Used for
 *                      audit log. Must be passed explicitly so the audit
 *                      trail is traceable.
 */
export async function decrypt(
  row: { encryptedValue: string; iv: string; authTag: string; algorithm: string; service: string; field: string },
  callerModule: string,
): Promise<string> {
  if (row.algorithm !== ALGO) {
    throw new Error(`Unsupported algorithm: ${row.algorithm}`);
  }
  const key = getMasterKey();
  const iv = Buffer.from(row.iv, "base64");
  const authTag = Buffer.from(row.authTag, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const ciphertext = Buffer.from(row.encryptedValue, "base64");
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  await auditCredentialRead({
    service: row.service,
    field: row.field,
    caller_module: callerModule,
    timestamp: new Date().toISOString(),
  });

  return plain;
}

// Security hotfix (credential-vault-secret-redaction): there used to be a
// maskValue() helper here that revealed real plaintext fragments — first 4 +
// last 3 characters for api_key/token fields, first 2 characters for
// username-style fields. It was exported but never actually called anywhere
// (credentialsService.ts's real, reachable listIntegrations() path already
// used a fully safe fixed-shape mask — "••••••••" for password/secret
// fields, the literal string "(set)" for everything else, with zero
// characters ever derived from the real value). Removed entirely, not
// neutered, so it can't be reintroduced or called later. Any future UI/API
// surface for these credentials must use the same fixed-shape,
// content-free "Configured" / "Not configured" pattern established by
// lib/services/settings/secretDisplay.ts — never re-derive a display string
// from the plaintext.

/**
 * Validate that CREDENTIAL_MASTER_KEY is configured. Use during app startup
 * or health checks. Throws if the key is missing or malformed.
 */
export function assertMasterKeyConfigured(): void {
  getMasterKey();
}
