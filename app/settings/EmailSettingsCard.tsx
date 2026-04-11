"use client";

// Module SET1+ — Email settings card
//
// Two providers supported: Resend (API-based) and Generic SMTP (works with
// Gmail, Outlook/M365, Yahoo, iCloud, Fastmail, custom). The provider
// selector at the top toggles which configuration section renders below.
//
// SMTP includes a "preset" dropdown that pre-fills host/port/secure for
// common providers so the user doesn't have to look up the values.

import { useEffect, useState } from "react";
import SettingFieldRow, { type SettingItem } from "./SettingFieldRow";
import { SMTP_PRESETS } from "@/lib/services/email/smtpPresets";

type Provider = "resend" | "smtp";

type TestResult =
  | { ok: true; mode: "validate"; provider: Provider; details: string | null }
  | { ok: true; mode: "send"; provider: Provider; messageId: string | null }
  | { ok: false; provider?: Provider; error: string };

const RESEND_KEYS = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"];
const SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL",
  "SMTP_FROM_NAME",
];

export default function EmailSettingsCard() {
  const [items, setItems] = useState<SettingItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);

  // Test panel state
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Preset dropdown state
  const [presetApplying, setPresetApplying] = useState(false);

  // Reload tick — bumped after every save to refresh items
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/app?category=email");
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { items: SettingItem[] };
        if (cancelled) return;
        setItems(data.items);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function setSetting(key: string, value: string | null) {
    const res = await fetch("/api/settings/app", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
  }

  async function changeProvider(next: Provider) {
    setSavingProvider(true);
    setError(null);
    try {
      await setSetting("EMAIL_PROVIDER", next);
      setReloadTick((t) => t + 1);
      setTestResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProvider(false);
    }
  }

  async function applyPreset(presetId: string) {
    if (!presetId || presetId === "custom") return;
    const preset = SMTP_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    setPresetApplying(true);
    setError(null);
    try {
      await setSetting("SMTP_HOST", preset.host);
      await setSetting("SMTP_PORT", String(preset.port));
      await setSetting("SMTP_SECURE", preset.secure ? "true" : "false");
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetApplying(false);
    }
  }

  async function runTest(withEmail: boolean) {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withEmail ? { to: testTo } : {}),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading email settings…</p>
    );
  }
  if (error || !items) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {error ?? "Failed to load"}
      </div>
    );
  }

  // Resolve active provider from settings (default to "resend")
  const providerItem = items.find((i) => i.key === "EMAIL_PROVIDER");
  const activeProvider: Provider =
    providerItem?.displayValue === "smtp" ? "smtp" : "resend";

  // Filter items by provider
  const resendItems = items.filter((i) => RESEND_KEYS.includes(i.key));
  const smtpItems = items.filter((i) => SMTP_KEYS.includes(i.key));

  // Configured? — at least the required fields are populated
  const required = activeProvider === "smtp"
    ? ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]
    : ["RESEND_API_KEY", "RESEND_FROM_EMAIL"];
  const fullyConfigured = required.every(
    (k) => items.find((i) => i.key === k)?.hasValue
  );

  // Detect current SMTP preset (if any) by matching host+port+secure
  const currentSmtpHost = items.find((i) => i.key === "SMTP_HOST")?.displayValue ?? "";
  const currentSmtpPort = items.find((i) => i.key === "SMTP_PORT")?.displayValue ?? "";
  const currentSmtpSecure = items.find((i) => i.key === "SMTP_SECURE")?.displayValue ?? "";
  const matchedPreset = SMTP_PRESETS.find(
    (p) =>
      p.id !== "custom" &&
      p.host === currentSmtpHost &&
      String(p.port) === currentSmtpPort &&
      String(p.secure) === currentSmtpSecure
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ── Provider selector ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Email Provider
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
          Choose how RFQ emails get sent. You can switch any time without losing the other provider&apos;s configuration.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProviderTile
            id="resend"
            label="Resend"
            description="API-based transactional service. Best for high volume and delivery analytics. Free tier available."
            active={activeProvider === "resend"}
            onClick={() => changeProvider("resend")}
            disabled={savingProvider}
          />
          <ProviderTile
            id="smtp"
            label="SMTP (Gmail, Outlook, Yahoo, Custom)"
            description="Send through any SMTP server using your existing mailbox. Requires an app password from your provider."
            active={activeProvider === "smtp"}
            onClick={() => changeProvider("smtp")}
            disabled={savingProvider}
          />
        </div>
      </section>

      {/* ── Status banner ── */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          fullyConfigured
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
            : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
        }`}
      >
        <strong>
          {fullyConfigured
            ? `${activeProvider === "smtp" ? "SMTP" : "Resend"} configured ✓`
            : `${activeProvider === "smtp" ? "SMTP" : "Resend"} not yet configured`}
        </strong>
        {fullyConfigured
          ? " — RFQ emails can be sent from any bid's Subs tab."
          : ` — Fill in the ${activeProvider === "smtp" ? "SMTP" : "Resend"} fields below, then run a test.`}
      </div>

      {/* ── Resend config ── */}
      {activeProvider === "resend" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            Resend Configuration
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Get your API key from{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              resend.com/api-keys
            </a>
            . The From Email must be on a domain you have already verified in Resend&apos;s dashboard.
          </p>
          <div className="flex flex-col gap-3">
            {resendItems.map((item) => (
              <SettingFieldRow
                key={item.key}
                item={item}
                onSaved={() => setReloadTick((t) => t + 1)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── SMTP config ── */}
      {activeProvider === "smtp" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            SMTP Configuration
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Pick a preset to auto-fill host, port, and SSL flag — or choose
            Custom to enter them manually. Most providers require an{" "}
            <strong>app password</strong> (generated in your account&apos;s
            security settings) rather than your normal account password.
          </p>

          {/* Preset dropdown */}
          <div className="mb-4">
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
              Provider Preset
            </label>
            <select
              value={matchedPreset?.id ?? ""}
              onChange={(e) => applyPreset(e.target.value)}
              disabled={presetApplying}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="" disabled>
                {presetApplying ? "Applying…" : "Choose a provider…"}
              </option>
              {SMTP_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {matchedPreset && matchedPreset.id !== "custom" && (
              <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                <strong>{matchedPreset.label}:</strong> {matchedPreset.notes}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {smtpItems.map((item) => (
              <SettingFieldRow
                key={item.key}
                item={item}
                onSaved={() => setReloadTick((t) => t + 1)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Test connection ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Test Connection
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          Validate your{" "}
          <span className="font-medium">
            {activeProvider === "smtp" ? "SMTP" : "Resend"}
          </span>{" "}
          credentials without sending mail, or send a real test email to
          yourself.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
              Send test to (optional)
            </label>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourcompany.com"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <button
            onClick={() => runTest(false)}
            disabled={testing || !fullyConfigured}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title={!fullyConfigured ? "Configure required fields first" : "Validate connection"}
          >
            {testing ? "Testing…" : "Validate Connection"}
          </button>
          <button
            onClick={() => runTest(true)}
            disabled={testing || !fullyConfigured || !testTo.includes("@")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title={
              !fullyConfigured
                ? "Configure required fields first"
                : !testTo.includes("@")
                  ? "Enter a recipient address"
                  : "Send a real test email"
            }
          >
            {testing ? "Sending…" : "Send Test Email"}
          </button>
        </div>

        {testResult && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-xs ${
              testResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300"
            }`}
          >
            {testResult.ok
              ? testResult.mode === "validate"
                ? `✓ ${testResult.details ?? "Connection validated."}`
                : `✓ Test email sent. Message ID: ${testResult.messageId ?? "n/a"}. Check your inbox.`
              : `✗ ${testResult.error}`}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Provider tile ──────────────────────────────────────────────────────────

function ProviderTile({
  id,
  label,
  description,
  active,
  onClick,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || active}
      className={`relative flex flex-col items-start gap-1 rounded-md border px-4 py-3 text-left transition-colors ${
        active
          ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      } disabled:cursor-not-allowed`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {active && (
          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
            Active
          </span>
        )}
      </div>
      <span className="text-[11px] opacity-80" data-id={id}>
        {description}
      </span>
    </button>
  );
}
