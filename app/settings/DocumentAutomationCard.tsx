"use client";

// Q03.2b — Global "Document AI Enrichment" Admin control.
//
// Shows the EFFECTIVE state of automatic document-event AI enrichment
// (spec-book upload, drawings upload, addendum delete), who changed it last,
// and — when the platform safety lock (DOCUMENT_AUTOMATION_HARD_DISABLED) is
// engaged — explains that the lock is forcing automation off regardless of
// this setting. Enabling requires an explicit in-place confirmation step
// (same two-step interaction idiom as the other settings cards — no new
// framework, no window.confirm).

import { useCallback, useEffect, useState } from "react";

type State = {
  adminEnabled: boolean;
  hardDisabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: string | null;
  lastChange: { actorEmail: string | null; at: string; decision: string | null } | null;
};

export default function DocumentAutomationCard() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingEnable, setConfirmingEnable] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings/document-automation");
      if (!res.ok) {
        setLoadError("Failed to load (admin access required).");
        return;
      }
      setState((await res.json()) as State);
    } catch {
      setLoadError("Failed to load document-automation state.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(enabled: boolean) {
    setSaving(true);
    setSaveError(null);
    setConfirmingEnable(false);
    try {
      const res = await fetch("/api/settings/document-automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setSaveError("Save failed.");
        return;
      }
      setState((await res.json()) as State);
    } catch {
      setSaveError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Document AI Enrichment
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Global switch for automatic AI enrichment on document events (spec book upload,
          drawings upload, addendum delete). Default off. When off, documents still store
          normally — no AI call is made and uploads say so. Manual Analyze/Generate actions
          are unaffected by this setting.
        </p>
      </div>

      {loadError && <p className="text-xs text-red-500">{loadError}</p>}

      {state && (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
          {state.hardDisabled && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Platform safety lock engaged (DOCUMENT_AUTOMATION_HARD_DISABLED) — automatic
                document AI enrichment is forced OFF regardless of the setting below. Removing
                the lock is a deploy-plane operator action.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <span
              className={
                state.effectiveEnabled
                  ? "text-xs font-semibold px-2 py-0.5 rounded bg-[rgba(45,123,255,0.12)] text-[#E8EEFF]"
                  : "text-xs font-semibold px-2 py-0.5 rounded bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
              }
            >
              {state.effectiveEnabled ? "ON" : "OFF"}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Effective state
              {state.hardDisabled && state.adminEnabled
                ? " (admin setting is ON, overridden by the safety lock)"
                : ""}
            </span>
          </div>

          {!state.adminEnabled ? (
            !confirmingEnable ? (
              <button
                onClick={() => setConfirmingEnable(true)}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Enable document AI enrichment…
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-600 dark:text-zinc-300">
                  The next applicable document action may make a real AI call. Enable?
                </span>
                <button
                  onClick={() => apply(true)}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Confirm enable"}
                </button>
                <button
                  onClick={() => setConfirmingEnable(false)}
                  disabled={saving}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                >
                  Cancel
                </button>
              </div>
            )
          ) : (
            <button
              onClick={() => apply(false)}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-zinc-300 text-zinc-700 hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300"
            >
              {saving ? "Saving…" : "Disable document AI enrichment"}
            </button>
          )}

          {saveError && <p className="text-xs text-red-500">{saveError}</p>}

          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            {state.lastChange
              ? `Last changed ${new Date(state.lastChange.at).toLocaleString()} by ${
                  state.lastChange.actorEmail ?? "unknown actor"
                } (${state.lastChange.decision ?? "—"}).`
              : state.updatedAt
                ? `Last updated ${new Date(state.updatedAt).toLocaleString()}.`
                : "Never enabled — using the default (off)."}
            {" "}Every change is audited (actor, old/new state, time, global scope).
          </p>
        </div>
      )}
    </section>
  );
}
