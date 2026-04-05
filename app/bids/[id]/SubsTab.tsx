"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Trade = { id: number; name: string };
type Contact = { id: number; name: string; email: string | null; phone: string | null; isPrimary: boolean };
type SubTrade = { id: number; tradeId: number; trade: Trade };
type Subcontractor = {
  id: number;
  company: string;
  office: string | null;
  status: string;
  isUnion: boolean;
  isMWBE: boolean;
  contacts: Contact[];
  subTrades: SubTrade[];
};
type Selection = {
  id: number;
  subcontractorId: number;
  tradeId: number | null;
  subcontractor: Subcontractor;
};

export default function SubsTab({
  bidId,
  initialSelections,
}: {
  bidId: number;
  initialSelections: Selection[];
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Selection[]>(initialSelections);
  const [suggestions, setSuggestions] = useState<Subcontractor[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [adding, setAdding] = useState<number | null>(null); // subId being added
  const [removing, setRemoving] = useState<number | null>(null); // selectionId being removed

  useEffect(() => {
    setLoadingSuggestions(true);
    fetch(`/api/bids/${bidId}/suggestions`)
      .then((r) => r.json())
      .then((data) => {
        setSuggestions(data);
        setLoadingSuggestions(false);
      });
  }, [bidId, selections]);

  async function addSub(sub: Subcontractor) {
    setAdding(sub.id);
    const tradeId = sub.subTrades[0]?.tradeId ?? null;
    const res = await fetch(`/api/bids/${bidId}/selections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subcontractorId: sub.id, tradeId }),
    });
    const newSel: Selection = await res.json();
    setSelections((prev) => [...prev, newSel]);
    setAdding(null);
    router.refresh();
  }

  async function removeSub(selectionId: number) {
    setRemoving(selectionId);
    await fetch(`/api/bids/${bidId}/selections/${selectionId}`, {
      method: "DELETE",
    });
    setSelections((prev) => prev.filter((s) => s.id !== selectionId));
    setRemoving(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Selected subs */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Selected ({selections.length})
        </h2>
        {selections.length === 0 ? (
          <p className="text-sm text-zinc-400">No subs selected yet. Add from suggestions below.</p>
        ) : (
          <div className="border border-zinc-200 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 border-b border-zinc-200">Company</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Trade</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Primary Contact</th>
                  <th className="px-4 py-3 border-b border-zinc-200 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {selections.map((sel) => {
                  const sub = sel.subcontractor;
                  const contact = sub.contacts[0] ?? null;
                  const trade = sel.tradeId
                    ? sub.subTrades.find((st) => st.tradeId === sel.tradeId)?.trade
                    : sub.subTrades[0]?.trade;
                  return (
                    <tr
                      key={sel.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {sub.company}
                        {sub.office && (
                          <span className="block text-xs text-zinc-400 font-normal">
                            {sub.office}
                          </span>
                        )}
                        <div className="flex gap-1 mt-0.5">
                          {sub.isUnion && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                              Union
                            </span>
                          )}
                          {sub.isMWBE && (
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                              MWBE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {trade?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {contact ? (
                          <>
                            <span>{contact.name}</span>
                            {contact.email && (
                              <span className="block text-xs text-zinc-400">
                                {contact.email}
                              </span>
                            )}
                            {contact.phone && (
                              <span className="block text-xs text-zinc-400">
                                {contact.phone}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeSub(sel.id)}
                          disabled={removing === sel.id}
                          className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                        >
                          {removing === sel.id ? "…" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Suggested subs */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Suggested by trade
        </h2>
        {loadingSuggestions ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No additional subs found for this bid&apos;s trades.
          </p>
        ) : (
          <div className="border border-zinc-200 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 border-b border-zinc-200">Company</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Matching Trades</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Primary Contact</th>
                  <th className="px-4 py-3 border-b border-zinc-200 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((sub) => {
                  const contact = sub.contacts[0] ?? null;
                  return (
                    <tr
                      key={sub.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {sub.company}
                        {sub.office && (
                          <span className="block text-xs text-zinc-400 font-normal">
                            {sub.office}
                          </span>
                        )}
                        <div className="flex gap-1 mt-0.5">
                          {sub.isUnion && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                              Union
                            </span>
                          )}
                          {sub.isMWBE && (
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                              MWBE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {sub.subTrades.map((st) => (
                            <span
                              key={st.id}
                              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                            >
                              {st.trade.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {contact ? (
                          <>
                            <span>{contact.name}</span>
                            {contact.email && (
                              <span className="block text-xs text-zinc-400">
                                {contact.email}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => addSub(sub)}
                          disabled={adding === sub.id}
                          className="rounded-md bg-black px-3 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
                        >
                          {adding === sub.id ? "…" : "Add"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
