"use client";

// Tier F F2 — Procore Integration settings card
//
// Three fields: Client ID, Client Secret (masked), Company ID.
// A "Test Connection" button calls GET /api/procore/test and shows the
// result inline so the user can verify credentials before attempting a push.

import { useEffect, useState } from "react";
import SettingFieldRow, { type SettingItem } from "./SettingFieldRow";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type TestState = "idle" | "testing" | "ok" | "error";

export default function ProcoreSettingsCard() {
  const [items, setItems] = useState<SettingItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/app?category=procore")
      .then((r) => r.json() as Promise<{ items: SettingItem[] } | { error: string }>)
      .then((data) => {
        if (cancelled) return;
        if ("error" in data) {
          setLoadError(data.error);
        } else {
          setItems(data.items);
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function handleTest() {
    setTestState("testing");
    setTestMessage("");
    try {
      const res = await fetch("/api/procore/test");
      const data = (await res.json()) as { ok: boolean; companyName?: string; error?: string };
      if (data.ok) {
        setTestState("ok");
        setTestMessage(data.companyName ? `Connected — ${data.companyName}` : "Connected");
      } else {
        setTestState("error");
        setTestMessage(data.error ?? "Connection failed");
      }
    } catch (e) {
      setTestState("error");
      setTestMessage(e instanceof Error ? e.message : "Network error");
    }
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {loadError}
      </div>
    );
  }

  if (!items) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  const allConfigured = items.every((i) => i.hasValue);

  return (
    <div className="flex flex-col gap-5">
      {/* ── How to get credentials ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Procore Service Account Setup
        </h3>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 list-decimal list-inside">
          <li>
            Log in to the{" "}
            <span className="font-mono text-xs">developers.procore.com</span>{" "}
            Developer Portal.
          </li>
          <li>
            Create a new app → choose <strong>Service Account</strong> auth type.
          </li>
          <li>Copy the Client ID and Client Secret from the app credentials page.</li>
          <li>
            Your Company ID is the numeric ID in the URL when you log into Procore
            (e.g.{" "}
            <span className="font-mono text-xs">
              app.procore.com/companies/<strong>1234567</strong>
            </span>
            ) or in Admin → Company Settings.
          </li>
        </ol>
      </section>

      {/* ── Credential fields ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          API Credentials
        </h3>
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <SettingFieldRow
              key={item.key}
              item={item}
              onSaved={() => {
                setReloadTick((t) => t + 1);
                setTestState("idle");
              }}
            />
          ))}
        </div>
      </section>

      {/* ── Test connection ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Test Connection
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Verify that the credentials work before pushing data.
            </p>
          </div>
          <button
            onClick={handleTest}
            disabled={!allConfigured || testState === "testing"}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {testState === "testing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testState === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
            {testState === "error" && <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
            {testState === "testing" ? "Testing…" : "Test Connection"}
          </button>
        </div>

        {testState === "ok" && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {testMessage}
          </div>
        )}
        {testState === "error" && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {testMessage}
          </div>
        )}

        {!allConfigured && (
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500 italic">
            Enter all three credentials above to enable the connection test.
          </p>
        )}
      </section>
    </div>
  );
}
