"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ── Types (mirror /api/settings/ai-tokens response shape) ──────────────────

type CostEstimate = {
  maxCostUsd: number;
  realisticCostUsd: number;
  inputTokens: number;
  maxOutputTokens: number;
  realisticOutputTokens: number;
};

type CallConfig = {
  key: string;
  label: string;
  description: string;
  model: string;
  typicalInputTokens: number;
  defaultMaxTokens: number;
  minTokens: number;
  maxAllowedTokens: number;
  presets: {
    minimal: number;
    standard: number;
    extended: number;
    maximum: number;
  };
  recommended: "minimal" | "standard" | "extended" | "maximum";
  currentMaxTokens: number;
  currentCost: CostEstimate;
  isOverridden: boolean;
  presetCosts: Record<string, CostEstimate>;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtUsd(amount: number): string {
  if (amount < 0.01) return `<$0.01`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toString();
}

const PRESET_LABELS = {
  minimal: "Minimal",
  standard: "Standard",
  extended: "Extended",
  maximum: "Maximum",
} as const;

const PRESET_BLURBS = {
  minimal: "Tightest cap. Lowest cost. May truncate complex outputs.",
  standard: "Balanced. Recommended for most projects.",
  extended: "Extra headroom. Captures fuller findings on complex trades.",
  maximum: "Model ceiling. Use only when truncation is observed.",
} as const;

// ── Page ───────────────────────────────────────────────────────────────────

export default function AiTokensSettingsPage() {
  const [configs, setConfigs] = useState<CallConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/ai-tokens");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setConfigs(data.configs);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateConfig(callKey: string, maxTokens: number | null) {
    setSavingKey(callKey);
    try {
      const res = await fetch("/api/settings/ai-tokens", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callKey, maxTokens }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to update");
      }
      // Refetch
      const fresh = await fetch("/api/settings/ai-tokens");
      const data = await fresh.json();
      setConfigs(data.configs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading AI token settings…</p>
      </div>
    );
  }

  if (error || !configs) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
          Error: {error ?? "Failed to load"}
        </div>
      </div>
    );
  }

  // Total monthly estimate (rough — assumes 20 bids/mo, certain frequencies per call)
  const monthlyAssumptions: Record<string, number> = {
    brief: 20,
    "gap-analysis": 20 * 25, // 25 trades per bid avg
    "addendum-delta": 20 * 2, // 2 addendums per bid avg
    intelligence: 0, // legacy, rarely called
    "leveling-question": 20 * 50, // 50 leveling rows per bid avg
  };

  const monthlyTotal = configs.reduce((sum, cfg) => {
    const calls = monthlyAssumptions[cfg.key] ?? 0;
    return sum + calls * cfg.currentCost.realisticCostUsd;
  }, 0);

  const monthlyTotalMax = configs.reduce((sum, cfg) => {
    const calls = monthlyAssumptions[cfg.key] ?? 0;
    return sum + calls * cfg.currentCost.maxCostUsd;
  }, 0);

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-6">
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold mt-2 text-zinc-900 dark:text-zinc-100">AI Token Settings</h1>
        <p className="text-sm text-zinc-600 mt-1 dark:text-zinc-300">
          Adjust the maximum output tokens (max_tokens) for each AI call. Higher caps allow
          longer outputs but cost more if the model actually uses them. You only pay for
          tokens generated, not the cap itself.
        </p>
      </div>

      {/* Monthly estimate banner */}
      <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
          Estimated monthly cost (20 bids/mo, current settings)
        </p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{fmtUsd(monthlyTotal)}</span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            realistic · up to {fmtUsd(monthlyTotalMax)} if all calls max out
          </span>
        </div>
      </div>

      {/* Per-call configuration */}
      <div className="flex flex-col gap-5">
        {configs.map((cfg) => (
          <CallConfigCard
            key={cfg.key}
            config={cfg}
            saving={savingKey === cfg.key}
            onUpdate={(maxTokens) => updateConfig(cfg.key, maxTokens)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Per-call card ──────────────────────────────────────────────────────────

function CallConfigCard({
  config,
  saving,
  onUpdate,
}: {
  config: CallConfig;
  saving: boolean;
  onUpdate: (maxTokens: number | null) => void;
}) {
  const presets = ["minimal", "standard", "extended", "maximum"] as const;
  const activePreset = presets.find(
    (p) => config.presets[p] === config.currentMaxTokens
  );
  const isCustom = !activePreset;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{config.label}</h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            <span className="font-mono">{config.model}</span>
            {" · "}~{fmtTokens(config.typicalInputTokens)} input tokens (typical)
          </p>
          <p className="text-sm text-zinc-600 mt-2 dark:text-zinc-300">{config.description}</p>
        </div>
        {config.isOverridden && (
          <button
            onClick={() => onUpdate(null)}
            disabled={saving}
            className="ml-3 text-xs text-zinc-500 hover:text-zinc-800 underline disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
            title="Revert to hardcoded default"
          >
            Reset
          </button>
        )}
      </div>

      {/* Current state row */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Currently:</span>
        <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
          {fmtTokens(config.currentMaxTokens)} max tokens
        </span>
        <span className="text-zinc-400 dark:text-zinc-500">·</span>
        <span className="text-zinc-700 dark:text-zinc-200">
          ~{fmtUsd(config.currentCost.realisticCostUsd)}/call realistic
        </span>
        <span className="text-zinc-400 dark:text-zinc-500">·</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          up to {fmtUsd(config.currentCost.maxCostUsd)} if maxed
        </span>
      </div>

      {/* Preset buttons */}
      <div className="grid grid-cols-4 gap-2">
        {presets.map((preset) => {
          const tokens = config.presets[preset];
          const cost = config.presetCosts[preset];
          const isActive = activePreset === preset;
          const isRecommended = config.recommended === preset;

          return (
            <button
              key={preset}
              onClick={() => onUpdate(tokens)}
              disabled={saving || isActive}
              className={`relative flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors ${
                isActive
                  ? "border-black bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:text-zinc-200"
              } disabled:cursor-not-allowed`}
            >
              {isRecommended && !isActive && (
                <span className="absolute top-1 right-1 text-[9px] font-semibold text-emerald-700 bg-emerald-100 rounded px-1 py-0.5 uppercase tracking-wide dark:text-emerald-300 dark:bg-emerald-900/40">
                  Rec
                </span>
              )}
              <span className="text-xs font-semibold uppercase tracking-wide">
                {PRESET_LABELS[preset]}
              </span>
              <span className="font-mono text-sm font-semibold">
                {fmtTokens(tokens)}
              </span>
              <span
                className={`text-[10px] ${isActive ? "text-zinc-300" : "text-zinc-500"}`}
              >
                {fmtUsd(cost.realisticCostUsd)}/call
              </span>
            </button>
          );
        })}
      </div>

      {/* Active preset blurb */}
      {activePreset && (
        <p className="mt-2 text-xs text-zinc-500 italic dark:text-zinc-400">
          {PRESET_BLURBS[activePreset]}
        </p>
      )}
      {isCustom && (
        <p className="mt-2 text-xs text-amber-700 italic">
          Custom value — not matching any preset.
        </p>
      )}
    </div>
  );
}
