"use client";

import { useEffect, useState } from "react";

type Trade = { id: number; name: string };
type TradeAssignment = { id: number; tradeId: number; trade: Trade };
type ScopeItem = {
  id: number;
  description: string;
  notes: string | null;
  isRestricted: boolean;
  tradeAssignments: TradeAssignment[];
};

export default function ScopeTab({ bidId }: { bidId: number }) {
  const [items, setItems] = useState<ScopeItem[]>([]);
  const [bidTrades, setBidTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedTradeId, setSelectedTradeId] = useState<number | "">("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/bids/${bidId}/scope`).then((r) => r.json()),
      fetch(`/api/bids/${bidId}`).then((r) => r.json()),
    ]).then(([scopeData, bidData]) => {
      setItems(scopeData);
      setBidTrades(bidData.bidTrades?.map((bt: { trade: Trade }) => bt.trade) ?? []);
      setLoading(false);
    });
  }, [bidId]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setAdding(true);
    const res = await fetch(`/api/bids/${bidId}/scope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        notes: notes || undefined,
        tradeId: selectedTradeId || undefined,
      }),
    });
    const newItem: ScopeItem = await res.json();
    setItems((prev) => [...prev, newItem]);
    setDescription("");
    setNotes("");
    setSelectedTradeId("");
    setAdding(false);
  }

  async function removeItem(itemId: number) {
    setRemoving(itemId);
    await fetch(`/api/bids/${bidId}/scope/${itemId}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setRemoving(null);
  }

  // Group items by trade (unassigned items go under a null key)
  const grouped = new Map<number | null, ScopeItem[]>();
  grouped.set(null, []);
  for (const trade of bidTrades) {
    grouped.set(trade.id, []);
  }
  for (const item of items) {
    const tradeId = item.tradeAssignments[0]?.tradeId ?? null;
    if (!grouped.has(tradeId)) grouped.set(tradeId, []);
    grouped.get(tradeId)!.push(item);
  }

  const tradeMap = new Map(bidTrades.map((t) => [t.id, t.name]));

  if (loading) {
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Add scope item form */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Add Scope Item
        </h2>
        <form onSubmit={addItem} className="flex flex-col gap-3">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scope item description…"
            rows={2}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
            required
          />
          <div className="flex gap-3">
            <select
              value={selectedTradeId}
              onChange={(e) =>
                setSelectedTradeId(
                  e.target.value === "" ? "" : parseInt(e.target.value, 10)
                )
              }
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              <option value="">No trade assigned</option>
              {bidTrades.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="submit"
              disabled={adding || !description.trim()}
              className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </section>

      {/* Scope breakdown grouped by trade */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Scope Breakdown ({items.length} items)
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No scope items yet. Add items above.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {Array.from(grouped.entries()).map(([tradeId, tradeItems]) => {
              if (tradeItems.length === 0) return null;
              const tradeName = tradeId
                ? (tradeMap.get(tradeId) ?? "Unknown Trade")
                : "Unassigned";
              return (
                <div key={tradeId ?? "unassigned"}>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                    {tradeName}
                  </h3>
                  <div className="border border-zinc-200 rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {tradeItems.map((item, idx) => (
                          <tr
                            key={item.id}
                            className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 ${
                              idx % 2 === 0 ? "" : "bg-zinc-50/40"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <p className="text-sm">{item.description}</p>
                              {item.notes && (
                                <p className="text-xs text-zinc-400 mt-0.5">
                                  {item.notes}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 w-24 text-right">
                              {item.isRestricted && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 mr-2">
                                  Restricted
                                </span>
                              )}
                              <button
                                onClick={() => removeItem(item.id)}
                                disabled={removing === item.id}
                                className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                              >
                                {removing === item.id ? "…" : "Remove"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
