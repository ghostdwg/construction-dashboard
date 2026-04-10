"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TierBadge } from "@/app/subcontractors/[id]/SubIntelligencePanel";

// ── Types ──────────────────────────────────────────────────────────────────

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

type TimelineEntry = {
  tradeId: number;
  tradeName: string;
  tier: "TIER1" | "TIER2" | "TIER3";
  rfqSendDate: string;
  quoteDueDate: string;
  daysUntilRfqSend: number;
  status: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "COMPLETE";
  urgency: string;
  rfqSentAt: string | null;
  inviteCount: number;
  estimateCount: number;
};

type TimelineSummary = {
  totalTrades: number;
  overdue: number;
  atRisk: number;
  onTrack: number;
  complete: number;
  nextActionDate: string | null;
  nextActionTrade: string | null;
};

type TimelineResponse = {
  noDueDate?: boolean;
  timeline: TimelineEntry[];
  summary: TimelineSummary | null;
  daysUntilBid: number | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const RFQ_STATUSES = [
  "no_response",
  "invited",
  "received",
  "reviewing",
  "accepted",
  "declined",
] as const;

const STATUS_PILL: Record<string, string> = {
  no_response: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  invited:     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  received:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  reviewing:   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  accepted:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  declined:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const TIMELINE_STATUS_STYLES: Record<string, string> = {
  ON_TRACK: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  AT_RISK:  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  OVERDUE:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  COMPLETE: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const TIMELINE_STATUS_LABELS: Record<string, string> = {
  ON_TRACK: "On Track",
  AT_RISK:  "At Risk",
  OVERDUE:  "Overdue",
  COMPLETE: "Complete",
};

const TIER_LABELS: Record<string, string> = {
  TIER1: "T1",
  TIER2: "T2",
  TIER3: "T3",
};

const TIER_BADGE_STYLES: Record<string, string> = {
  TIER1: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  TIER2: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  TIER3: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function RfqPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_PILL[status] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type TradeGroup = { tradeId: number | null; tradeName: string; sels: Selection[] };

function groupByTrade(selections: Selection[], tradeMap: Map<number, string>): TradeGroup[] {
  const map = new Map<number | null, Selection[]>();
  for (const sel of selections) {
    const key = sel.tradeId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(sel);
  }
  const groups: TradeGroup[] = [];
  for (const [tradeId, sels] of map) {
    const tradeName = tradeId != null ? (tradeMap.get(tradeId) ?? "Unknown Trade") : "Unassigned";
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
  if (counts.received)  parts.push(`${counts.received} received`);
  if (counts.reviewing) parts.push(`${counts.reviewing} reviewing`);
  if (counts.accepted)  parts.push(`${counts.accepted} accepted`);
  if (counts.declined)  parts.push(`${counts.declined} declined`);
  return parts.join(", ");
}

// ── Procurement Timeline Section ───────────────────────────────────────────

function ProcurementTimeline({
  bidId,
  isPublic,
}: {
  bidId: number;
  isPublic: boolean;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [marking, setMarking] = useState<number | null>(null);
  const [compliance, setCompliance] = useState<Record<number, boolean>>({});

  const loadTimeline = useCallback(() => {
    fetch(`/api/bids/${bidId}/procurement/timeline`)
      .then((r) => r.json())
      .then((d: TimelineResponse) => setData(d))
      .catch(() => {});
  }, [bidId]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  if (!data) return <div className="text-sm text-zinc-400 dark:text-zinc-500">Loading procurement timeline…</div>;
  if (data.noDueDate) return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      Set a bid due date to enable the procurement timeline.
    </div>
  );

  const { timeline, summary, daysUntilBid } = data;
  if (!summary || timeline.length === 0) return null;

  // Summary banner urgency
  const bannerClass =
    daysUntilBid != null && daysUntilBid < 7
      ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:text-red-300"
      : daysUntilBid != null && daysUntilBid <= 14
      ? "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      : "bg-zinc-50 border-zinc-200 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200";

  async function markRfqSent(tradeId: number) {
    setMarking(tradeId);
    await fetch(`/api/bids/${bidId}/trades/${tradeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqSentAt: new Date().toISOString() }),
    });
    loadTimeline();
    setMarking(null);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Procurement Timeline</h2>

      {/* Summary header */}
      <div className={`rounded-md border px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1 items-center ${bannerClass}`}>
        <span>
          <strong>{daysUntilBid != null ? daysUntilBid : "—"}</strong> days until bid
        </span>
        <span><strong>{summary.totalTrades}</strong> trades</span>
        {summary.overdue > 0 && (
          <span className="text-red-700 font-medium">{summary.overdue} overdue</span>
        )}
        {summary.atRisk > 0 && (
          <span className="text-amber-700 font-medium">{summary.atRisk} at risk</span>
        )}
        {summary.complete > 0 && (
          <span>{summary.complete} complete</span>
        )}
        {summary.nextActionTrade && summary.nextActionDate && (
          <span className="ml-auto text-xs">
            Next: <strong>{summary.nextActionTrade}</strong> RFQ by {fmtDate(summary.nextActionDate)}
          </span>
        )}
      </div>

      {/* Timeline table */}
      <div className="border border-zinc-200 rounded-md overflow-x-auto dark:border-zinc-700">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">Trade</th>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">Tier</th>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">RFQ Send</th>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">Quote Due</th>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">Invited</th>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">Estimates</th>
              <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">Status</th>
              {isPublic && (
                <th className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">DBE Outreach</th>
              )}
              <th className="px-4 py-2.5 border-b border-zinc-200 w-28 dark:border-zinc-700"></th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((entry) => {
              const rfqPast = entry.daysUntilRfqSend < 0;
              const rfqThisWeek = entry.daysUntilRfqSend >= 0 && entry.daysUntilRfqSend <= 7;
              const rfqDateClass = rfqPast
                ? "text-red-600 font-medium"
                : rfqThisWeek
                ? "text-amber-600 font-medium"
                : "text-zinc-600";

              return (
                <tr key={entry.tradeId} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                  {/* Trade */}
                  <td className="px-4 py-3 font-medium">{entry.tradeName}</td>

                  {/* Tier badge */}
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${TIER_BADGE_STYLES[entry.tier] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      {TIER_LABELS[entry.tier] ?? entry.tier}
                    </span>
                  </td>

                  {/* RFQ send date */}
                  <td className={`px-4 py-3 text-xs ${rfqDateClass}`}>
                    {entry.rfqSentAt
                      ? <span className="text-green-700">Sent {fmtDate(entry.rfqSentAt)}</span>
                      : fmtDate(entry.rfqSendDate)
                    }
                  </td>

                  {/* Quote due date */}
                  <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">{fmtDate(entry.quoteDueDate)}</td>

                  {/* Subs invited */}
                  <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">{entry.inviteCount}</td>

                  {/* Estimates in */}
                  <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">{entry.estimateCount}</td>

                  {/* Status badge */}
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TIMELINE_STATUS_STYLES[entry.status] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                      {TIMELINE_STATUS_LABELS[entry.status] ?? entry.status}
                    </span>
                  </td>

                  {/* DBE compliance checkbox — PUBLIC only */}
                  {isPublic && (
                    <td className="px-4 py-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!compliance[entry.tradeId]}
                          onChange={(e) =>
                            setCompliance((prev) => ({ ...prev, [entry.tradeId]: e.target.checked }))
                          }
                          className="rounded border-zinc-300 accent-black dark:border-zinc-600"
                        />
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Documented</span>
                      </label>
                    </td>
                  )}

                  {/* Mark RFQ Sent */}
                  <td className="px-4 py-3 text-right">
                    {entry.rfqSentAt ? (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">Sent {fmtDate(entry.rfqSentAt)}</span>
                    ) : (
                      <button
                        onClick={() => markRfqSent(entry.tradeId)}
                        disabled={marking === entry.tradeId}
                        className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {marking === entry.tradeId ? "…" : "Mark RFQ Sent"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SubsTab({
  bidId,
  initialSelections,
  bidTrades,
  projectType,
}: {
  bidId: number;
  initialSelections: Selection[];
  bidTrades: BidTrade[];
  projectType: string;
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
  const isPublic = projectType === "PUBLIC";

  useEffect(() => {
    let cancelled = false;
    // Intentional: show spinner while refetching when bidId/selections change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingSuggestions(true);
    fetch(`/api/bids/${bidId}/suggestions`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSuggestions(Array.isArray(data) ? data : []);
        setLoadingSuggestions(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions([]);
        setLoadingSuggestions(false);
      });
    return () => { cancelled = true; };
  }, [bidId, selections]);

  async function addSub(sub: Subcontractor) {
    setAdding(sub.id);
    const tradeId = sub.subTrades[0]?.tradeId ?? null;
    const res = await fetch(`/api/bids/${bidId}/selections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subcontractorId: sub.id, tradeId }),
    });
    if (res.ok) {
      const newSel: Selection = await res.json();
      setSelections((prev) => [...prev, newSel]);
      router.refresh();
    }
    setAdding(null);
  }

  async function removeSub(selectionId: number) {
    setRemoving(selectionId);
    await fetch(`/api/bids/${bidId}/selections/${selectionId}`, { method: "DELETE" });
    setSelections((prev) => prev.filter((s) => s.id !== selectionId));
    setRemoving(null);
    router.refresh();
  }

  async function exportRecipients() {
    setExporting(true);
    const res = await fetch(`/api/bids/${bidId}/export/recipients`, { method: "POST" });
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
    const res = await fetch(`/api/bids/${bidId}/sync-preferred-subs`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setSelections(data.selections);
      setLastSyncAdded(data.added);
      router.refresh();
    }
    setSyncing(false);
  }

  async function updateRfqStatus(selectionId: number, rfqStatus: string) {
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

      {/* ── Procurement Timeline ── */}
      <ProcurementTimeline bidId={bidId} isPublic={isPublic} />

      {/* ── Selected subs, grouped by trade ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              Selected ({selections.length})
            </h2>
            {lastSyncAdded !== null && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
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
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No subs selected yet. Add from suggestions below.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(({ tradeId, tradeName, sels }) => (
              <div key={tradeId ?? "unassigned"} className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
                <div className="flex items-center justify-between bg-zinc-50 border-b border-zinc-200 px-4 py-2 dark:bg-zinc-800 dark:border-zinc-700">
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{tradeName}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">{tradeSummary(sels)}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {sels.map((sel) => {
                      const sub = sel.subcontractor;
                      const contact = sub.contacts[0] ?? null;
                      return (
                        <tr key={sel.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                          <td className="px-4 py-3 font-medium w-1/3">
                            {sub.company}
                            {sub.office && (
                              <span className="block text-xs text-zinc-400 font-normal dark:text-zinc-500">{sub.office}</span>
                            )}
                            <div className="flex gap-1 mt-0.5">
                              {sub.isUnion && (
                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Union</span>
                              )}
                              {sub.isMWBE && (
                                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">MWBE</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <TierBadge tier={sub.tier} />
                          </td>
                          <td className="px-4 py-3 text-zinc-600 text-xs dark:text-zinc-300">
                            {contact ? (
                              <>
                                <span>{contact.name}</span>
                                {contact.email && (
                                  <span className="block text-zinc-400 dark:text-zinc-500">{contact.email}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-zinc-400 dark:text-zinc-500">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <RfqPill status={sel.rfqStatus} />
                              <select
                                value={sel.rfqStatus}
                                disabled={updatingRfq === sel.id}
                                onChange={(e) => updateRfqStatus(sel.id, e.target.value)}
                                className="text-xs bg-white border border-zinc-300 rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 dark:bg-zinc-900 dark:border-zinc-600"
                              >
                                {RFQ_STATUSES.map((s) => (
                                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => removeSub(sel.id)}
                              disabled={removing === sel.id}
                              className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:text-zinc-500"
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
        <h2 className="text-sm font-semibold text-zinc-700 mb-3 dark:text-zinc-200">Suggested by trade</h2>
        {loadingSuggestions ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No additional subs found for this bid&apos;s trades.</p>
        ) : (
          <div className="border border-zinc-200 rounded-md overflow-hidden dark:border-zinc-700">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Company</th>
                  <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Matching Trades</th>
                  <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Primary Contact</th>
                  <th className="px-4 py-3 border-b border-zinc-200 w-20 dark:border-zinc-700"></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((sub) => {
                  const contact = sub.contacts[0] ?? null;
                  return (
                    <tr key={sub.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                      <td className="px-4 py-3 font-medium">
                        {sub.company}
                        {sub.office && (
                          <span className="block text-xs text-zinc-400 font-normal dark:text-zinc-500">{sub.office}</span>
                        )}
                        <div className="flex gap-1 mt-0.5">
                          {sub.isUnion && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Union</span>
                          )}
                          {sub.isMWBE && (
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">MWBE</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {sub.subTrades.map((st) => (
                            <span key={st.id} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {st.trade.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                        {contact ? (
                          <>
                            <span>{contact.name}</span>
                            {contact.email && (
                              <span className="block text-xs text-zinc-400 dark:text-zinc-500">{contact.email}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-zinc-400 dark:text-zinc-500">—</span>
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
