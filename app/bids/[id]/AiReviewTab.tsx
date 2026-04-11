"use client";

import { useEffect, useState, useCallback } from "react";
import AiCostPreview from "./AiCostPreview";

// ----- Types -----

type GapFinding = {
  id: number;
  bidId: number;
  tradeName: string | null;
  title: string | null;
  findingText: string;
  sourceRef: string | null;
  severity: string | null;
  sourceDocument: string | null;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
};

type GapData = {
  byTrade: Record<string, GapFinding[]>;
  tradeNames: string[];
  totalFindings: number;
  approvedEstimateCount: number;
  hasFindings: boolean;
  isStubMode: boolean;
};

// ----- Constants -----

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, moderate: 1, low: 2 };

const SOURCE_LABELS: Record<string, string> = {
  SPEC_BOOK: "Spec Book",
  DRAWINGS: "Drawings",
  BOTH: "Both",
  BRIEF: "Brief",
};

const SOURCE_STYLES: Record<string, string> = {
  SPEC_BOOK: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  DRAWINGS: "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  BOTH: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
  BRIEF: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

// ----- Finding card -----

function FindingCard({
  finding,
  bidId,
  onAddedToQuestions,
}: {
  finding: GapFinding;
  bidId: number;
  onAddedToQuestions: (findingId: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function addToQuestions() {
    if (!finding.reviewNotes) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeName: finding.tradeName,
          questionText: finding.reviewNotes,
          source: "GAP_ANALYSIS",
          gapFindingId: finding.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setAddError((err as { error?: string }).error ?? "Failed to add question");
        return;
      }
      setAdded(true);
      onAddedToQuestions(finding.id);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 flex flex-col gap-2 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {finding.severity && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_STYLES[finding.severity] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
          >
            {finding.severity}
          </span>
        )}
        {finding.sourceDocument && SOURCE_LABELS[finding.sourceDocument] && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_STYLES[finding.sourceDocument] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
          >
            {SOURCE_LABELS[finding.sourceDocument]}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-zinc-800 leading-snug dark:text-zinc-100">
        {finding.title ?? finding.findingText}
      </p>

      {/* Description */}
      {finding.title && finding.findingText && (
        <p className="text-sm text-zinc-600 leading-relaxed dark:text-zinc-300">{finding.findingText}</p>
      )}

      {/* Source ref */}
      {finding.sourceRef && (
        <p className="text-xs text-zinc-400 italic dark:text-zinc-500">Ref: {finding.sourceRef}</p>
      )}

      {/* Suggested question */}
      {finding.reviewNotes && (
        <div className="border-t border-zinc-100 pt-2 mt-0.5 flex items-start justify-between gap-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 italic leading-relaxed flex-1 dark:text-zinc-400">
            Q: {finding.reviewNotes}
          </p>
          <button
            onClick={addToQuestions}
            disabled={adding || added}
            className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              added
                ? "bg-green-100 text-green-700 cursor-default dark:bg-green-900/40 dark:text-green-300"
                : "bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50"
            }`}
          >
            {added ? "Added ✓" : adding ? "Adding…" : "Add to Questions"}
          </button>
        </div>
      )}

      {addError && <p className="text-xs text-red-500">{addError}</p>}
    </div>
  );
}

// ----- Trade panel -----

function TradePanel({
  tradeName,
  findings,
  bidId,
}: {
  tradeName: string;
  findings: GapFinding[];
  bidId: number;
}) {
  const [, setAddedIds] = useState<Set<number>>(new Set());

  const sorted = [...findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity ?? ""] ?? 3) -
      (SEVERITY_ORDER[b.severity ?? ""] ?? 3)
  );

  const critical = sorted.filter((f) => f.severity === "critical").length;
  const moderate = sorted.filter((f) => f.severity === "moderate").length;
  const low = sorted.filter((f) => f.severity === "low").length;

  if (findings.length === 0) {
    return (
      <p className="text-sm text-zinc-400 italic py-2 dark:text-zinc-500">
        No gaps identified for {tradeName}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Summary bar */}
      <div className="flex gap-4 text-xs">
        {critical > 0 && (
          <span className="text-red-700 font-medium">{critical} critical</span>
        )}
        {moderate > 0 && (
          <span className="text-amber-700 font-medium">{moderate} moderate</span>
        )}
        {low > 0 && (
          <span className="text-zinc-500 dark:text-zinc-400">{low} low</span>
        )}
      </div>

      {/* Finding cards */}
      <div className="flex flex-col gap-2">
        {sorted.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            bidId={bidId}
            onAddedToQuestions={(findingId) =>
              setAddedIds((prev) => new Set(prev).add(findingId))
            }
          />
        ))}
      </div>
    </div>
  );
}

// ----- Main component -----

export default function AiReviewTab({ bidId }: { bidId: number }) {
  const [gapData, setGapData] = useState<GapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);

  const loadGapData = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}/gap-analysis`);
      if (!res.ok) return;
      const data = await res.json() as GapData;
      setGapData(data);
      if (data.hasFindings) {
        setLastAnalyzedAt(new Date().toLocaleString());
      }
      // Auto-select first trade with findings
      if (data.hasFindings && !selectedTrade) {
        const firstTrade = Object.keys(data.byTrade)[0];
        if (firstTrade) setSelectedTrade(firstTrade);
      }
    } catch {
      // leave null
    } finally {
      setLoading(false);
    }
  }, [bidId, selectedTrade]);

  useEffect(() => {
    loadGapData();
  }, [loadGapData]);

  async function runAnalysis() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/gap-analysis/generate`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setRunError((err as { error?: string }).error ?? "Analysis failed");
        return;
      }
      // Reload gap data
      setLoading(true);
      await loadGapData();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;
  }

  const isStubMode = gapData?.isStubMode ?? false;
  const tradeNames = gapData?.tradeNames ?? [];
  const byTrade = gapData?.byTrade ?? {};
  const hasFindings = gapData?.hasFindings ?? false;
  const approvedEstimateCount = gapData?.approvedEstimateCount ?? 0;

  // Determine active trade for tab display
  const activeTrade = selectedTrade ?? tradeNames[0] ?? null;
  const activeFindings = activeTrade ? (byTrade[activeTrade] ?? []) : [];

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">AI Scope Gap Analysis</h2>
            {lastAnalyzedAt && hasFindings && (
              <p className="text-xs text-zinc-400 mt-0.5 dark:text-zinc-500">Last analyzed: {lastAnalyzedAt}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStubMode && (
              <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1">
                <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-semibold text-blue-800 uppercase tracking-wide dark:bg-blue-900/60 dark:text-blue-300">
                  Dev
                </span>
                <span className="text-xs text-blue-700">Stub data</span>
              </div>
            )}
            <AiCostPreview callKey="gap-analysis" />
            <button
              onClick={runAnalysis}
              disabled={running || tradeNames.length === 0}
              className="rounded bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-50"
            >
              {running ? "Analyzing…" : "Run Analysis"}
            </button>
          </div>
        </div>

        {runError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {runError}
          </p>
        )}
      </div>

      {/* ── STATE 1 — No trades on bid ── */}
      {tradeNames.length === 0 && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-6 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No trades assigned to this bid. Add trades in the Trades tab before running gap analysis.
          </p>
        </div>
      )}

      {/* ── STATE 2 — Trades exist, no sanitized estimates, no findings ── */}
      {tradeNames.length > 0 && !hasFindings && approvedEstimateCount === 0 && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-6 flex flex-col gap-3 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload and sanitize sub estimates in the Leveling tab to enable document-grounded gap
            analysis.
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            You can also run analysis now — findings will be based on spec and drawing requirements
            with no estimate submissions to compare.
          </p>
        </div>
      )}

      {/* ── STATE 3a — Estimates exist, not yet analyzed ── */}
      {tradeNames.length > 0 && !hasFindings && approvedEstimateCount > 0 && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-4 flex items-center justify-between gap-4 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-semibold">{approvedEstimateCount}</span> approved estimate
            {approvedEstimateCount !== 1 ? "s" : ""} ready. Run analysis to identify scope gaps
            against project documents.
          </p>
          <button
            onClick={runAnalysis}
            disabled={running}
            className="shrink-0 rounded bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50"
          >
            {running ? "Analyzing…" : "Run Analysis"}
          </button>
        </div>
      )}

      {/* ── STATE 3 — Findings exist ── */}
      {hasFindings && tradeNames.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Trade selector tabs */}
          {tradeNames.length > 1 && (
            <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
              {tradeNames.map((name) => {
                const count = (byTrade[name] ?? []).length;
                const hasCritical = (byTrade[name] ?? []).some(
                  (f) => f.severity === "critical"
                );
                const isActive = name === activeTrade;
                return (
                  <button
                    key={name}
                    onClick={() => setSelectedTrade(name)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                      isActive
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {name}
                    {count > 0 && (
                      <span
                        className={`ml-1.5 ${isActive ? "text-zinc-300" : hasCritical ? "text-red-500" : "text-zinc-400"}`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active trade findings */}
          {activeTrade && (
            <div>
              {tradeNames.length === 1 && (
                <h3 className="text-sm font-semibold text-zinc-700 mb-3 dark:text-zinc-200">{activeTrade}</h3>
              )}
              <TradePanel
                tradeName={activeTrade}
                findings={activeFindings}
                bidId={bidId}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
