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
  category: "email" | "ai" | "estimator";
  secret: boolean;
  envVar: string;
  placeholder?: string;
};

export const SETTING_DEFINITIONS: SettingDefinition[] = [
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
    label: "From Email",
    description:
      "Sender address used for outbound RFQ emails. Must be on a domain you've verified in Resend.",
    category: "email",
    secret: false,
    envVar: "RESEND_FROM_EMAIL",
    placeholder: "rfq@yourcompany.com",
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

let cache: Map<string, string> | null = null;

async function loadCache(): Promise<Map<string, string>> {
  if (cache) return cache;
  const rows = await prisma.appSetting.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
  return cache;
}

export function clearAppSettingsCache(): void {
  cache = null;
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
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
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
