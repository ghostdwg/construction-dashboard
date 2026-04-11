"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import AiCostPreview from "./AiCostPreview";

// ----- Types -----

type RiskFlag = {
  flag: string;
  severity: "critical" | "moderate" | "low";
  foundIn: string;
  potentialImpact: string;
  confirmBefore: string;
  recommendedAction: string;
};

type Assumption = {
  assumption: string;
  sourceRef: string;
  urgency: "before_invite" | "before_bid_day" | "post_award";
};

type AddendumSummaryItem = {
  addendumNumber: number;
  addendumDate: string;
  changes: string;
  supersedes: string;
  riskFlags: string[];
};

type SourceContext = {
  division1Detected: boolean;
  specSectionCount: number;
  drawingDisciplines: string[];
  addendumCount: number;
  generatedFrom?: string;
};

type Brief = {
  id: number;
  bidId: number;
  generatedAt: string;
  status: string;
  whatIsThisJob: string | null;
  howItGetsBuilt: string | null;
  riskFlags: string | null;
  assumptionsToResolve: string | null;
  addendumSummary: string | null;
  addendumCount: number;
  isStale: boolean;
  sourceContext: string | null;
};

// ----- Helpers -----

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const URGENCY_STYLES: Record<string, string> = {
  before_invite: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  before_bid_day: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  post_award: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const URGENCY_LABELS: Record<string, string> = {
  before_invite: "Before Invite",
  before_bid_day: "Before Bid Day",
  post_award: "Post Award",
};

// ----- Collapsible section -----

function BriefSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 transition-colors text-left dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <span>{title}</span>
        <span className="text-zinc-400 text-xs font-normal dark:text-zinc-500">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-700">{children}</div>}
    </div>
  );
}

// ----- Main component -----

export default function IntelligenceBrief({ bidId }: { bidId: number }) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null | undefined>(undefined); // undefined = loading
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const loadBrief = useCallback(() => {
    fetch(`/api/bids/${bidId}/intelligence`)
      .then((r) => (r.ok ? r.json() : { brief: null }))
      .then((data: { brief: Brief | null }) => setBrief(data.brief))
      .catch(() => setBrief(null));
  }, [bidId]);

  useEffect(() => {
    loadBrief();
  }, [loadBrief]);

  // Poll while generating — stop after 2 minutes to avoid infinite loop
  const pollCount = useRef(0);
  useEffect(() => {
    if (brief?.status !== "generating") {
      pollCount.current = 0;
      return;
    }
    const MAX_POLLS = 30; // 30 × 4s = 2 minutes
    const t = setInterval(() => {
      pollCount.current++;
      if (pollCount.current >= MAX_POLLS) {
        clearInterval(t);
        setBrief((prev) => prev ? { ...prev, status: "error" } : prev);
        return;
      }
      loadBrief();
    }, 4000);
    return () => clearInterval(t);
  }, [brief?.status, loadBrief]);

  async function regenerate() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/intelligence`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setRegenError((err as { error?: string }).error ?? "Regeneration failed");
        return;
      }
      loadBrief();
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRegenerating(false);
    }
  }

  // ----- STATE 1 — Loading -----

  if (brief === undefined) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;
  }

  // ----- STATE 1 — No brief yet -----

  async function generate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/intelligence`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setGenerateError((err as { error?: string }).error ?? "Generation failed");
        return;
      }
      loadBrief();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  if (brief === null) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-6 flex flex-col gap-3 items-start dark:border-zinc-700 dark:bg-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upload a spec book, drawing index, or addendum in the Documents tab to generate your
          project intelligence brief.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`?tab=documents`)}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Go to Documents tab
          </button>
          <button
            onClick={generate}
            disabled={generating}
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate brief"}
          </button>
          <AiCostPreview callKey="brief" bidId={bidId} />
        </div>
        {generateError && (
          <p className="text-sm text-red-500">{generateError}</p>
        )}
      </div>
    );
  }

  // ----- STATE 2 — Generating -----

  if (brief.status === "generating") {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-6 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-3">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Analyzing project documents…</p>
        </div>
      </div>
    );
  }

  // ----- STATE 2b — Error / failed generation -----

  if (brief.status === "error" || (!brief.whatIsThisJob && !brief.howItGetsBuilt)) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-5 py-6 flex flex-col gap-3 items-start">
        <p className="text-sm text-red-700">
          Brief generation failed or timed out. You can try again.
        </p>
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : "Regenerate brief"}
        </button>
        {regenError && <p className="text-sm text-red-500">{regenError}</p>}
      </div>
    );
  }

  // ----- STATE 3 + 4 — Ready (with optional stale banner) -----

  // Parse JSON fields
  const riskFlags = parseJson<RiskFlag[]>(brief.riskFlags) ?? [];
  const assumptions = parseJson<Assumption[]>(brief.assumptionsToResolve) ?? [];
  const addendumSummary = parseJson<AddendumSummaryItem[]>(brief.addendumSummary) ?? [];
  const sourceContext = parseJson<SourceContext>(brief.sourceContext);

  // Sort risk flags: critical first
  const severityOrder: Record<string, number> = { critical: 0, moderate: 1, low: 2 };
  const sortedRiskFlags = [...riskFlags].sort(
    (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
  );

  // Sort assumptions: before_invite first
  const urgencyOrder = { before_invite: 0, before_bid_day: 1, post_award: 2 };
  const sortedAssumptions = [...assumptions].sort(
    (a, b) =>
      (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3)
  );

  // Build source summary line
  const sourceParts: string[] = [];
  if (sourceContext?.division1Detected) sourceParts.push("Division 1 ✓");
  if (sourceContext?.specSectionCount) sourceParts.push(`${sourceContext.specSectionCount} spec sections`);
  if (sourceContext?.drawingDisciplines?.length) {
    sourceParts.push(
      `${sourceContext.drawingDisciplines.length} discipline${sourceContext.drawingDisciplines.length !== 1 ? "s" : ""} in drawings`
    );
  }
  if (sourceContext?.addendumCount) {
    sourceParts.push(`${sourceContext.addendumCount} addendum${sourceContext.addendumCount !== 1 ? "s" : ""}`);
  }

  const isStubMode = sourceContext?.generatedFrom?.includes("Stub mode") ?? false;

  return (
    <div className="flex flex-col gap-3">

      {/* STATE 5 — Stub mode dev badge */}
      {isStubMode && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-semibold text-blue-800 uppercase tracking-wide dark:bg-blue-900/60 dark:text-blue-300">
            Dev
          </span>
          <span className="text-xs text-blue-700">Stub data — live generation disabled</span>
        </div>
      )}

      {/* STATE 4 — Stale banner */}
      {brief.isStale && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800">
            Addendum uploaded — process it in the Documents tab to update your analysis.
          </p>
          <button
            onClick={() => router.push(`?tab=documents`)}
            className="shrink-0 rounded border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300"
          >
            Go to Documents →
          </button>
        </div>
      )}

      {regenError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {regenError}
        </p>
      )}

      {/* 1 — What is this job */}
      {brief.whatIsThisJob && (
        <BriefSection title="What Is This Job" defaultOpen>
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap dark:text-zinc-200">
            {brief.whatIsThisJob}
          </p>
        </BriefSection>
      )}

      {/* 2 — How it gets built */}
      {brief.howItGetsBuilt && (
        <BriefSection title="How It Gets Built" defaultOpen>
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap dark:text-zinc-200">
            {brief.howItGetsBuilt}
          </p>
        </BriefSection>
      )}

      {/* 3 — Risk flags */}
      {sortedRiskFlags.length > 0 && (
        <BriefSection title={`Risk Flags (${sortedRiskFlags.length})`} defaultOpen>
          <div className="flex flex-col gap-3">
            {sortedRiskFlags.map((f, i) => (
              <div key={i} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 flex flex-col gap-1.5 dark:border-zinc-800 dark:bg-zinc-800">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_STYLES[f.severity] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
                  >
                    {f.severity}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Found in: {f.foundIn}</span>
                </div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{f.flag}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Impact: {f.potentialImpact}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Confirm before: {f.confirmBefore}</p>
                {f.recommendedAction && (
                  <p className="text-xs text-zinc-700 border-t border-zinc-200 pt-1.5 mt-0.5 dark:text-zinc-200 dark:border-zinc-700">
                    <span className="font-medium">Recommended action:</span> {f.recommendedAction}
                  </p>
                )}
              </div>
            ))}
          </div>
        </BriefSection>
      )}

      {/* 4 — Assumptions to resolve */}
      {sortedAssumptions.length > 0 && (
        <BriefSection title={`Assumptions to Resolve (${sortedAssumptions.length})`}>
          <div className="flex flex-col gap-2">
            {sortedAssumptions.map((a, i) => (
              <div key={i} className="flex gap-3 items-start py-2 border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium mt-0.5 ${URGENCY_STYLES[a.urgency] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
                >
                  {URGENCY_LABELS[a.urgency] ?? a.urgency}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">{a.assumption}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">Ref: {a.sourceRef}</p>
                </div>
              </div>
            ))}
          </div>
        </BriefSection>
      )}

      {/* 5 — Addendum summary */}
      {addendumSummary.length > 0 && (
        <BriefSection title={`Addendum Summary (${addendumSummary.length})`}>
          <div className="flex flex-col gap-3">
            {addendumSummary.map((a, i) => (
              <div key={i} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 flex flex-col gap-1.5 dark:border-zinc-800 dark:bg-zinc-800">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  Addendum {a.addendumNumber}
                  {a.addendumDate ? ` — ${a.addendumDate}` : ""}
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-200">{a.changes}</p>
                {a.supersedes && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Supersedes: {a.supersedes}</p>
                )}
                {a.riskFlags?.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {a.riskFlags.map((rf, j) => (
                      <li key={j} className="text-xs text-red-600 flex gap-1.5 items-start">
                        <span className="shrink-0 mt-0.5">⚠</span>
                        <span>{rf}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </BriefSection>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 text-xs text-zinc-400 dark:text-zinc-500">
        <div className="flex flex-col gap-0.5">
          <span>Generated {new Date(brief.generatedAt).toLocaleString()}</span>
          {sourceContext?.generatedFrom && (
            <span>Generated from: {sourceContext.generatedFrom}</span>
          )}
          {sourceParts.length > 0 && <span>{sourceParts.join(" · ")}</span>}
        </div>
        <div className="flex items-center gap-2">
          <AiCostPreview callKey="brief" bidId={bidId} />
          <button
            onClick={regenerate}
            disabled={regenerating || brief.status === "generating"}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {regenerating ? "Regenerating…" : "Regenerate brief"}
          </button>
        </div>
      </div>
    </div>
  );
}
