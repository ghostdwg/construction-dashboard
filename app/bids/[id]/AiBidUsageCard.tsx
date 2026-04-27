"use client";

import { useEffect, useState } from "react";

type LedgerRow = { callKey: string; label: string; calls: number; costUsd: number };
type Ledger = {
  totalCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byCallKey: LedgerRow[];
};

function fmt$(n: number) {
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

export default function AiBidUsageCard({ bidId }: { bidId: number }) {
  const [data, setData] = useState<Ledger | null>(null);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/ai-usage`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [bidId]);

  if (!data || data.totalCalls === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500 select-none whitespace-nowrap">
          AI Cost Ledger
        </span>
        <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
        <span className="font-mono text-[11px] font-[600]" style={{ color: "var(--signal-soft)" }}>
          {fmt$(data.totalCostUsd)} total
        </span>
      </div>

      <div
        className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
        style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))" }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              {["Operation", "Calls", "Cost"].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.09em] border-b border-[var(--line)] font-[500] ${i === 2 ? "text-right" : "text-left"}`}
                  style={{ color: "var(--text-dim)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.byCallKey.map((row) => (
              <tr key={row.callKey} className="border-b border-[var(--line)] last:border-b-0">
                <td className="px-4 py-2.5 text-[12px]" style={{ color: "var(--text)" }}>{row.label}</td>
                <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: "var(--text-dim)" }}>{row.calls}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-right" style={{ color: "var(--text-soft)" }}>{fmt$(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[9px] mt-2 text-right" style={{ color: "var(--text-dim)" }}>
        {data.totalCalls} calls · {(data.totalInputTokens + data.totalOutputTokens).toLocaleString()} tokens
      </p>
    </div>
  );
}
