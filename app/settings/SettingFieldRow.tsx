"use client";

// Module SET1 — Reusable setting field row
//
// Used by EmailSettingsCard, EstimatorSettingsCard, and the AI card to render
// one editable setting from the AppSetting key/value store.
//
// Behavior:
// - Display mode: shows current value (masked for secrets) + source badge.
//   Click "Replace" to switch into edit mode.
// - Edit mode: input + Save / Cancel.
// - "Clear" button removes the DB override (falls back to env if available).

import { useState } from "react";

export type SettingItem = {
  key: string;
  label: string;
  description: string;
  category: "email" | "ai" | "estimator";
  secret: boolean;
  envVar: string;
  placeholder: string | null;
  hasValue: boolean;
  displayValue: string;
  source: "db" | "env" | "missing";
};

export default function SettingFieldRow({
  item,
  onSaved,
}: {
  item: SettingItem;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setEditing(true);
    setDraft("");
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
    setError(null);
  }

  async function save(value: string | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      setDraft("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {item.label}
            </h4>
            <SourceBadge source={item.source} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {item.description}
          </p>
        </div>
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <span
            className={`font-mono text-sm ${
              item.hasValue
                ? "text-zinc-800 dark:text-zinc-200"
                : "text-zinc-400 italic dark:text-zinc-500"
            }`}
          >
            {item.hasValue ? item.displayValue : "not configured"}
          </span>
          <div className="flex items-center gap-2">
            {item.source === "db" && (
              <button
                onClick={() => save(null)}
                disabled={saving}
                className="text-xs text-zinc-500 hover:text-zinc-800 underline disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
                title="Remove DB override (falls back to env if available)"
              >
                Clear
              </button>
            )}
            <button
              onClick={startEdit}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {item.hasValue ? "Replace" : "Set"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <input
            type={item.secret ? "password" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={item.placeholder ?? ""}
            autoFocus
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => save(draft)}
              disabled={saving || draft.trim() === ""}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancelEdit}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            {item.envVar && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-auto">
                env fallback: <span className="font-mono">{item.envVar}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: "db" | "env" | "missing" }) {
  const styles: Record<typeof source, string> = {
    db: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    env: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    missing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  };
  const labels: Record<typeof source, string> = {
    db: "saved",
    env: "from .env",
    missing: "not set",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}
