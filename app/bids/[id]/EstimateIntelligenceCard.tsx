"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type Recommendation = {
  type: string;
  trade: string;
  detail: string;
  severity: "warning" | "caution" | "info";
};

type IntelligenceData = {
  generated: boolean;
  summary: {
    totalEstimates: number;
    tradesAnalyzed: number;
    totalBidRange: { low: number; high: number } | null;
    recommendations: Recommendation[];
    missingTrades: string[];
  };
};

// ── Styles ─────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { icon: string; bg: string; border: string; text: string }> = {
  warning: { icon: "!", bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
  caution: { icon: "~", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  info: { icon: "i", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
};

function fmtDollar(n: number): string {
  return "$" + n.toLocaleString();
}

// ── Main component ─────────────────────────────────────────────────────────

export default function EstimateIntelligenceCard({ bidId }: { bidId: number }) {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/estimates/intelligence`);
        if (!cancelled && res.ok) setData(await res.json());
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bidId]);

  if (loading) return <div className="h-10 rounded-md bg-zinc-100 animate-pulse" />;
  if (!data || !data.generated || data.summary.totalEstimates === 0) return null;

  const { summary } = data;
  const recs = summary.recommendations;
  const warningCount = recs.filter((r) => r.severity === "warning").length;
  const cautionCount = recs.filter((r) => r.severity === "caution").length;
  const infoCount = recs.filter((r) => r.severity === "info").length;

  // Overall color based on worst severity
  const overallColor = warningCount > 0
    ? { bg: "bg-red-50", border: "border-red-200", text: "text-red-800" }
    : cautionCount > 0
    ? { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800" }
    : { bg: "bg-green-50", border: "border-green-200", text: "text-green-800" };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">Estimate Intelligence</h3>
        {summary.totalBidRange && (
          <span className="text-xs text-zinc-400">
            Range: {fmtDollar(summary.totalBidRange.low)} – {fmtDollar(summary.totalBidRange.high)}
          </span>
        )}
      </div>

      {/* Summary banner */}
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-md border px-4 py-3 flex items-center justify-between ${overallColor.border} ${overallColor.bg} hover:opacity-90 text-left w-full`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${overallColor.text}`}>
            {recs.length === 0
              ? "No issues found"
              : `${recs.length} finding${recs.length !== 1 ? "s" : ""}`}
          </span>
          <div className="flex gap-2">
            {warningCount > 0 && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">
                {warningCount} warning{warningCount !== 1 ? "s" : ""}
              </span>
            )}
            {cautionCount > 0 && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">
                {cautionCount} caution{cautionCount !== 1 ? "s" : ""}
              </span>
            )}
            {infoCount > 0 && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700">
                {infoCount} info
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
      </button>

      {/* Expanded recommendations */}
      {open && recs.length > 0 && (
        <div className="flex flex-col gap-2">
          {recs.map((rec, i) => {
            const style = SEVERITY_STYLES[rec.severity] ?? SEVERITY_STYLES.info;
            return (
              <div
                key={i}
                className={`rounded-md border px-4 py-3 flex items-start gap-3 ${style.border} ${style.bg}`}
              >
                <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${style.text} bg-white border ${style.border}`}>
                  {style.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-zinc-700">{rec.trade}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${style.text}`}>
                      {rec.type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className={`text-xs ${style.text} leading-relaxed`}>{rec.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
