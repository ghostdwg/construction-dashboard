"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TierBadge } from "@/app/subcontractors/[id]/SubIntelligencePanel";

// ---- Types ----

type Trade = { id: number; name: string };
type Contact = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};
type SubTrade = { id: number; tradeId: number; trade: Trade };
type Subcontractor = {
  id: number;
  company: string;
  office: string | null;
  status: string;
  tier: string;
  isUnion: boolean;
  isMWBE: boolean;
  contacts: Contact[];
  subTrades: SubTrade[];
};
type Selection = {
  id: number;
  subcontractorId: number;
  tradeId: number | null;
  rfqStatus: string;
  subcontractor: Subcontractor;
};
type BidTrade = { id: number; tradeId: number; trade: Trade };

// ---- Constants ----

const RFQ_STATUSES = [
  "no_response",
  "invited",
  "received",
  "reviewing",
  "accepted",
  "declined",
] as const;

const STATUS_PILL: Record<string, string> = {
  no_response: "bg-zinc-100 text-zinc-500",
  invited: "bg-blue-100 text-blue-700",
  received: "bg-amber-100 text-amber-700",
  reviewing: "bg-purple-100 text-purple-700",
  accepted: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
};

// ---- Helpers ----

function RfqPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        STATUS_PILL[status] ?? "bg-zinc-100 text-zinc-500"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

type TradeGroup = {
  tradeId: number | null;
  tradeName: string;
  sels: Selection[];
};

function groupByTrade(
  selections: Selection[],
  tradeMap: Map<number, string>
): TradeGroup[] {
  const map = new Map<number | null, Selection[]>();
  for (const sel of selections) {
    const key = sel.tradeId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(sel);
  }
  const groups: TradeGroup[] = [];
  for (const [tradeId, sels] of map) {
    const tradeName =
      tradeId != null
        ? (tradeMap.get(tradeId) ?? "Unknown Trade")
        : "Unassigned";
    groups.push({ tradeId, tradeName, sels });
  }
  groups.sort((a, b) => {
    if (a.tradeId === null) return 1;
    if (b.tradeId === null) return -1;
    return a.tradeName.localeCompare(b.tradeName);
  });
  return groups;
}

function tradeSummary(sels: Selection[]): string {
  const counts: Record<string, number> = {};
  for (const s of sels) counts[s.rfqStatus] = (counts[s.rfqStatus] ?? 0) + 1;
  const parts = [`${sels.length} invited`];
  if (counts.received) parts.push(`${counts.received} received`);
  if (counts.reviewing) parts.push(`${counts.reviewing} reviewing`);
  if (counts.accepted) parts.push(`${counts.accepted} accepted`);
  if (counts.declined) parts.push(`${counts.declined} declined`);
  return parts.join(", ");
}

// ---- Component ----

export default function SubsTab({
  bidId,
  initialSelections,
  bidTrades,
}: {
  bidId: number;
  initialSelections: Selection[];
  bidTrades: BidTrade[];
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Selection[]>(initialSelections);
  const [suggestions, setSuggestions] = useState<Subcontractor[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [updatingRfq, setUpdatingRfq] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAdded, setLastSyncAdded] = useState<number | null>(null);

  const tradeMap = new Map(bidTrades.map((bt) => [bt.tradeId, bt.trade.name]));

  useEffect(() => {
    setLoadingSuggestions(true);
    fetch(`/api/bids/${bidId}/suggestions`)
      .then((r) => r.json())
      .then((data) => {
        setSuggestions(Array.isArray(data) ? data : []);
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

  async function exportRecipients() {
    setExporting(true);
    const res = await fetch(`/api/bids/${bidId}/export/recipients`, {
      method: "POST",
    });
    if (res.ok) {
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : "recipients.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
    setExporting(false);
  }

  async function syncPreferredSubs() {
    setSyncing(true);
    setLastSyncAdded(null);
    const res = await fetch(`/api/bids/${bidId}/sync-preferred-subs`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      setSelections(data.selections);
      setLastSyncAdded(data.added);
      router.refresh();
    }
    setSyncing(false);
  }

  async function updateRfqStatus(selectionId: number, rfqStatus: string) {
    // Optimistic update first
    setSelections((prev) =>
      prev.map((s) => (s.id === selectionId ? { ...s, rfqStatus } : s))
    );
    setUpdatingRfq(selectionId);
    await fetch(`/api/bid-invite-selections/${selectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqStatus }),
    });
    setUpdatingRfq(null);
  }

  const groups = groupByTrade(selections, tradeMap);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Selected subs, grouped by trade ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-700">
              Selected ({selections.length})
            </h2>
            {lastSyncAdded !== null && (
              <span className="text-xs text-zinc-400">
                {lastSyncAdded === 0
                  ? "Already up to date"
                  : `${lastSyncAdded} preferred sub${lastSyncAdded === 1 ? "" : "s"} added`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={syncPreferredSubs}
              disabled={syncing}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync preferred subs"}
            </button>
            {selections.length > 0 && (
              <button
                onClick={exportRecipients}
                disabled={exporting}
                className="rounded-md bg-black px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Export to Excel"}
              </button>
            )}
          </div>
        </div>

        {selections.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No subs selected yet. Add from suggestions below.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(({ tradeId, tradeName, sels }) => (
              <div
                key={tradeId ?? "unassigned"}
                className="rounded-md border border-zinc-200 overflow-hidden"
              >
                {/* Trade header with summary */}
                <div className="flex items-center justify-between bg-zinc-50 border-b border-zinc-200 px-4 py-2">
                  <span className="text-sm font-semibold text-zinc-700">
                    {tradeName}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {tradeSummary(sels)}
                  </span>
                </div>

                {/* Sub rows */}
                <table className="w-full text-sm">
                  <tbody>
                    {sels.map((sel) => {
                      const sub = sel.subcontractor;
                      const contact = sub.contacts[0] ?? null;
                      return (
                        <tr
                          key={sel.id}
                          className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                        >
                          {/* Company + tags */}
                          <td className="px-4 py-3 font-medium w-1/3">
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

                          {/* Tier */}
                          <td className="px-4 py-3">
                            <TierBadge tier={sub.tier} />
                          </td>

                          {/* Contact */}
                          <td className="px-4 py-3 text-zinc-600 text-xs">
                            {contact ? (
                              <>
                                <span>{contact.name}</span>
                                {contact.email && (
                                  <span className="block text-zinc-400">
                                    {contact.email}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>

                          {/* RFQ status — pill + select */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <RfqPill status={sel.rfqStatus} />
                              <select
                                value={sel.rfqStatus}
                                disabled={updatingRfq === sel.id}
                                onChange={(e) =>
                                  updateRfqStatus(sel.id, e.target.value)
                                }
                                className="text-xs border border-zinc-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
                              >
                                {RFQ_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {s.replace(/_/g, " ")}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Remove */}
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
            ))}
          </div>
        )}
      </section>

      {/* ── Suggested subs ── */}
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
                  <th className="px-4 py-3 border-b border-zinc-200">
                    Company
                  </th>
                  <th className="px-4 py-3 border-b border-zinc-200">
                    Matching Trades
                  </th>
                  <th className="px-4 py-3 border-b border-zinc-200">
                    Primary Contact
                  </th>
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
