"use client";

// Module SET1 — Email settings card
//
// Manages Resend API key + sender email. Includes "Test connection" buttons
// to validate the API key and (optionally) send a real test email.

import { useEffect, useState } from "react";
import SettingFieldRow, { type SettingItem } from "./SettingFieldRow";

type TestResult =
  | { ok: true; mode: "validate" }
  | { ok: true; mode: "send"; messageId: string | null }
  | { ok: false; error: string };

export default function EmailSettingsCard() {
  const [items, setItems] = useState<SettingItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Test state
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

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

  const hasApiKey = items.find((i) => i.key === "RESEND_API_KEY")?.hasValue ?? false;
  const hasFromEmail =
    items.find((i) => i.key === "RESEND_FROM_EMAIL")?.hasValue ?? false;
  const fullyConfigured = hasApiKey && hasFromEmail;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Status banner ── */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          fullyConfigured
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
            : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
        }`}
      >
        <strong>
          {fullyConfigured ? "Email configured ✓" : "Email not yet configured"}
        </strong>
        {fullyConfigured
          ? " — RFQ emails can be sent from any bid's Subs tab."
          : " — Set the API key and From Email below, then run a test."}
      </div>

      {/* ── Field rows ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          Resend Integration
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
          . The From Email must be on a domain you have already verified in
          Resend&apos;s dashboard.
        </p>
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <SettingFieldRow
              key={item.key}
              item={item}
              onSaved={() => setReloadTick((t) => t + 1)}
            />
          ))}
        </div>
      </section>

      {/* ── Test connection ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Test Connection
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          Validate your key against Resend without sending mail, or send a real
          test email to yourself.
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
            disabled={testing || !hasApiKey}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title={!hasApiKey ? "Set an API key first" : "Validate key only"}
          >
            {testing ? "Testing…" : "Validate Key"}
          </button>
          <button
            onClick={() => runTest(true)}
            disabled={testing || !fullyConfigured || !testTo.includes("@")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title={
              !fullyConfigured
                ? "API key + From Email required"
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
                ? "✓ API key is valid. Resend accepted the request."
                : `✓ Test email sent. Resend message ID: ${testResult.messageId ?? "n/a"}. Check your inbox.`
              : `✗ ${testResult.error}`}
          </div>
        )}
      </section>
    </div>
  );
}
