// Module SET1 — App Settings service
//
// DB-backed key/value store with env-fallback. Reads are cached in-process and
// the cache is invalidated on every write.
//
// Use this for credentials and configuration that the user can change from
// the /settings UI without restarting the dev server. Examples:
//   - Resend API key + sender email
//   - Estimator name/email defaults
//   - Anthropic API key (future)
//
// All callers should go through getSetting() — never read process.env directly
// for any value that might be UI-configurable.

import { prisma } from "@/lib/prisma";
import {
  decryptSetting,
  encryptSetting,
  isEncrypted,
  keyConfigured,
} from "./crypto";

// ── Setting key catalog ─────────────────────────────────────────────────────
//
// Centralized list of every key the app reads. Adding a key here makes it
// available to the settings UI and gives it env-fallback semantics.
//
// `secret: true` means the UI masks the value to a last-4 display.
// `envVar` is the legacy environment variable name we fall back to if no DB
// row exists.

export type SettingDefinition = {
  key: string;
  label: string;
  description: string;
  category: "email" | "ai" | "estimator" | "procore" | "infrastructure";
  secret: boolean;
  envVar: string;
  placeholder?: string;
};

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "EMAIL_PROVIDER",
    label: "Email Provider",
    description:
      "Which service should send RFQ emails. Resend is API-based and best for transactional volume; SMTP works with Gmail, Outlook, Yahoo, iCloud, Fastmail, and any custom SMTP server.",
    category: "email",
    secret: false,
    envVar: "EMAIL_PROVIDER",
    placeholder: "resend",
  },
  {
    key: "RESEND_API_KEY",
    label: "Resend API Key",
    description:
      "Your Resend API key. Get one at https://resend.com/api-keys after verifying a sender domain.",
    category: "email",
    secret: true,
    envVar: "RESEND_API_KEY",
    placeholder: "re_xxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "RESEND_FROM_EMAIL",
    label: "Resend From Email",
    description:
      "Sender address used for outbound RFQ emails when Resend is the active provider. Must be on a domain you've verified in Resend.",
    category: "email",
    secret: false,
    envVar: "RESEND_FROM_EMAIL",
    placeholder: "rfq@yourcompany.com",
  },
  {
    key: "SMTP_HOST",
    label: "SMTP Host",
    description: "Outgoing SMTP server hostname.",
    category: "email",
    secret: false,
    envVar: "SMTP_HOST",
    placeholder: "smtp.gmail.com",
  },
  {
    key: "SMTP_PORT",
    label: "SMTP Port",
    description: "Outgoing SMTP server port. 587 for STARTTLS (modern default), 465 for SSL.",
    category: "email",
    secret: false,
    envVar: "SMTP_PORT",
    placeholder: "587",
  },
  {
    key: "SMTP_SECURE",
    label: "SMTP Secure",
    description:
      "Set to \"true\" if connecting on port 465 with implicit SSL. Leave \"false\" for STARTTLS on port 587.",
    category: "email",
    secret: false,
    envVar: "SMTP_SECURE",
    placeholder: "false",
  },
  {
    key: "SMTP_USER",
    label: "SMTP Username",
    description: "Usually your full email address.",
    category: "email",
    secret: false,
    envVar: "SMTP_USER",
    placeholder: "you@yourcompany.com",
  },
  {
    key: "SMTP_PASSWORD",
    label: "SMTP Password",
    description:
      "App password (NOT your regular account password). Generate one in your email provider's account security settings.",
    category: "email",
    secret: true,
    envVar: "SMTP_PASSWORD",
    placeholder: "xxxx xxxx xxxx xxxx",
  },
  {
    key: "SMTP_FROM_EMAIL",
    label: "SMTP From Email",
    description:
      "Optional sender address. Defaults to the SMTP username if not set. Some providers require this to match the authenticated mailbox.",
    category: "email",
    secret: false,
    envVar: "SMTP_FROM_EMAIL",
    placeholder: "rfq@yourcompany.com",
  },
  {
    key: "SMTP_FROM_NAME",
    label: "SMTP From Name",
    description: "Optional display name shown next to the From address (e.g. \"Acme Estimating\").",
    category: "email",
    secret: false,
    envVar: "SMTP_FROM_NAME",
    placeholder: "Acme Estimating",
  },
  {
    key: "ESTIMATOR_NAME",
    label: "Estimator Name",
    description: "Default sender name shown in the Send RFQ modal.",
    category: "estimator",
    secret: false,
    envVar: "ESTIMATOR_NAME",
    placeholder: "Jane Smith",
  },
  {
    key: "ESTIMATOR_EMAIL",
    label: "Estimator Email",
    description:
      "Default reply-to address shown in the Send RFQ modal. Subs reply directly here.",
    category: "estimator",
    secret: false,
    envVar: "ESTIMATOR_EMAIL",
    placeholder: "jane@yourcompany.com",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    description:
      "Your Anthropic API key. Powers all AI features (brief generation, gap analysis, etc.). Get one at https://console.anthropic.com/settings/keys",
    category: "ai",
    secret: true,
    envVar: "ANTHROPIC_API_KEY",
    placeholder: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "PROCORE_CLIENT_ID",
    label: "Procore Client ID",
    description:
      "OAuth client ID from your Procore Developer Portal app. Required for REST API push. Create a service account app at https://developers.procore.com",
    category: "procore",
    secret: false,
    envVar: "PROCORE_CLIENT_ID",
    placeholder: "abc123...",
  },
  {
    key: "PROCORE_CLIENT_SECRET",
    label: "Procore Client Secret",
    description: "OAuth client secret for your Procore service account app. Stored as plaintext in SQLite — keep this server local.",
    category: "procore",
    secret: true,
    envVar: "PROCORE_CLIENT_SECRET",
    placeholder: "secret...",
  },
  {
    key: "PROCORE_COMPANY_ID",
    label: "Procore Company ID",
    description:
      "Your Procore account company ID (numeric). Found in Admin → Company Settings → General or in the URL when logged into Procore.",
    category: "procore",
    secret: false,
    envVar: "PROCORE_COMPANY_ID",
    placeholder: "1234567",
  },
  // ── F3 — Webhook settings ────────────────────────────────────────────────
  {
    key: "PROCORE_WEBHOOK_URL",
    label: "Webhook URL",
    description:
      "The public HTTPS URL where Procore will send real-time events (RFI creates, submittal updates). Must be accessible from the internet. Example: https://yourapp.com/api/procore/webhook",
    category: "procore",
    secret: false,
    envVar: "PROCORE_WEBHOOK_URL",
    placeholder: "https://yourapp.com/api/procore/webhook",
  },
  {
    key: "PROCORE_WEBHOOK_SECRET",
    label: "Webhook Secret",
    description:
      "A secret string sent by Procore with each webhook event so you can verify it came from Procore. Set this to any random value, then click Register Webhook in the Procore tab.",
    category: "procore",
    secret: true,
    envVar: "PROCORE_WEBHOOK_SECRET",
    placeholder: "your-random-secret",
  },
  // ── Infrastructure ───────────────────────────────────────────────────────
  {
    key: "SIDECAR_URL",
    label: "Python Sidecar URL",
    description: "URL where the FastAPI sidecar is running. Default: http://127.0.0.1:8001 (local). Set to the sidecar's deployed URL in production.",
    category: "infrastructure",
    secret: false,
    envVar: "SIDECAR_URL",
    placeholder: "http://127.0.0.1:8001",
  },
  {
    key: "SIDECAR_API_KEY",
    label: "Sidecar API Key",
    description: "Shared secret the app sends in X-API-Key headers to authenticate with the sidecar. Leave blank in dev (sidecar allows all). Must match SIDECAR_API_KEY in your sidecar environment.",
    category: "infrastructure",
    secret: true,
    envVar: "SIDECAR_API_KEY",
    placeholder: "your-random-secret",
  },
  {
    key: "WHISPERX_URL",
    label: "GPU Worker URL",
    description: "Tailscale (or LAN) URL of the WhisperX GPU worker. Format: http://<tailscale-ip>:8002. Leave blank to skip GPU transcription and fall back to AssemblyAI.",
    category: "infrastructure",
    secret: false,
    envVar: "WHISPERX_URL",
    placeholder: "http://100.x.x.x:8002",
  },
  {
    key: "WHISPERX_API_KEY",
    label: "GPU Worker API Key",
    description: "Shared secret sent in X-API-Key headers to the GPU worker. Must match WHISPERX_API_KEY in the GPU worker's environment.",
    category: "infrastructure",
    secret: true,
    envVar: "WHISPERX_API_KEY",
    placeholder: "your-random-secret",
  },
  {
    key: "APP_URL",
    label: "App Public URL",
    description: "The public HTTPS URL of this Groundworx instance. Used for webhook callbacks and email links.",
    category: "infrastructure",
    secret: false,
    envVar: "APP_URL",
    placeholder: "https://groundworx.neuroglitch.ai",
  },
];

const KEYS_BY_CATEGORY = SETTING_DEFINITIONS.reduce(
  (acc, def) => {
    if (!acc[def.category]) acc[def.category] = [];
    acc[def.category].push(def);
    return acc;
  },
  {} as Record<string, SettingDefinition[]>
);

export function getSettingDefinitionsByCategory(
  category: SettingDefinition["category"]
): SettingDefinition[] {
  return KEYS_BY_CATEGORY[category] ?? [];
}

export function getSettingDefinition(key: string): SettingDefinition | null {
  return SETTING_DEFINITIONS.find((d) => d.key === key) ?? null;
}

// ── In-process cache ────────────────────────────────────────────────────────
//
// Pinned to globalThis so the cache survives Next.js dev-mode module
// duplication across route-handler bundles. Without this, a PATCH that runs
// in one bundle's module instance can't invalidate another bundle's cache,
// leading to stale reads. (Same pattern Prisma uses for its client singleton.)

const globalForCache = globalThis as unknown as {
  __appSettingsCache?: Map<string, string> | null;
};

function readCache(): Map<string, string> | null {
  return globalForCache.__appSettingsCache ?? null;
}

function writeCache(value: Map<string, string> | null): void {
  globalForCache.__appSettingsCache = value;
}

async function loadCache(): Promise<Map<string, string>> {
  const existing = readCache();
  if (existing) return existing;

  const rows = await prisma.appSetting.findMany();
  const fresh = new Map<string, string>();
  const toReencrypt: Array<{ key: string; plaintext: string }> = [];

  for (const r of rows) {
    const def = getSettingDefinition(r.key);
    if (def?.secret) {
      if (isEncrypted(r.value)) {
        // Decrypt — throws on bad key/tampered ciphertext (fail loudly, never return garbage)
        fresh.set(r.key, decryptSetting(r.value));
      } else {
        // Legacy plaintext secret — serve as-is; queue for transparent re-encryption
        fresh.set(r.key, r.value);
        if (keyConfigured()) {
          toReencrypt.push({ key: r.key, plaintext: r.value });
        }
      }
    } else {
      fresh.set(r.key, r.value);
    }
  }

  writeCache(fresh);

  // Transparently migrate any legacy plaintext secrets to encrypted form (best-effort)
  for (const { key, plaintext } of toReencrypt) {
    const encrypted = encryptSetting(plaintext);
    await prisma.appSetting
      .update({ where: { key }, data: { value: encrypted } })
      .catch(() => {});
  }

  return fresh;
}

export function clearAppSettingsCache(): void {
  writeCache(null);
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Get the effective value for a setting key. DB row wins; falls back to the
 * environment variable named in the definition. Returns null if neither
 * source has a value.
 */
export async function getSetting(key: string): Promise<string | null> {
  const map = await loadCache();
  const dbVal = map.get(key);
  if (dbVal !== undefined && dbVal !== "") return dbVal;

  const def = getSettingDefinition(key);
  if (def) {
    const envVal = process.env[def.envVar];
    if (envVal && envVal !== "") return envVal;
  }
  return null;
}

/**
 * Synchronous variant for places that already have the cache loaded. Returns
 * null if the cache hasn't been primed.
 */
export function getCachedSetting(key: string): string | null {
  const cache = readCache();
  if (!cache) return null;
  const dbVal = cache.get(key);
  if (dbVal !== undefined && dbVal !== "") return dbVal;
  const def = getSettingDefinition(key);
  if (def) {
    const envVal = process.env[def.envVar];
    if (envVal && envVal !== "") return envVal;
  }
  return null;
}

/**
 * Returns whether the value comes from the DB (overridden) or env-fallback.
 * Useful for UI display.
 */
export async function getSettingSource(
  key: string
): Promise<"db" | "env" | "missing"> {
  const map = await loadCache();
  if (map.has(key) && map.get(key) !== "") return "db";
  const def = getSettingDefinition(key);
  if (def && process.env[def.envVar] && process.env[def.envVar] !== "")
    return "env";
  return "missing";
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Set a setting value. Pass null or "" to clear the DB override (will then
 * fall back to env if available).
 */
export async function setSetting(
  key: string,
  value: string | null
): Promise<void> {
  const def = getSettingDefinition(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);

  if (value === null || value === "") {
    await prisma.appSetting.delete({ where: { key } }).catch(() => {});
  } else {
    let stored: string;
    if (def.secret) {
      if (!keyConfigured()) {
        // Fail closed — do not silently persist a plaintext secret.
        // AUTH_DISABLED=true is the accepted solo-dev bypass: no real secrets
        // are expected in that mode and encryption infra may not be set up.
        if (process.env.AUTH_DISABLED !== "true") {
          throw new Error(
            `Cannot save secret setting '${key}': SETTINGS_ENCRYPTION_KEY is not configured. ` +
              "Add SETTINGS_ENCRYPTION_KEY to your environment before saving credentials. " +
              "Run: openssl rand -hex 32"
          );
        }
        stored = value; // AUTH_DISABLED dev bypass — plaintext allowed
      } else {
        stored = encryptSetting(value);
      }
    } else {
      stored = value;
    }
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: stored },
      update: { value: stored },
    });
  }
  clearAppSettingsCache();
}

// ── Display helpers ─────────────────────────────────────────────────────────

/**
 * Mask a secret value to last-4. "" → "" so the UI shows "not set".
 */
export function maskSecret(value: string | null): string {
  if (!value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return "•".repeat(Math.max(8, value.length - 4)) + value.slice(-4);
}

// ── Convenience: load all settings for a category for the UI ───────────────

export type SettingDisplay = {
  key: string;
  label: string;
  description: string;
  category: SettingDefinition["category"];
  secret: boolean;
  envVar: string;
  placeholder: string | null;
  // Effective value (db OR env)
  hasValue: boolean;
  // For non-secrets, the actual value. For secrets, the masked form.
  displayValue: string;
  // Where the value comes from
  source: "db" | "env" | "missing";
};

export async function loadSettingsByCategory(
  category: SettingDefinition["category"]
): Promise<SettingDisplay[]> {
  const defs = getSettingDefinitionsByCategory(category);
  const out: SettingDisplay[] = [];
  for (const def of defs) {
    const value = await getSetting(def.key);
    const source = await getSettingSource(def.key);
    out.push({
      key: def.key,
      label: def.label,
      description: def.description,
      category: def.category,
      secret: def.secret,
      envVar: def.envVar,
      placeholder: def.placeholder ?? null,
      hasValue: value !== null,
      displayValue: def.secret ? maskSecret(value) : value ?? "",
      source,
    });
  }
  return out;
}
