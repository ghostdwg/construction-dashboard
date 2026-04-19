"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { classifyTradeTier, type TierClassification } from "@/lib/services/procurement/classifyTradeTier";

// ── Types ──────────────────────────────────────────────────────────────────

type Trade = { id: number; name: string; costCode?: string | null; csiCode?: string | null };
type BidTrade = { id: number; tradeId: number; trade: Trade; scopeNotes?: string | null };

type TimelineEntry = {
  tradeId: number;
  tier: string;
  leadTimeDays: number | null;
  rfqSendDate: string;
  rfqSentAt: string | null;
  daysUntilRfqSend: number;
  status: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "COMPLETE";
  urgency: string;
};

type TimelineResponse = {
  noDueDate?: boolean;
  timeline: TimelineEntry[];
  daysUntilBid?: number | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ON_TRACK: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  AT_RISK:  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  OVERDUE:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  COMPLETE: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
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

const TIER_LABELS: Record<string, string> = {
  TIER1: "Tier 1",
  TIER2: "Tier 2",
  TIER3: "Tier 3",
};

// Typical lead days per tier (from calculateTimeline BASE_OFFSETS)
const TIER_TYPICAL_LEAD: Record<string, number> = {
  TIER1: 14,
  TIER2: 10,
  TIER3: 7,
};

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
  const [daysUntilBid, setDaysUntilBid] = useState<number | null>(null);

  // Per-trade local state for tier/leadTime (optimistic)
  const [tiers, setTiers] = useState<Record<number, string>>({});
  const [leadTimes, setLeadTimes] = useState<Record<number, string>>({});
  const [patchingTrade, setPatchingTrade] = useState<number | null>(null);

  // Auto-suggest state
  const [suggestions, setSuggestions] = useState<Record<number, TierClassification>>({});
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<number>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);

  const leadTimeRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const assignedIds = new Set(bidTrades.map((bt) => bt.tradeId));
  const available = allTrades.filter((t) => !assignedIds.has(t.id));

  // Load all trades
  useEffect(() => {
    fetch("/api/trades")
      .then((r) => r.json())
      .then(setAllTrades)
      .catch(console.error);
  }, []);

  // Load timeline
  useEffect(() => {
    fetch(`/api/bids/${bidId}/procurement/timeline`)
      .then((r) => r.json())
      .then((data: TimelineResponse) => {
        setNoDueDate(!!data.noDueDate);
        setTimeline(data.timeline ?? []);
        setDaysUntilBid(data.daysUntilBid ?? null);
        // Seed tier state from timeline response
        const initialTiers: Record<number, string> = {};
        for (const entry of data.timeline ?? []) {
          initialTiers[entry.tradeId] = entry.tier;
        }
        setTiers(initialTiers);
        setLeadTimes({});
        setTimelineLoaded(true);
      })
      .catch(() => setTimelineLoaded(true));
  }, [bidId]);

  // Compute suggestions whenever bidTrades changes
  useEffect(() => {
    const map: Record<number, TierClassification> = {};
    for (const bt of bidTrades) {
      map[bt.tradeId] = classifyTradeTier(bt.trade.name);
    }
    setSuggestions(map);
  }, [bidTrades]);

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
    setDaysUntilBid(data.daysUntilBid ?? null);
    setPatchingTrade(null);
  }

  async function handleTierChange(tradeId: number, tier: string) {
    setTiers((prev) => ({ ...prev, [tradeId]: tier }));
    // Dismiss suggestion when user explicitly picks a tier
    setDismissedSuggestions((prev) => new Set(prev).add(tradeId));
    await patchTrade(tradeId, { tier });
  }

  async function handleApplySuggestion(tradeId: number, suggestedTier: string) {
    setTiers((prev) => ({ ...prev, [tradeId]: suggestedTier }));
    setDismissedSuggestions((prev) => new Set(prev).add(tradeId));
    await patchTrade(tradeId, { tier: suggestedTier });
  }

  function handleDismissSuggestion(tradeId: number) {
    setDismissedSuggestions((prev) => new Set(prev).add(tradeId));
  }

  async function handleBulkApply() {
    setBulkApplying(true);
    const toApply = bidTrades.filter((bt) => {
      const suggestion = suggestions[bt.tradeId];
      const currentTier = tiers[bt.tradeId] ?? "TIER2";
      return suggestion && suggestion.suggestedTier !== currentTier && !dismissedSuggestions.has(bt.tradeId);
    });
    const newDismissed = new Set(dismissedSuggestions);
    const newTiers = { ...tiers };
    for (const bt of toApply) {
      const suggestedTier = suggestions[bt.tradeId].suggestedTier;
      newTiers[bt.tradeId] = suggestedTier;
      newDismissed.add(bt.tradeId);
      await fetch(`/api/bids/${bidId}/trades/${bt.tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: suggestedTier }),
      });
    }
    setTiers(newTiers);
    setDismissedSuggestions(newDismissed);
    // Reload timeline after all patches
    const res = await fetch(`/api/bids/${bidId}/procurement/timeline`);
    const data: TimelineResponse = await res.json();
    setTimeline(data.timeline ?? []);
    setDaysUntilBid(data.daysUntilBid ?? null);
    setBulkApplying(false);
    setShowBulkModal(false);
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

  // ── Tier health panel data ────────────────────────────────────────────────

  const tradesByTier: Record<string, BidTrade[]> = { TIER1: [], TIER2: [], TIER3: [] };
  for (const bt of bidTrades) {
    const t = tiers[bt.tradeId] ?? "TIER2";
    (tradesByTier[t] ??= []).push(bt);
  }

  const unreviewedTrades = bidTrades.filter((bt) => {
    const suggestion = suggestions[bt.tradeId];
    const currentTier = tiers[bt.tradeId] ?? "TIER2";
    return suggestion && suggestion.suggestedTier !== currentTier && !dismissedSuggestions.has(bt.tradeId);
  });

  function tierPanelColor(tierVal: string): "red" | "amber" | "green" | "gray" {
    const trades = tradesByTier[tierVal] ?? [];
    if (trades.length === 0) return "gray";
    let hasOverdue = false;
    let hasAtRisk = false;
    for (const bt of trades) {
      const entry = timelineByTradeId.get(bt.tradeId);
      if (entry?.status === "OVERDUE") hasOverdue = true;
      if (entry?.status === "AT_RISK") hasAtRisk = true;
    }
    if (hasOverdue) return "red";
    if (hasAtRisk) return "amber";
    return "green";
  }

  const PANEL_HEADER_STYLES: Record<string, string> = {
    red:   "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    amber: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    green: "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    gray:  "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900/40 dark:text-zinc-400",
  };

  return (
    <div className="flex flex-col gap-4">

      {/* No due date warning */}
      {timelineLoaded && noDueDate && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Set a bid due date to enable procurement timeline.
        </div>
      )}

      {/* Tier Health Panel */}
      {timelineLoaded && bidTrades.length > 0 && (
        <div className="flex flex-col gap-2">

          {/* Untiered warning */}
          {unreviewedTrades.length > 0 && (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <span>
                {unreviewedTrades.length} trade{unreviewedTrades.length !== 1 ? "s" : ""} pending tier review
              </span>
              <button
                onClick={() => setShowBulkModal(true)}
                className="text-xs font-medium underline hover:no-underline"
              >
                Auto-suggest tiers
              </button>
            </div>
          )}

          {/* Three-column grid */}
          <div className="grid grid-cols-3 gap-3">
            {(["TIER1", "TIER2", "TIER3"] as const).map((tierVal) => {
              const tierTrades = tradesByTier[tierVal] ?? [];
              const color = tierPanelColor(tierVal);
              const headerStyle = PANEL_HEADER_STYLES[color];
              const rfqSentCount = tierTrades.filter((bt) => !!timelineByTradeId.get(bt.tradeId)?.rfqSentAt).length;
              const overdueCount = tierTrades.filter((bt) => timelineByTradeId.get(bt.tradeId)?.status === "OVERDUE").length;
              const longestLead = tierTrades.reduce((max, bt) => {
                const entry = timelineByTradeId.get(bt.tradeId);
                const days = entry?.leadTimeDays ?? (TIER_TYPICAL_LEAD[tierVal] ?? 10);
                return Math.max(max, days);
              }, 0);

              return (
                <div key={tierVal} className="rounded-md border border-zinc-200 overflow-hidden text-sm dark:border-zinc-700">
                  <div className={`px-3 py-2 border-b font-semibold text-xs uppercase tracking-wide ${headerStyle}`}>
                    {TIER_LABELS[tierVal]}
                  </div>
                  <div className="px-3 py-2 flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                    <div>{tierTrades.length} trade{tierTrades.length !== 1 ? "s" : ""}</div>
                    {tierVal === "TIER1" ? (
                      <>
                        <div className={unreviewedTrades.filter((bt) => (tiers[bt.tradeId] ?? "TIER2") === tierVal || suggestions[bt.tradeId]?.suggestedTier === tierVal).length > 0 ? "text-amber-600" : ""}>
                          {unreviewedTrades.filter((bt) => suggestions[bt.tradeId]?.suggestedTier === tierVal).length} untiered
                        </div>
                        <div className={overdueCount > 0 ? "text-red-600 font-medium" : ""}>
                          {overdueCount} RFQ{overdueCount !== 1 ? "s" : ""} overdue
                        </div>
                        {tierTrades.length > 0 && !noDueDate && (
                          <div className="text-zinc-400 dark:text-zinc-500">Longest lead: {longestLead}d</div>
                        )}
                      </>
                    ) : (
                      <>
                        <div>{rfqSentCount} RFQ{rfqSentCount !== 1 ? "s" : ""} sent</div>
                        <div className={overdueCount > 0 ? "text-red-600 font-medium" : ""}>
                          {overdueCount} overdue
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk apply modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg border border-zinc-200 shadow-xl p-6 max-w-sm w-full mx-4 dark:bg-zinc-900 dark:border-zinc-700">
            <p className="text-sm font-semibold mb-1">Apply suggested tiers?</p>
            <p className="text-sm text-zinc-500 mb-4 dark:text-zinc-400">
              Apply suggested tiers to {unreviewedTrades.length} trade{unreviewedTrades.length !== 1 ? "s" : ""}?
              You can adjust individually after.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowBulkModal(false)}
                disabled={bulkApplying}
                className="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkApply}
                disabled={bulkApplying}
                className="text-sm font-medium bg-black text-white px-4 py-1.5 rounded-md hover:bg-zinc-800 disabled:opacity-50"
              >
                {bulkApplying ? "Applying…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bidTrades.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No trades assigned to this bid.</p>
      ) : (
        <div className="border border-zinc-200 rounded-md overflow-hidden dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Trade</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Cost Code</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">CSI</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Tier</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Lead Days</th>
                {!noDueDate && (
                  <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Timeline</th>
                )}
                <th className="px-4 py-3 border-b border-zinc-200 w-16 dark:border-zinc-700"></th>
              </tr>
            </thead>
            <tbody>
              {bidTrades.map((bt) => {
                const entry = timelineByTradeId.get(bt.tradeId);
                const tier = tiers[bt.tradeId] ?? "TIER2";
                const leadTime = leadTimes[bt.tradeId] ?? "";
                const isPatching = patchingTrade === bt.tradeId;

                // Auto-suggest
                const suggestion = suggestions[bt.tradeId];
                const showSuggestion =
                  suggestion != null &&
                  suggestion.suggestedTier !== tier &&
                  !dismissedSuggestions.has(bt.tradeId);

                // Lead time guidance
                const typicalLead = TIER_TYPICAL_LEAD[tier] ?? 10;
                const customLeadDays = leadTime !== "" ? parseInt(leadTime, 10) : null;
                const hasCustomLead = customLeadDays != null && !isNaN(customLeadDays) && customLeadDays > typicalLead;
                const rfqOverdue = entry?.status === "OVERDUE" && !entry?.rfqSentAt;

                return (
                  <tr key={bt.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                    {/* Trade name + critical path badge */}
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{bt.trade.name}</span>
                        {tier === "TIER1" && (
                          <span
                            title="This trade is on the critical path. Late quotes or scope gaps here delay the entire bid."
                            className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700 cursor-help leading-none dark:bg-violet-900/40 dark:text-violet-300"
                          >
                            Critical Path
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Cost code */}
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{bt.trade.costCode ?? "—"}</td>

                    {/* CSI */}
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{bt.trade.csiCode ?? "—"}</td>

                    {/* Tier selector + auto-suggest hint */}
                    <td className="px-4 py-3">
                      <select
                        value={tier}
                        disabled={isPatching}
                        onChange={(e) => handleTierChange(bt.tradeId, e.target.value)}
                        className="text-xs bg-white border border-zinc-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 bg-white dark:bg-zinc-900 dark:border-zinc-600"
                      >
                        {TIER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                      {showSuggestion && (
                        <div className="mt-1.5 text-[11px] text-zinc-500 leading-tight dark:text-zinc-400">
                          <span className="text-zinc-600 dark:text-zinc-300">
                            Suggested: {TIER_LABELS[suggestion.suggestedTier]} —{" "}
                            {suggestion.reason}
                          </span>
                          <div className="flex gap-2 mt-1">
                            <button
                              onClick={() => handleApplySuggestion(bt.tradeId, suggestion.suggestedTier)}
                              disabled={isPatching}
                              className="text-blue-600 hover:underline disabled:opacity-50"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => handleDismissSuggestion(bt.tradeId)}
                              className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Lead time input + guidance */}
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
                        className="w-16 text-xs bg-white border border-zinc-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 dark:bg-zinc-900 dark:border-zinc-600"
                      />

                      {/* Lead time guidance — only when due date is set */}
                      {timelineLoaded && !noDueDate && entry && (
                        <div className="mt-1 text-[11px] leading-snug">
                          {rfqOverdue && daysUntilBid != null ? (
                            <span className="text-red-600">
                              Warning: only {daysUntilBid}d until bid —{" "}
                              {TIER_LABELS[tier]} typically needs {typicalLead}d. RFQ is overdue.
                            </span>
                          ) : hasCustomLead ? (
                            <span className="text-zinc-400 dark:text-zinc-500">
                              Custom lead time set — timeline adjusted
                            </span>
                          ) : (
                            <span className="text-zinc-400 dark:text-zinc-500">
                              Typical for {TIER_LABELS[tier]}: {typicalLead}d
                              {entry.rfqSendDate && (
                                <> · RFQ by {fmt(entry.rfqSendDate)}</>
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Timeline status + RFQ date */}
                    {!noDueDate && (
                      <td className="px-4 py-3">
                        {!timelineLoaded ? (
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">…</span>
                        ) : entry ? (
                          <div className="flex flex-col gap-1">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium w-fit ${STATUS_STYLES[entry.status] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
                            >
                              {STATUS_LABELS[entry.status] ?? entry.status}
                            </span>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                              {entry.rfqSentAt
                                ? `RFQ sent ${fmt(entry.rfqSentAt)}`
                                : `RFQ due ${fmt(entry.rfqSendDate)}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>
                        )}
                      </td>
                    )}

                    {/* Remove */}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeTrade(bt.tradeId)}
                        disabled={removing === bt.tradeId}
                        className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:text-zinc-500"
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
        <div className="border border-zinc-200 rounded-md p-4 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-sm font-medium mb-3">Add a trade</p>
          {available.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">All trades already assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTrade(t.id)}
                  disabled={saving}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-black hover:text-black disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setAdding(false)}
            className="mt-3 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={() => setAdding(true)}
            className="text-sm text-zinc-500 border border-zinc-300 rounded-md px-3 py-1.5 hover:bg-zinc-50 dark:text-zinc-400 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            + Add Trade
          </button>
        </div>
      )}
    </div>
  );
}
