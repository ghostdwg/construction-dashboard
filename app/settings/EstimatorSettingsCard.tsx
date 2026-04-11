"use client";

// Module SET1 — Estimator profile card
//
// Just renders the two estimator settings (name + email). Used as defaults
// in the Send RFQ modal.

import { useEffect, useState } from "react";
import SettingFieldRow, { type SettingItem } from "./SettingFieldRow";

export default function EstimatorSettingsCard() {
  const [items, setItems] = useState<SettingItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/app?category=estimator");
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

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }
  if (error || !items) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {error ?? "Failed to load"}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
        Estimator Profile
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        Used as defaults when sending RFQ emails. Your name appears as the
        sender; your email is the reply-to address subs see.
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
  );
}
