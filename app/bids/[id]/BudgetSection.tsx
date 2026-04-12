"use client";

// Module H6 — Budget section on the Handoff tab
//
// Loads trade lines (read-only, from BuyoutItem) + GC lines (editable,
// persisted via PATCH). Renders a combined budget view with subtotals and
// grand total. "Download Budget" exports a single-sheet XLSX.

import { useEffect, useState } from "react";

type TradeLine = {
  costCode: string | null;
  csiCode: string | null;
  tradeName: string;
  subcontractorName: string | null;
  committedAmount: number;
  changeOrderAmount: number;
  totalAmount: number;
};

type GcLine = { label: string; costCode: string; amount: string };

type Budget = {
  tradeLines: TradeLine[];
  tradeSubtotal: number;
  gcLines: Array<{ label: string; costCode: string; amount: number }>;
  gcSubtotal: number;
  grandTotal: number;
};

function fmtDollar(n: number): string {
  if (n === 0) return "$0";
  return "$" + Math.round(n).toLocaleString();
}

export default function BudgetSection({ bidId }: { bidId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gcLines, setGcLines] = useState<GcLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/budget`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as Budget;
        if (cancelled) return;
        setBudget(data);
        setGcLines(
          data.gcLines.map((g) => ({
            label: g.label,
            costCode: g.costCode,
            amount: g.amount > 0 ? String(g.amount) : "",
          }))
        );
        setDirty(false);
        setError(null);
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
  }, [bidId, expanded, reloadTick]);

  function updateGc(idx: number, field: keyof GcLine, value: string) {
    setGcLines(gcLines.map((g, i) => (i === idx ? { ...g, [field]: value } : g)));
    setDirty(true);
  }
  function addGc() {
    setGcLines([...gcLines, { label: "", costCode: "", amount: "" }]);
    setDirty(true);
  }
  function removeGc(idx: number) {
    setGcLines(gcLines.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function saveGcLines() {
    setSaving(true);
    setError(null);
    try {
      const payload = gcLines
        .filter((g) => g.label.trim())
        .map((g) => ({
          label: g.label.trim(),
          costCode: g.costCode.trim() || "1.000",
          amount: parseFloat(g.amount.replace(/[^\d.]/g, "")) || 0,
        }));
      const res = await fetch(`/api/bids/${bidId}/budget`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gcLines: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setDirty(false);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function downloadBudget() {
    setDownloading(true);
    setError(null);
    try {
      if (dirty) await saveGcLines();
      const res = await fetch(`/api/bids/${bidId}/budget/export`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : "budget.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  // Compute live totals from local gcLines state
  const gcSubtotal = gcLines.reduce(
    (s, g) => s + (parseFloat(g.amount.replace(/[^\d.]/g, "")) || 0),
    0
  );
  const tradeSubtotal = budget?.tradeSubtotal ?? 0;
  const grandTotal = tradeSubtotal + gcSubtotal;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-3 flex items-start justify-between gap-4 hover:bg-zinc-50 transition-colors dark:hover:bg-zinc-800/40"
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Project Budget
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Cost codes, trade commitments, GC overhead — formatted for ERP import.
          </p>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700">
          {loading && (
            <p className="px-5 py-4 text-sm text-zinc-500 dark:text-zinc-400">
              Loading budget…
            </p>
          )}

          {error && (
            <div className="mx-5 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          {budget && (
            <>
              {/* Trade lines (read-only) */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                      <th className="px-4 py-2">Cost Code</th>
                      <th className="px-4 py-2">Trade</th>
                      <th className="px-4 py-2">Sub</th>
                      <th className="px-4 py-2 text-right">Committed</th>
                      <th className="px-4 py-2 text-right">COs</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {budget.tradeLines.map((t) => (
                      <tr key={t.tradeName}>
                        <td className="px-4 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                          {t.costCode ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-zinc-800 dark:text-zinc-100">
                          {t.tradeName}
                        </td>
                        <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                          {t.subcontractorName ?? (
                            <span className="italic text-zinc-400 dark:text-zinc-500">
                              unassigned
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {fmtDollar(t.committedAmount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                          {t.changeOrderAmount > 0
                            ? fmtDollar(t.changeOrderAmount)
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {fmtDollar(t.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                      <td colSpan={5} className="px-4 py-2 font-semibold text-sm text-zinc-700 dark:text-zinc-200">
                        Trade Subtotal
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                        {fmtDollar(tradeSubtotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* GC lines (editable) */}
              <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
                    GC / General Requirements
                  </label>
                  <button
                    onClick={addGc}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    + Add line
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {gcLines.map((g, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={g.costCode}
                        onChange={(e) => updateGc(i, "costCode", e.target.value)}
                        placeholder="1.000"
                        className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <input
                        type="text"
                        value={g.label}
                        onChange={(e) => updateGc(i, "label", e.target.value)}
                        placeholder="Line item"
                        className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={g.amount}
                        onChange={(e) => updateGc(i, "amount", e.target.value)}
                        placeholder="$0"
                        className="w-28 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <button
                        onClick={() => removeGc(i)}
                        className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                {/* GC subtotal */}
                <div className="flex justify-between mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                    GC Subtotal
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {fmtDollar(gcSubtotal)}
                  </span>
                </div>

                {/* Grand total */}
                <div className="flex justify-between mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                  <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Grand Total
                  </span>
                  <span className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {fmtDollar(grandTotal)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
                {dirty && (
                  <button
                    onClick={saveGcLines}
                    disabled={saving}
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {saving ? "Saving…" : "Save GC Lines"}
                  </button>
                )}
                <button
                  onClick={downloadBudget}
                  disabled={downloading}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {downloading ? "Generating…" : "Download Budget"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
