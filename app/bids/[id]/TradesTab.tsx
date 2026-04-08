"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type Trade = { id: number; name: string; costCode?: string | null; csiCode?: string | null };
type BidTrade = { id: number; tradeId: number; trade: Trade; scopeNotes?: string | null };

type TimelineEntry = {
  tradeId: number;
  tier: string;
  rfqSendDate: string;
  rfqSentAt: string | null;
  daysUntilRfqSend: number;
  status: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "COMPLETE";
  urgency: string;
};

type TimelineResponse = {
  noDueDate?: boolean;
  timeline: TimelineEntry[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ON_TRACK: "bg-green-100 text-green-700",
  AT_RISK:  "bg-amber-100 text-amber-700",
  OVERDUE:  "bg-red-100 text-red-700",
  COMPLETE: "bg-zinc-100 text-zinc-500",
};

const STATUS_LABELS: Record<string, string> = {
  ON_TRACK: "On Track",
  AT_RISK:  "At Risk",
  OVERDUE:  "Overdue",
  COMPLETE: "Complete",
};

const TIER_OPTIONS = [
  { value: "TIER1", label: "Tier 1" },
  { value: "TIER2", label: "Tier 2" },
  { value: "TIER3", label: "Tier 3" },
];

function fmt(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Component ──────────────────────────────────────────────────────────────

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

  // Timeline state
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [noDueDate, setNoDueDate] = useState(false);
  const [timelineLoaded, setTimelineLoaded] = useState(false);

  // Per-trade local state for tier/leadTime (optimistic)
  const [tiers, setTiers] = useState<Record<number, string>>({});
  const [leadTimes, setLeadTimes] = useState<Record<number, string>>({});
  const [patchingTrade, setPatchingTrade] = useState<number | null>(null);

  const leadTimeRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const assignedIds = new Set(bidTrades.map((bt) => bt.tradeId));
  const available = allTrades.filter((t) => !assignedIds.has(t.id));

  // Load all trades
  useEffect(() => {
    fetch("/api/trades")
      .then((r) => r.json())
      .then(setAllTrades);
  }, []);

  // Load timeline
  useEffect(() => {
    fetch(`/api/bids/${bidId}/procurement/timeline`)
      .then((r) => r.json())
      .then((data: TimelineResponse) => {
        setNoDueDate(!!data.noDueDate);
        setTimeline(data.timeline ?? []);
        // Seed tier state from timeline response
        const initialTiers: Record<number, string> = {};
        const initialLeadTimes: Record<number, string> = {};
        for (const entry of data.timeline ?? []) {
          initialTiers[entry.tradeId] = entry.tier;
        }
        setTiers(initialTiers);
        setLeadTimes(initialLeadTimes);
        setTimelineLoaded(true);
      })
      .catch(() => setTimelineLoaded(true));
  }, [bidId]);

  const timelineByTradeId = new Map(timeline.map((e) => [e.tradeId, e]));

  async function patchTrade(tradeId: number, body: Record<string, unknown>) {
    setPatchingTrade(tradeId);
    await fetch(`/api/bids/${bidId}/trades/${tradeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Reload timeline to get recalculated dates
    const res = await fetch(`/api/bids/${bidId}/procurement/timeline`);
    const data: TimelineResponse = await res.json();
    setTimeline(data.timeline ?? []);
    setPatchingTrade(null);
  }

  async function handleTierChange(tradeId: number, tier: string) {
    setTiers((prev) => ({ ...prev, [tradeId]: tier }));
    await patchTrade(tradeId, { tier });
  }

  async function handleLeadTimeBlur(tradeId: number) {
    const raw = leadTimes[tradeId] ?? "";
    const val = raw === "" ? null : parseInt(raw, 10);
    if (raw !== "" && (isNaN(val!) || val! < 1)) return;
    await patchTrade(tradeId, { leadTimeDays: val });
  }

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

      {/* No due date warning */}
      {timelineLoaded && noDueDate && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Set a bid due date to enable procurement timeline.
        </div>
      )}

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
                <th className="px-4 py-3 border-b border-zinc-200">Tier</th>
                <th className="px-4 py-3 border-b border-zinc-200">Lead Days</th>
                {!noDueDate && (
                  <th className="px-4 py-3 border-b border-zinc-200">Timeline</th>
                )}
                <th className="px-4 py-3 border-b border-zinc-200 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {bidTrades.map((bt) => {
                const entry = timelineByTradeId.get(bt.tradeId);
                const tier = tiers[bt.tradeId] ?? "TIER2";
                const leadTime = leadTimes[bt.tradeId] ?? "";
                const isPatching = patchingTrade === bt.tradeId;

                return (
                  <tr key={bt.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    {/* Trade name */}
                    <td className="px-4 py-3 font-medium">{bt.trade.name}</td>

                    {/* Cost code */}
                    <td className="px-4 py-3 text-zinc-500">{bt.trade.costCode ?? "—"}</td>

                    {/* CSI */}
                    <td className="px-4 py-3 text-zinc-500">{bt.trade.csiCode ?? "—"}</td>

                    {/* Tier selector */}
                    <td className="px-4 py-3">
                      <select
                        value={tier}
                        disabled={isPatching}
                        onChange={(e) => handleTierChange(bt.tradeId, e.target.value)}
                        className="text-xs border border-zinc-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50 bg-white"
                      >
                        {TIER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>

                    {/* Lead time input */}
                    <td className="px-4 py-3">
                      <input
                        ref={(el) => { leadTimeRefs.current[bt.tradeId] = el; }}
                        type="number"
                        min={1}
                        placeholder="—"
                        value={leadTime}
                        disabled={isPatching}
                        onChange={(e) =>
                          setLeadTimes((prev) => ({ ...prev, [bt.tradeId]: e.target.value }))
                        }
                        onBlur={() => handleLeadTimeBlur(bt.tradeId)}
                        className="w-16 text-xs border border-zinc-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
                      />
                    </td>

                    {/* Timeline status + RFQ date */}
                    {!noDueDate && (
                      <td className="px-4 py-3">
                        {!timelineLoaded ? (
                          <span className="text-xs text-zinc-400">…</span>
                        ) : entry ? (
                          <div className="flex flex-col gap-1">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium w-fit ${STATUS_STYLES[entry.status] ?? "bg-zinc-100 text-zinc-500"}`}
                            >
                              {STATUS_LABELS[entry.status] ?? entry.status}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {entry.rfqSentAt
                                ? `RFQ sent ${fmt(entry.rfqSentAt)}`
                                : `RFQ due ${fmt(entry.rfqSendDate)}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                    )}

                    {/* Remove */}
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
                );
              })}
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
