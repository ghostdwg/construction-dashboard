"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type EstimateEntry = {
  subToken: string;
  total: number;
  lineCount: number;
  scopeCoverage?: number;
  scopeIncluded?: number;
  scopeTotal?: number;
  costPosition?: string;
  valueFlag?: string;
};

type TradeSpread = {
  tradeId: number;
  tradeName: string;
  estimates: EstimateEntry[];
  spread: {
    min: number;
    max: number;
    median: number;
    range: number;
    rangePercent: number;
  };
};

type SpreadData = {
  trades: TradeSpread[];
  overall: {
    estimateCount: number;
    tradesWithPricing: number;
    totalSpreadWarnings: number;
  };
};

type ValueEntry = {
  subToken: string;
  total: number;
  scopeCoverage: number;
  scopeIncluded: number;
  scopeTotal: number;
  costPosition: string;
  valueFlag: string;
};

type ValueTrade = {
  tradeId: number;
  tradeName: string;
  estimates: ValueEntry[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDollar(n: number): string {
  return "$" + n.toLocaleString();
}

const VALUE_FLAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  best_value: { bg: "bg-green-100", text: "text-green-700", label: "Best Value" },
  low_coverage: { bg: "bg-red-100", text: "text-red-700", label: "Low Coverage" },
  high_cost: { bg: "bg-amber-100", text: "text-amber-700", label: "High Cost" },
  ok: { bg: "bg-zinc-100", text: "text-zinc-600", label: "OK" },
};

const COST_POS_STYLES: Record<string, string> = {
  low: "text-green-600",
  median: "text-zinc-600",
  high: "text-amber-600",
};

// ── Main component ─────────────────────────────────────────────────────────

export default function BidSpreadPanel({ bidId }: { bidId: number }) {
  const [spread, setSpread] = useState<SpreadData | null>(null);
  const [valueData, setValueData] = useState<ValueTrade[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [spreadRes, valueRes] = await Promise.all([
        fetch(`/api/bids/${bidId}/estimates/spread`),
        fetch(`/api/bids/${bidId}/estimates/value-matrix`),
      ]);
      if (spreadRes.ok) setSpread(await spreadRes.json());
      if (valueRes.ok) {
        const vd = await valueRes.json();
        setValueData(vd.trades ?? null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [bidId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="h-12 rounded-md bg-zinc-100 animate-pulse" />;
  if (!spread || spread.trades.length === 0) return null;

  // Merge value data into spread data
  const valueLookup = new Map<string, ValueEntry>();
  if (valueData) {
    for (const vt of valueData) {
      for (const ve of vt.estimates) {
        valueLookup.set(`${vt.tradeId}-${ve.subToken}`, ve);
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">Bid Spread</h3>
        <span className="text-xs text-zinc-400">
          {spread.overall.tradesWithPricing} trade{spread.overall.tradesWithPricing !== 1 ? "s" : ""} with pricing
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {spread.trades.map((trade) => {
          const isExpanded = expandedTrade === trade.tradeId;
          const isOutlier = trade.spread.rangePercent > 25;

          return (
            <div
              key={trade.tradeId}
              className={`rounded-md border bg-white overflow-hidden ${isOutlier ? "border-amber-200" : "border-zinc-200"}`}
            >
              {/* Trade header + spread bar */}
              <button
                onClick={() => setExpandedTrade(isExpanded ? null : trade.tradeId)}
                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-zinc-50 text-left"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-zinc-800">{trade.tradeName}</span>
                  <span className="ml-2 text-xs text-zinc-400">
                    {trade.estimates.length} estimate{trade.estimates.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Inline spread summary */}
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="text-zinc-500">{fmtDollar(trade.spread.min)}</span>
                  <div className="w-24 h-2 bg-zinc-100 rounded-full relative">
                    {trade.estimates.map((est, i) => {
                      const pct = trade.spread.range > 0
                        ? ((est.total - trade.spread.min) / trade.spread.range) * 100
                        : 50;
                      return (
                        <div
                          key={i}
                          className="absolute top-0 w-2 h-2 rounded-full bg-zinc-600"
                          style={{ left: `${Math.max(0, Math.min(100, pct))}%`, transform: "translateX(-50%)" }}
                          title={`${est.subToken}: ${fmtDollar(est.total)}`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-zinc-500">{fmtDollar(trade.spread.max)}</span>
                  {isOutlier && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">
                      {trade.spread.rangePercent}% spread
                    </span>
                  )}
                </div>

                <span className="text-zinc-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-zinc-100 px-4 py-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-zinc-400 text-left">
                        <th className="pb-2 font-medium">Sub</th>
                        <th className="pb-2 font-medium text-right">Total</th>
                        <th className="pb-2 font-medium text-right">vs Median</th>
                        {valueData && <th className="pb-2 font-medium text-right">Coverage</th>}
                        {valueData && <th className="pb-2 font-medium text-right">Value</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {trade.estimates
                        .sort((a, b) => a.total - b.total)
                        .map((est) => {
                          const deviation = trade.spread.median > 0
                            ? ((est.total - trade.spread.median) / trade.spread.median) * 100
                            : 0;
                          const ve = valueLookup.get(`${trade.tradeId}-${est.subToken}`);
                          const flagStyle = ve ? VALUE_FLAG_STYLES[ve.valueFlag] ?? VALUE_FLAG_STYLES.ok : null;
                          const posStyle = ve ? COST_POS_STYLES[ve.costPosition] ?? "" : "";

                          return (
                            <tr key={est.subToken} className="border-t border-zinc-50">
                              <td className="py-2 font-mono text-zinc-700">{est.subToken}</td>
                              <td className={`py-2 text-right font-medium ${posStyle}`}>
                                {fmtDollar(est.total)}
                              </td>
                              <td className={`py-2 text-right ${deviation > 25 ? "text-amber-600 font-semibold" : deviation < -25 ? "text-red-600 font-semibold" : "text-zinc-400"}`}>
                                {deviation >= 0 ? "+" : ""}{Math.round(deviation)}%
                              </td>
                              {valueData && (
                                <td className="py-2 text-right text-zinc-600">
                                  {ve ? `${Math.round(ve.scopeCoverage * 100)}%` : "—"}
                                </td>
                              )}
                              {valueData && (
                                <td className="py-2 text-right">
                                  {flagStyle ? (
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${flagStyle.bg} ${flagStyle.text}`}>
                                      {flagStyle.label}
                                    </span>
                                  ) : "—"}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  <div className="mt-2 pt-2 border-t border-zinc-100 text-xs text-zinc-400 flex gap-4">
                    <span>Median: {fmtDollar(trade.spread.median)}</span>
                    <span>Range: {fmtDollar(trade.spread.range)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
