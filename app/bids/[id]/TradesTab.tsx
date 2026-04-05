"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Trade = { id: number; name: string; costCode?: string | null; csiCode?: string | null };
type BidTrade = { id: number; tradeId: number; trade: Trade; scopeNotes?: string | null };

export default function TradesTab({
  bidId,
  bidTrades,
}: {
  bidId: number;
  bidTrades: BidTrade[];
}) {
  const router = useRouter();
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const assignedIds = new Set(bidTrades.map((bt) => bt.tradeId));
  const available = allTrades.filter((t) => !assignedIds.has(t.id));

  useEffect(() => {
    fetch("/api/trades")
      .then((r) => r.json())
      .then(setAllTrades);
  }, []);

  async function addTrade(tradeId: number) {
    setSaving(true);
    await fetch(`/api/bids/${bidId}/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeId }),
    });
    setSaving(false);
    setAdding(false);
    router.refresh();
  }

  async function removeTrade(tradeId: number) {
    setRemoving(tradeId);
    await fetch(`/api/bids/${bidId}/trades/${tradeId}`, { method: "DELETE" });
    setRemoving(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {bidTrades.length === 0 ? (
        <p className="text-sm text-zinc-400">No trades assigned to this bid.</p>
      ) : (
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 border-b border-zinc-200">Trade</th>
                <th className="px-4 py-3 border-b border-zinc-200">Cost Code</th>
                <th className="px-4 py-3 border-b border-zinc-200">CSI</th>
                <th className="px-4 py-3 border-b border-zinc-200 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {bidTrades.map((bt) => (
                <tr key={bt.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium">{bt.trade.name}</td>
                  <td className="px-4 py-3 text-zinc-500">{bt.trade.costCode ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-500">{bt.trade.csiCode ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeTrade(bt.tradeId)}
                      disabled={removing === bt.tradeId}
                      className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {removing === bt.tradeId ? "…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <div className="border border-zinc-200 rounded-md p-4 bg-zinc-50">
          <p className="text-sm font-medium mb-3">Add a trade</p>
          {available.length === 0 ? (
            <p className="text-sm text-zinc-400">All trades already assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTrade(t.id)}
                  disabled={saving}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-black hover:text-black disabled:opacity-50"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setAdding(false)}
            className="mt-3 text-xs text-zinc-400 hover:text-zinc-600"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={() => setAdding(true)}
            className="text-sm text-zinc-500 border border-zinc-300 rounded-md px-3 py-1.5 hover:bg-zinc-50"
          >
            + Add Trade
          </button>
        </div>
      )}
    </div>
  );
}
