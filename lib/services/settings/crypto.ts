// GWX-004 — Authenticated encryption for AppSetting secret values
//
// Algorithm: AES-256-GCM (authenticated, not just encrypted)
// Key source: SETTINGS_ENCRYPTION_KEY env var — see docs for setup
//
// Stored format: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
// The sentinel prefix lets the read path distinguish ciphertext from legacy
// plaintext so migration is transparent and backward-compatible.
//
// Behavior when SETTINGS_ENCRYPTION_KEY is not set:
//   - encryptSetting() returns the plaintext unchanged (low-level primitive — callers
//     enforce policy; setSetting() rejects secret writes unless AUTH_DISABLED=true)
//   - decryptSetting() passes plaintext through; throws if it sees enc:v1: prefix
//   - keyConfigured() returns false
//
// To generate a key: openssl rand -hex 32

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm" as const;
const ENC_PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") return null;
  // Accept any length string — hash to 32 bytes so mis-length keys still work
  return createHash("sha256").update(raw).digest();
}

export function keyConfigured(): boolean {
  return getKey() !== null;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a plaintext setting value.
 * Returns the plaintext unchanged if SETTINGS_ENCRYPTION_KEY is not set.
 * Policy enforcement (reject plaintext writes) is the caller's responsibility — see setSetting().
 */
export function encryptSetting(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    ENC_PREFIX +
    iv.toString("hex") + ":" +
    authTag.toString("hex") + ":" +
    encrypted.toString("hex")
  );
}

/**
 * Decrypt a setting value.
 * - If the value does not start with enc:v1:, returns it as-is (plaintext passthrough).
 * - If the value is encrypted but SETTINGS_ENCRYPTION_KEY is missing, throws.
 * - If decryption fails (wrong key, tampered ciphertext), throws — never returns garbage.
 */
export function decryptSetting(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const key = getKey();
  if (!key) {
    throw new Error(
      "AppSetting contains an encrypted value but SETTINGS_ENCRYPTION_KEY is not set. " +
        "Add SETTINGS_ENCRYPTION_KEY to your environment to decrypt stored credentials."
    );
  }

  const payload = stored.slice(ENC_PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted AppSetting value — expected enc:v1:<iv>:<tag>:<ct>");
  }

  const [ivHex, tagHex, ctHex] = parts;
  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ctHex, "hex");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt AppSetting — SETTINGS_ENCRYPTION_KEY may be wrong or the value may be corrupted."
    );
  }
}
