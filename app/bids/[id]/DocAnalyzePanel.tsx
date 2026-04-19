"use client";

// DocAnalyzePanel — shared AI analysis picker used by all document types
// (Drawings, Spec Book, Addendums, Manuals, etc.)
//
// The caller owns:
//   - The actual API call (onRun callback)
//   - Results rendering (children or result prop)
//
// This component owns:
//   - Tier selection (Quick Scan / Scope Brief / Full Intelligence)
//   - Model selection (Tier 3 only)
//   - Cost estimate display
//   - Run button + progress display

import { useState } from "react";
import { Zap, FileSearch, BrainCircuit, ChevronDown, ChevronUp } from "lucide-react";

export type AnalysisModel = "haiku" | "sonnet" | "opus";
export type AnalysisTier = 1 | 2 | 3;

export interface RunOpts {
  tier: AnalysisTier;
  model: AnalysisModel;
}

// ── Cost estimation ───────────────────────────────────────────────────────────
// Approximate token costs per 1M tokens (input / output)
const MODEL_COSTS: Record<AnalysisModel, { input: number; output: number; label: string }> = {
  haiku:  { input: 0.80,  output: 4.00,  label: "Haiku"       },
  sonnet: { input: 3.00,  output: 15.00, label: "Sonnet 4.6"  },
  opus:   { input: 15.00, output: 75.00, label: "Opus 4.6"    },
};

// ~2 000 tokens per drawing page at medium resolution; ~500 output tokens flat
function estimateCost(tier: AnalysisTier, model: AnalysisModel, pageCount: number): number {
  const pages = tier === 1 ? Math.min(3, pageCount)
              : tier === 2 ? Math.min(9, pageCount)
              : pageCount;
  const inputTokens  = pages * 2_000 + 800;   // 800 for system + prompt text
  const outputTokens = 1_200;
  const { input, output } = MODEL_COSTS[model];
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
}

// ── Tier definitions ──────────────────────────────────────────────────────────
type TierDef = {
  id: AnalysisTier;
  name: string;
  tagline: string;
  detail: string;
  defaultModel: AnalysisModel;
  modelLocked: boolean;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
};

const TIERS: TierDef[] = [
  {
    id: 1,
    name: "Quick Scan",
    tagline: "Cover sheet + index",
    detail: "Discipline list, project type, building description, special systems flag. Runs in seconds.",
    defaultModel: "haiku",
    modelLocked: true,
    icon: Zap,
    accentClass: "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20",
  },
  {
    id: 2,
    name: "Scope Brief",
    tagline: "First sheet per discipline",
    detail: "Per-discipline scope summary, bid risk flags, coordination notes, items to watch.",
    defaultModel: "sonnet",
    modelLocked: true,
    icon: FileSearch,
    accentClass: "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20",
  },
  {
    id: 3,
    name: "Full Intelligence",
    tagline: "Every page",
    detail: "Complete scope breakdown, cross-sheet analysis, RFI candidates, alternates and exclusions found in drawings.",
    defaultModel: "sonnet",
    modelLocked: false,
    icon: BrainCircuit,
    accentClass: "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────
interface DocAnalyzePanelProps {
  /** Total pages in the document — used for cost estimation */
  pageCount?: number;
  /** Called when the user clicks Run */
  onRun: (opts: RunOpts) => void;
  /** While analysis is running */
  running?: boolean;
  progress?: number;      // 0–100
  progressLabel?: string;
  error?: string | null;
  /** Label for the run button (default: "Run Analysis") */
  runLabel?: string;
  /** Rendered below the run button when analysis is complete */
  children?: React.ReactNode;
}

export default function DocAnalyzePanel({
  pageCount = 0,
  onRun,
  running = false,
  progress,
  progressLabel,
  error,
  runLabel = "Run Analysis",
  children,
}: DocAnalyzePanelProps) {
  const [selectedTier, setSelectedTier] = useState<AnalysisTier>(2);
  const [selectedModel, setSelectedModel] = useState<AnalysisModel>("sonnet");
  const [open, setOpen] = useState(true);

  const activeTier = TIERS.find((t) => t.id === selectedTier)!;
  const model = activeTier.modelLocked ? activeTier.defaultModel : selectedModel;
  const cost = pageCount > 0 ? estimateCost(selectedTier, model, pageCount) : null;

  function handleRun() {
    onRun({ tier: selectedTier, model });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* ── Header ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI Analysis</h3>
        {open ? (
          <ChevronUp className="h-4 w-4 text-zinc-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-4">

          {/* ── Tier cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {TIERS.map((tier) => {
              const Icon = tier.icon;
              const active = selectedTier === tier.id;
              return (
                <button
                  key={tier.id}
                  onClick={() => setSelectedTier(tier.id)}
                  className={`text-left rounded-lg border-2 p-3 transition-colors ${
                    active
                      ? tier.accentClass + " border-2"
                      : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "text-zinc-400 dark:text-zinc-500"}`} />
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{tier.name}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{tier.tagline}</p>
                </button>
              );
            })}
          </div>

          {/* ── Detail for selected tier ── */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-1">
            {activeTier.detail}
          </p>

          {/* ── Model selector (Tier 3 only) ── */}
          {selectedTier === 3 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Model</label>
              <div className="flex gap-2">
                {(["sonnet", "opus"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectedModel(m)}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                      selectedModel === m
                        ? "border-violet-400 bg-violet-50 text-violet-800 dark:border-violet-600 dark:bg-violet-900/30 dark:text-violet-200"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
                    }`}
                  >
                    <div className="font-semibold">{MODEL_COSTS[m].label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">
                      ${MODEL_COSTS[m].input}/MTok in
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Sonnet covers most projects. Opus earns its cost on large, multi-system builds.
              </p>
            </div>
          )}

          {/* ── Cost estimate + run button ── */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-400 dark:text-zinc-500">
              {cost !== null ? (
                <>Est. cost: <span className="font-medium text-zinc-600 dark:text-zinc-300">~${cost < 0.01 ? "<0.01" : cost.toFixed(2)}</span></>
              ) : (
                "Cost estimate available after upload"
              )}
              {!activeTier.modelLocked && (
                <span className="ml-1 opacity-60">· {MODEL_COSTS[model].label}</span>
              )}
              {activeTier.modelLocked && (
                <span className="ml-1 opacity-60">· {MODEL_COSTS[activeTier.defaultModel].label}</span>
              )}
            </div>
            <button
              onClick={handleRun}
              disabled={running}
              className="rounded-md bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 shrink-0"
            >
              {running ? "Analyzing…" : runLabel}
            </button>
          </div>

          {/* ── Progress ── */}
          {running && (
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                <span>{progressLabel ?? "Analyzing…"}</span>
                {progress !== undefined && <span>{Math.round(progress)}%</span>}
              </div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all duration-500"
                  style={{ width: `${Math.max(progress ?? 5, 2)}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          {/* ── Results (caller-provided) ── */}
          {children && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
