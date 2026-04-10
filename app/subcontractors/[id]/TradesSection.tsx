"use client";

import { useState } from "react";

type SubTrade = { id: number; tradeId: number; trade: { id: number; name: string } };
type PreferredRecord = { id: number; tradeId: number };

export default function TradesSection({
  subId,
  subTrades,
  initialPreferred,
}: {
  subId: number;
  subTrades: SubTrade[];
  initialPreferred: PreferredRecord[];
}) {
  // Map tradeId → preferredSub.id (null if not preferred)
  const [preferred, setPreferred] = useState<Record<number, number | null>>(() => {
    const map: Record<number, number | null> = {};
    for (const st of subTrades) map[st.tradeId] = null;
    for (const p of initialPreferred) map[p.tradeId] = p.id;
    return map;
  });
  const [toggling, setToggling] = useState<number | null>(null); // tradeId being toggled

  async function toggle(tradeId: number) {
    setToggling(tradeId);
    const current = preferred[tradeId];

    if (current !== null && current !== undefined) {
      // Remove preferred
      await fetch(`/api/preferred-subs/${current}`, { method: "DELETE" });
      setPreferred((prev) => ({ ...prev, [tradeId]: null }));
    } else {
      // Add preferred
      const res = await fetch("/api/preferred-subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, subcontractorId: subId }),
      });
      if (res.ok) {
        const record = await res.json();
        setPreferred((prev) => ({ ...prev, [tradeId]: record.id }));
      }
    }

    setToggling(null);
  }

  if (subTrades.length === 0) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">No trades assigned.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {subTrades.map((st) => {
        const isPreferred = preferred[st.tradeId] != null;
        const isBusy = toggling === st.tradeId;
        return (
          <div key={st.id} className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-sm text-zinc-700 dark:text-zinc-200">{st.trade.name}</span>
            <button
              onClick={() => toggle(st.tradeId)}
              disabled={isBusy}
              title={isPreferred ? "Remove preferred" : "Mark as preferred for this trade"}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                isPreferred
                  ? "bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-zinc-100 text-zinc-500 hover:bg-green-50 hover:text-green-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              <span>{isPreferred ? "★" : "☆"}</span>
              <span>{isBusy ? "…" : isPreferred ? "Preferred" : "Set preferred"}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
