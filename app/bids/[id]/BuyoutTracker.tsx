"use client";

// Module H2 — Buyout Tracker UI
//
// Rendered as a section on the Handoff tab, right below Trade Awards.
// Shows:
//   1. Rollup card — total committed, paid, remaining, retainage, status counts
//   2. Editable table — one row per BidTrade with inline-editable fields:
//        committed amount, PO#, contract status, paid-to-date, notes
//
// Auto-creates BuyoutItem rows on first load via the GET endpoint. Each row
// stages its own edits in local state and shows a Save button only when dirty.

import { useEffect, useState } from "react";

// ── Types (mirror lib/services/buyout/buyoutService.ts) ────────────────────

const CONTRACT_STATUSES = [
  "PENDING",
  "LOI_SENT",
  "CONTRACT_SENT",
  "CONTRACT_SIGNED",
  "PO_ISSUED",
  "ACTIVE",
  "CLOSED",
] as const;

type ContractStatus = (typeof CONTRACT_STATUSES)[number];

const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  PENDING: "Pending",
  LOI_SENT: "LOI Sent",
  CONTRACT_SENT: "Contract Sent",
  CONTRACT_SIGNED: "Contract Signed",
  PO_ISSUED: "PO Issued",
  ACTIVE: "Active",
  CLOSED: "Closed",
};

const CONTRACT_STATUS_STYLES: Record<ContractStatus, string> = {
  PENDING:         "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  LOI_SENT:        "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  CONTRACT_SENT:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  CONTRACT_SIGNED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  PO_ISSUED:       "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  ACTIVE:          "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  CLOSED:          "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
};

type BuyoutItem = {
  id: number;
  bidTradeId: number;
  tradeId: number;
  tradeName: string;
  csiCode: string | null;
  tier: string;

  subcontractorId: number | null;
  subcontractorName: string | null;

  committedAmount: number | null;
  originalBidAmount: number | null;

  contractStatus: ContractStatus;
  loiSentAt: string | null;
  contractSentAt: string | null;
  contractSignedAt: string | null;
  poNumber: string | null;
  poIssuedAt: string | null;

  changeOrderAmount: number;
  paidToDate: number;
  retainagePercent: number;

  totalCommitted: number;
  remainingToPay: number;
  retainageHeld: number;

  notes: string | null;
};

type BuyoutRollup = {
  tradeCount: number;
  tradesCommitted: number;
  tradesAwarded: number;
  totalCommitted: number;
  totalPaid: number;
  totalRemaining: number;
  totalRetainageHeld: number;
  byStatus: Record<ContractStatus, number>;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDollar(n: number): string {
  if (n === 0) return "$0";
  return "$" + Math.round(n).toLocaleString();
}

function parseDollarInput(v: string): number | null {
  const cleaned = v.replace(/[^\d.]/g, "");
  if (cleaned === "") return null;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function BuyoutTracker({
  bidId,
  onChanged,
  refreshKey = 0,
}: {
  bidId: number;
  /** Called after a buyout row is saved — parent should refetch dependent data. */
  onChanged?: () => void;
  /** Bump this to force a reload from the parent. */
  refreshKey?: number;
}) {
  const [items, setItems] = useState<BuyoutItem[] | null>(null);
  const [rollup, setRollup] = useState<BuyoutRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local tick bumped after save → triggers a reload of this component's data
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/buyout`, { signal: controller.signal });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { items: BuyoutItem[]; rollup: BuyoutRollup };
        if (cancelled) return;
        setItems(data.items);
        setRollup(data.rollup);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bidId, reloadTick, refreshKey]);

  if (loading) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading buyout tracker…</p>
      </section>
    );
  }
  if (error || !items || !rollup) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {error ?? "Failed to load buyout tracker"}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Buyout Tracker ({rollup.tradeCount})
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Committed amounts, contract lifecycle, and payment tracking per trade.
        </p>
      </div>

      {/* ── Rollup card ── */}
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <RollupStat
            label="Total Committed"
            value={fmtDollar(rollup.totalCommitted)}
            sub={`${rollup.tradesCommitted} of ${rollup.tradeCount} trades`}
          />
          <RollupStat
            label="Paid to Date"
            value={fmtDollar(rollup.totalPaid)}
          />
          <RollupStat
            label="Remaining"
            value={fmtDollar(rollup.totalRemaining)}
          />
          <RollupStat
            label="Retainage Held"
            value={fmtDollar(rollup.totalRetainageHeld)}
          />
        </div>
      </div>

      {/* ── Editable rows ── */}
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-500 italic dark:text-zinc-400">
          No trades yet. Add trades on the Trades tab.
        </p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((item) => (
            <BuyoutRow
              key={item.id}
              bidId={bidId}
              item={item}
              onSaved={() => {
                setReloadTick((t) => t + 1);
                onChanged?.();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Rollup Stat ────────────────────────────────────────────────────────────

function RollupStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
        {value}
      </p>
      {sub && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{sub}</p>
      )}
    </div>
  );
}

// ── Editable Row ───────────────────────────────────────────────────────────

type RowDraft = {
  committedAmount: string; // controlled text input
  poNumber: string;
  contractStatus: ContractStatus;
  paidToDate: string;
  notes: string;
};

function toDraft(item: BuyoutItem): RowDraft {
  return {
    committedAmount: item.committedAmount != null ? String(item.committedAmount) : "",
    poNumber: item.poNumber ?? "",
    contractStatus: item.contractStatus,
    paidToDate: item.paidToDate > 0 ? String(item.paidToDate) : "",
    notes: item.notes ?? "",
  };
}

function BuyoutRow({
  bidId,
  item,
  onSaved,
}: {
  bidId: number;
  item: BuyoutItem;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RowDraft>(() => toDraft(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Re-seed draft when item refreshes
  useEffect(() => {
    setDraft(toDraft(item));
  }, [item]);

  const clean = toDraft(item);
  const isDirty =
    draft.committedAmount !== clean.committedAmount ||
    draft.poNumber !== clean.poNumber ||
    draft.contractStatus !== clean.contractStatus ||
    draft.paidToDate !== clean.paidToDate ||
    draft.notes !== clean.notes;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const committed = parseDollarInput(draft.committedAmount);
      const paid = parseDollarInput(draft.paidToDate);

      const res = await fetch(`/api/bids/${bidId}/buyout/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          committedAmount: committed,
          poNumber: draft.poNumber || null,
          contractStatus: draft.contractStatus,
          paidToDate: paid ?? 0,
          notes: draft.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const statusStyle = CONTRACT_STATUS_STYLES[item.contractStatus] ?? CONTRACT_STATUS_STYLES.PENDING;

  return (
    <div className="px-5 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        {/* Trade identity */}
        <div className="flex-1 min-w-[180px]">
          <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
            {item.tradeName}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono flex items-center gap-1.5">
            {item.csiCode && <span>{item.csiCode}</span>}
            <span>·</span>
            <span>T{item.tier.replace("TIER", "")}</span>
            {item.subcontractorName && (
              <>
                <span>·</span>
                <span className="text-zinc-600 dark:text-zinc-300 not-italic">
                  {item.subcontractorName}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Committed amount */}
        <div className="w-32">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Committed
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={draft.committedAmount}
            onChange={(e) => setDraft({ ...draft, committedAmount: e.target.value })}
            placeholder="—"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        {/* PO# */}
        <div className="w-28">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            PO #
          </label>
          <input
            type="text"
            value={draft.poNumber}
            onChange={(e) => setDraft({ ...draft, poNumber: e.target.value })}
            placeholder="—"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        {/* Status */}
        <div className="w-40">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Status
          </label>
          <select
            value={draft.contractStatus}
            onChange={(e) =>
              setDraft({ ...draft, contractStatus: e.target.value as ContractStatus })
            }
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {CONTRACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {/* Paid to date */}
        <div className="w-28">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Paid
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={draft.paidToDate}
            onChange={(e) => setDraft({ ...draft, paidToDate: e.target.value })}
            placeholder="0"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        {/* Save / expand */}
        <div className="flex items-end gap-2 pt-4">
          {isDirty && (
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {!isDirty && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusStyle}`}
            >
              {CONTRACT_STATUS_LABELS[item.contractStatus]}
            </span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            title={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Expanded detail: derived values + notes */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <DetailStat
            label="Change Orders"
            value={fmtDollar(item.changeOrderAmount)}
          />
          <DetailStat
            label="Total w/ COs"
            value={fmtDollar(item.totalCommitted)}
          />
          <DetailStat
            label="Remaining"
            value={fmtDollar(item.remainingToPay)}
          />
          <DetailStat
            label={`Retainage (${item.retainagePercent}%)`}
            value={fmtDollar(item.retainageHeld)}
          />
          <div className="col-span-2 md:col-span-4">
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
              Notes
            </label>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
              placeholder="Internal notes on this buyout…"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className="text-sm text-zinc-800 dark:text-zinc-100">{value}</p>
    </div>
  );
}
