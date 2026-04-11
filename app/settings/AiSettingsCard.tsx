"use client";

// Module SET1 — AI Configuration card
//
// Combines:
// 1. Anthropic API key (via SettingFieldRow → AppSetting)
// 2. Per-call max_tokens presets with cost-per-call + cost-per-1K display
//    (migrated from the legacy /settings/ai-tokens page)
// 3. Usage subsection: today / 7d / 30d totals + per-call breakdown
//    (powered by AiUsageLog rows from Phase 3)

import { useEffect, useState } from "react";
import SettingFieldRow, { type SettingItem } from "./SettingFieldRow";

// ── Types ──────────────────────────────────────────────────────────────────

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

type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
};

type UsageSummary = {
  range: { from: string; to: string; label: string };
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byCallKey: Array<{
    callKey: string;
    label: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
};

type UsageResponse = {
  today: UsageSummary;
  last7Days: UsageSummary;
  last30Days: UsageSummary;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return `<$0.01`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toString();
}

const PRESET_LABELS = {
  minimal: "Minimal",
  standard: "Standard",
  extended: "Extended",
  maximum: "Maximum",
} as const;

const MODEL_PRICING_LOOKUP: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-opus-4-6": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0 },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function AiSettingsCard() {
  const [apiKeyItems, setApiKeyItems] = useState<SettingItem[] | null>(null);
  const [configs, setConfigs] = useState<CallConfig[] | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aiKeyRes, tokensRes, usageRes] = await Promise.all([
          fetch("/api/settings/app?category=ai"),
          fetch("/api/settings/ai-tokens"),
          fetch("/api/settings/ai-usage"),
        ]);
        if (!aiKeyRes.ok) throw new Error(`AI key load: HTTP ${aiKeyRes.status}`);
        if (!tokensRes.ok) throw new Error(`Tokens load: HTTP ${tokensRes.status}`);
        if (!usageRes.ok) throw new Error(`Usage load: HTTP ${usageRes.status}`);

        const aiKeyData = (await aiKeyRes.json()) as { items: SettingItem[] };
        const tokensData = (await tokensRes.json()) as { configs: CallConfig[] };
        const usageData = (await usageRes.json()) as UsageResponse;

        if (cancelled) return;
        setApiKeyItems(aiKeyData.items);
        setConfigs(tokensData.configs);
        setUsage(usageData);
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
  }, [reloadTick]);

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
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading AI settings…</p>;
  }
  if (error || !configs || !apiKeyItems || !usage) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {error ?? "Failed to load"}
      </div>
    );
  }

  // Monthly estimate (rough — assumes 20 bids/mo, certain frequencies per call)
  const monthlyAssumptions: Record<string, number> = {
    brief: 20,
    "gap-analysis": 20 * 25,
    "addendum-delta": 20 * 2,
    intelligence: 0,
    "leveling-question": 20 * 50,
  };
  const monthlyTotal = configs.reduce(
    (sum, cfg) => sum + (monthlyAssumptions[cfg.key] ?? 0) * cfg.currentCost.realisticCostUsd,
    0
  );
  const monthlyTotalMax = configs.reduce(
    (sum, cfg) => sum + (monthlyAssumptions[cfg.key] ?? 0) * cfg.currentCost.maxCostUsd,
    0
  );

  const callLabelByKey = new Map(configs.map((c) => [c.key, c.label]));

  return (
    <div className="flex flex-col gap-5">
      {/* ── API key section ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Anthropic API Key
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
          Powers all AI features. Get one at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            console.anthropic.com
          </a>
          .
        </p>
        <div className="flex flex-col gap-3">
          {apiKeyItems.map((item) => (
            <SettingFieldRow
              key={item.key}
              item={item}
              onSaved={() => setReloadTick((t) => t + 1)}
            />
          ))}
        </div>
      </section>

      {/* ── Usage subsection ── */}
      <UsageSection usage={usage} callLabelByKey={callLabelByKey} />

      {/* ── Monthly estimate ── */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
          Estimated monthly cost (20 bids/mo, current settings)
        </p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {fmtUsd(monthlyTotal)}
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            realistic · up to {fmtUsd(monthlyTotalMax)} if all calls max out
          </span>
        </div>
      </div>

      {/* ── Per-call configs ── */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          Per-Call Token Budgets
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          Higher caps allow longer outputs but only cost more if the model
          actually uses them. You only pay for tokens generated, not the cap.
        </p>
        <div className="flex flex-col gap-4">
          {configs.map((cfg) => (
            <CallConfigCard
              key={cfg.key}
              config={cfg}
              saving={savingKey === cfg.key}
              onUpdate={(maxTokens) => updateConfig(cfg.key, maxTokens)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Usage subsection ───────────────────────────────────────────────────────

function UsageSection({
  usage,
  callLabelByKey,
}: {
  usage: UsageResponse;
  callLabelByKey: Map<string, string>;
}) {
  const [tab, setTab] = useState<"today" | "last7Days" | "last30Days">("last7Days");
  const active = usage[tab];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Actual Usage
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Logged from every Anthropic API call. Totals include input + output cost.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          {(
            [
              ["today", "Today"],
              ["last7Days", "7 days"],
              ["last30Days", "30 days"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                tab === key
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-zinc-100 dark:border-zinc-800">
        <UsageStat label="Total Cost" value={fmtUsd(active.totalCostUsd)} highlight />
        <UsageStat label="Total Calls" value={active.totalCalls.toLocaleString()} />
        <UsageStat label="Input Tokens" value={fmtTokens(active.totalInputTokens)} />
        <UsageStat label="Output Tokens" value={fmtTokens(active.totalOutputTokens)} />
      </div>

      {active.byCallKey.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-500 italic dark:text-zinc-400">
          No AI calls logged in this window yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
              <th className="px-4 py-2">Call Type</th>
              <th className="px-4 py-2 text-right">Calls</th>
              <th className="px-4 py-2 text-right">In Tokens</th>
              <th className="px-4 py-2 text-right">Out Tokens</th>
              <th className="px-4 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {active.byCallKey.map((row) => (
              <tr key={row.callKey}>
                <td className="px-4 py-2 text-zinc-800 dark:text-zinc-100">
                  {callLabelByKey.get(row.callKey) ?? row.label ?? row.callKey}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                  {row.calls.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                  {fmtTokens(row.inputTokens)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                  {fmtTokens(row.outputTokens)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                  {fmtUsd(row.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function UsageStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-0.5 ${
          highlight
            ? "text-2xl font-semibold text-zinc-900 dark:text-zinc-100"
            : "text-lg font-semibold text-zinc-800 dark:text-zinc-200"
        }`}
      >
        {value}
      </p>
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
  const activePreset = presets.find((p) => config.presets[p] === config.currentMaxTokens);
  const isCustom = !activePreset;
  const pricing = MODEL_PRICING_LOOKUP[config.model];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {config.label}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            <span className="font-mono">{config.model}</span>
            {pricing && (
              <>
                {" · "}
                <span title="Input price per 1M tokens">
                  in ${pricing.inputPer1M.toFixed(2)}/1M
                </span>
                {" · "}
                <span title="Output price per 1M tokens">
                  out ${pricing.outputPer1M.toFixed(2)}/1M
                </span>
              </>
            )}
            {" · "}~{fmtTokens(config.typicalInputTokens)} input tokens (typical)
          </p>
          <p className="text-sm text-zinc-600 mt-2 dark:text-zinc-300">
            {config.description}
          </p>
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

      <div className="mb-3 flex items-center gap-2 text-sm flex-wrap">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                  ? "border-black bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
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
                className={`text-[10px] ${
                  isActive ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {fmtUsd(cost.realisticCostUsd)}/call
              </span>
            </button>
          );
        })}
      </div>

      {isCustom && (
        <p className="mt-2 text-xs text-amber-700 italic dark:text-amber-400">
          Custom value — not matching any preset.
        </p>
      )}
    </div>
  );
}
