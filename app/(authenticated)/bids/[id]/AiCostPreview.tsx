"use client";

// Module SET1 — AI cost preview chip
//
// Reusable inline component that fetches a cost forecast for a specific AI
// call type and displays it as a compact chip with hover-tooltip detail.
// Place this next to any "Generate with AI" / "Run analysis" button.
//
// Examples:
//   <AiCostPreview callKey="brief" bidId={bid.id} />
//   <AiCostPreview callKey="gap-analysis" />
//
// When `bidId` is provided AND the call key supports per-bid forecasting
// (brief / intelligence), the component fetches the actual prompt and
// tokenizes it for an accurate forecast. Otherwise it falls back to the
// call definition's typical input tokens.

import { useEffect, useState } from "react";

type Forecast = {
  callKey: string;
  callLabel: string;
  model: string;
  inputTokens: number;
  inputTokenSource: "estimated" | "typical";
  inputCostUsd: number;
  maxOutputTokens: number;
  forecastOutputTokens: number;
  forecastOutputCostUsd: number;
  outputRatio: number;
  outputRatioSource: "calibrated" | "default";
  realisticCostUsd: number;
  worstCaseCostUsd: number;
  warnings: string[];
};

function fmtUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return "<$0.01";
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toString();
}

export default function AiCostPreview({
  callKey,
  bidId,
  reloadKey = 0,
}: {
  callKey: string;
  bidId?: number;
  /** Bump to force a re-fetch (e.g. after the user uploads more docs). */
  reloadKey?: number;
}) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const url = bidId
          ? `/api/settings/ai-forecast?callKey=${callKey}&bidId=${bidId}`
          : `/api/settings/ai-forecast?callKey=${callKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as Forecast;
        if (cancelled) return;
        setForecast(data);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callKey, bidId, reloadKey]);

  if (error) {
    return (
      <span className="text-[10px] text-red-600 dark:text-red-400">
        cost: error
      </span>
    );
  }
  if (!forecast) {
    return (
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
        estimating…
      </span>
    );
  }

  const hasWarnings = forecast.warnings.length > 0;
  const isAccurate = forecast.inputTokenSource === "estimated";
  const isCalibrated = forecast.outputRatioSource === "calibrated";

  // Color the chip by cost magnitude
  const chipColor = forecast.realisticCostUsd >= 1
    ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800"
    : forecast.realisticCostUsd >= 0.1
      ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800"
      : "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${chipColor}`}
        title="Click for details"
      >
        <span>~{fmtUsd(forecast.realisticCostUsd)}</span>
        {hasWarnings && <span className="text-amber-600 dark:text-amber-300">⚠</span>}
        <span className="opacity-60">est.</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-80 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {forecast.callLabel}
              </p>
              <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {forecast.model}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-sm leading-none"
            >
              ×
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-zinc-500 dark:text-zinc-400">Input tokens</dt>
            <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-200">
              {fmtTokens(forecast.inputTokens)}{" "}
              {!isAccurate && (
                <span className="text-zinc-400 dark:text-zinc-500">(typical)</span>
              )}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">Max output</dt>
            <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-200">
              {fmtTokens(forecast.maxOutputTokens)}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">Forecast output</dt>
            <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-200">
              {fmtTokens(forecast.forecastOutputTokens)}{" "}
              <span className="text-zinc-400 dark:text-zinc-500">
                ({Math.round(forecast.outputRatio * 100)}%
                {isCalibrated ? " ✓" : ""})
              </span>
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">Input cost</dt>
            <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-200">
              {fmtUsd(forecast.inputCostUsd)}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">Output cost</dt>
            <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-200">
              {fmtUsd(forecast.forecastOutputCostUsd)}
            </dd>

            <dt className="border-t border-zinc-100 dark:border-zinc-800 pt-1 mt-0.5 font-semibold text-zinc-700 dark:text-zinc-200">
              Realistic
            </dt>
            <dd className="border-t border-zinc-100 dark:border-zinc-800 pt-1 mt-0.5 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
              {fmtUsd(forecast.realisticCostUsd)}
            </dd>

            <dt className="text-zinc-500 dark:text-zinc-400">Worst case</dt>
            <dd className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">
              {fmtUsd(forecast.worstCaseCostUsd)}
            </dd>
          </dl>

          {hasWarnings && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-900 dark:bg-amber-900/20">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide dark:text-amber-300 mb-1">
                Suggestions
              </p>
              <ul className="text-[11px] text-amber-800 dark:text-amber-200 list-disc pl-4 space-y-0.5">
                {forecast.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
            {isAccurate
              ? "Forecast based on the actual assembled prompt for this bid."
              : "Forecast based on typical input size for this call type."}
            {isCalibrated
              ? " Output ratio calibrated from your last 30 days of usage."
              : " Output ratio is a default 50% estimate (calibrates after first usage)."}
          </p>
        </div>
      )}
    </div>
  );
}
