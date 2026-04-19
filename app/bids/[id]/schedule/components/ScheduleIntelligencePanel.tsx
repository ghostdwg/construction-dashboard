"use client";

// Schedule Intelligence Panel
//
// Two options:
//   1. Structural Skeleton — seed the 9-phase CPM template from the spec book.
//      Free. Uses spec section CSI numbers to source procurement activities
//      and canonical titles. Falls back to trades list if no spec book exists.
//
//   2. AI Schedule Intelligence — send spec book + drawing analysis to Claude.
//      Generates project-specific activity name/duration overrides and adds
//      any project-specific activities missing from the generic template.
//      Model selector with live cost estimate.

import { useEffect, useState } from "react";
import { Blocks, BrainCircuit, ChevronDown, ChevronUp } from "lucide-react";

// ── Model constants ───────────────────────────────────────────────────────────

type ScheduleModel = "sonnet" | "opus46" | "opus47";

const MODEL_DEFS: Record<
  ScheduleModel,
  { label: string; badge?: string; inputPerMTok: number; outputPerMTok: number; note: string }
> = {
  sonnet: {
    label: "Sonnet 4.6",
    inputPerMTok: 3.00,
    outputPerMTok: 15.00,
    note: "Fast, accurate — covers the vast majority of commercial projects.",
  },
  opus46: {
    label: "Opus 4.6",
    inputPerMTok: 15.00,
    outputPerMTok: 75.00,
    note: "Deeper reasoning on complex, multi-system or phased projects.",
  },
  opus47: {
    label: "Opus 4.7",
    badge: "new",
    inputPerMTok: 15.00,   // estimated — update when GA pricing is published
    outputPerMTok: 75.00,
    note: "Next-generation Opus. Pricing estimated at Opus 4.6 rates.",
  },
};

const OUTPUT_TOKENS_EST = 8_000;

function estimateCost(inputTokens: number, model: ScheduleModel): number {
  const { inputPerMTok, outputPerMTok } = MODEL_DEFS[model];
  return (
    (inputTokens / 1_000_000) * inputPerMTok +
    (OUTPUT_TOKENS_EST / 1_000_000) * outputPerMTok
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Metadata = {
  sectionCount: number;
  hasDrawings: boolean;
  hasSpecBook: boolean;
  estimatedInputTokens: number;
};

type PollResult = {
  status: string;
  progress: number;
  error?: string;
  projectSummary?: string;
  estimatedWeeks?: number;
  costUsd?: number;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleIntelligencePanel({
  bidId,
  onReload,
}: {
  bidId: number;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [model, setModel] = useState<ScheduleModel>("sonnet");

  // Skeleton seeding
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  // AI generation
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch metadata for cost estimation ──────────────────────────────────
  useEffect(() => {
    fetch(`/api/bids/${bidId}/schedule-v2/generate`)
      .then((r) => r.json())
      .then((d: Metadata) => setMeta(d))
      .catch(() => {/* non-critical */});
  }, [bidId]);

  // ── Poll AI job ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId || !running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/bids/${bidId}/schedule-v2/generate?jobId=${jobId}`
        );
        const data = (await res.json()) as PollResult;
        setPollResult(data);
        if (data.status === "complete" || data.status === "error") {
          setRunning(false);
          clearInterval(interval);
          if (data.status === "complete") onReload();
          if (data.error) setError(data.error);
        }
      } catch {
        // transient — keep polling
      }
    }, 2_500);
    return () => clearInterval(interval);
  }, [bidId, jobId, running, onReload]);

  // ── Seed skeleton ────────────────────────────────────────────────────────
  async function runSeed(force: boolean) {
    if (force) {
      const ok = window.confirm(
        "This will wipe the current schedule and rebuild the 9-phase template from your spec book. Continue?"
      );
      if (!ok) return;
    }
    setSeeding(true);
    setSeedDone(false);
    setError(null);
    try {
      const url = `/api/bids/${bidId}/schedule-v2/seed${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSeedDone(true);
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  // ── Run AI generation ────────────────────────────────────────────────────
  async function runGenerate() {
    setRunning(true);
    setError(null);
    setPollResult(null);
    setJobId(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/schedule-v2/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { jobId: jid } = (await res.json()) as { jobId: string };
      setJobId(jid);
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const estimatedCost =
    meta ? estimateCost(meta.estimatedInputTokens, model) : null;

  const isComplete = pollResult?.status === "complete";
  const isProcessing = running && pollResult?.status !== "complete";

  return (
    <div className="border-b border-slate-700 bg-slate-900 flex-shrink-0">
      {/* Header toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <BrainCircuit className="w-3.5 h-3.5 text-violet-400" />
          Schedule Intelligence
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* ── Option 1: Structural Skeleton ───────────────────────────── */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Blocks className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-200">
                Structural Skeleton
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 font-medium">
                free
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Builds the 9-phase CPM template. Procurement activities and trade
              names are sourced from your{" "}
              {meta?.hasSpecBook ? (
                <span className="text-emerald-400">spec book</span>
              ) : (
                <span className="text-slate-500">spec book (not uploaded) →</span>
              )}{" "}
              {!meta?.hasSpecBook && (
                <span className="text-slate-500">falls back to trades list.</span>
              )}
            </p>
            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => runSeed(false)}
                disabled={seeding}
                className="flex-1 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-medium py-1.5 transition-colors"
              >
                {seeding ? "Building…" : "Build Skeleton"}
              </button>
              <button
                onClick={() => runSeed(true)}
                disabled={seeding}
                title="Wipe current schedule and rebuild"
                className="rounded-md border border-slate-600 hover:border-slate-500 text-slate-400 hover:text-slate-200 text-[11px] px-2.5 py-1.5 transition-colors disabled:opacity-50"
              >
                Rebuild
              </button>
            </div>
            {seedDone && (
              <p className="text-[11px] text-emerald-400">
                Skeleton built — schedule updated.
              </p>
            )}
          </div>

          {/* ── Option 2: AI Schedule Intelligence ──────────────────────── */}
          <div className="rounded-lg border border-violet-800/60 bg-slate-800/60 p-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-200">
                AI Schedule Intelligence
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Sends your{" "}
              {meta
                ? `${meta.sectionCount} analyzed spec sections${meta.hasDrawings ? " + drawing analysis" : ""}`
                : "spec + drawings"}
              {" "}to Claude. Returns project-specific activity names, duration
              adjustments, and additions for systems not in the generic template.
            </p>

            {/* Model selector */}
            <div className="flex gap-1.5">
              {(Object.entries(MODEL_DEFS) as [ScheduleModel, typeof MODEL_DEFS[ScheduleModel]][]).map(
                ([key, def]) => (
                  <button
                    key={key}
                    onClick={() => setModel(key)}
                    className={`flex-1 rounded-md border px-1.5 py-1.5 text-[10px] font-medium text-center transition-colors ${
                      model === key
                        ? "border-violet-500 bg-violet-900/50 text-violet-200"
                        : "border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <div className="font-semibold leading-tight">
                      {def.label}
                      {def.badge && (
                        <span className="ml-1 text-[9px] bg-violet-700/60 text-violet-300 rounded px-1 py-0.5">
                          {def.badge}
                        </span>
                      )}
                    </div>
                    <div className="opacity-60 mt-0.5">
                      ${def.inputPerMTok}/MTok in
                    </div>
                  </button>
                )
              )}
            </div>

            {/* Model note */}
            <p className="text-[10px] text-slate-500 -mt-1">
              {MODEL_DEFS[model].note}
            </p>

            {/* Cost estimate + run */}
            <div className="flex items-center justify-between gap-2 mt-auto">
              <div className="text-[11px] text-slate-400">
                {estimatedCost !== null ? (
                  <>
                    Est. cost:{" "}
                    <span className="font-medium text-slate-300">
                      ~${estimatedCost < 0.01 ? "<0.01" : estimatedCost.toFixed(2)}
                    </span>
                    {meta && (
                      <span className="opacity-50 ml-1">
                        · {meta.sectionCount} sections
                        {meta.hasDrawings ? " + drawings" : ""}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="opacity-50">Loading estimate…</span>
                )}
              </div>
              <button
                onClick={runGenerate}
                disabled={running || !meta?.sectionCount}
                className="rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-medium px-3 py-1.5 shrink-0 transition-colors"
                title={
                  !meta?.sectionCount
                    ? "Analyze the spec book first to enable AI generation"
                    : undefined
                }
              >
                {running ? "Running…" : "Run Intelligence"}
              </button>
            </div>

            {/* Progress */}
            {isProcessing && (
              <div>
                <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500 animate-pulse w-1/3" />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Analyzing project documents with Claude…
                </p>
              </div>
            )}

            {/* Complete banner */}
            {isComplete && pollResult && (
              <div className="rounded-md bg-violet-950/60 border border-violet-800/50 p-2 text-[11px] space-y-0.5">
                {pollResult.projectSummary && (
                  <p className="text-slate-300 leading-relaxed">
                    {pollResult.projectSummary}
                  </p>
                )}
                <div className="flex gap-3 text-[10px] text-slate-500 mt-1">
                  {pollResult.estimatedWeeks && (
                    <span>~{pollResult.estimatedWeeks} weeks est.</span>
                  )}
                  {pollResult.costUsd != null && (
                    <span>Actual cost: ${pollResult.costUsd.toFixed(3)}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="md:col-span-2 rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
