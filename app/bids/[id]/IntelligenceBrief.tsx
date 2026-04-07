"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ----- Types -----

type RiskFlag = {
  flag: string;
  severity: "critical" | "moderate" | "low";
  foundIn: string;
  potentialImpact: string;
  confirmBefore: string;
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
  critical: "bg-red-100 text-red-700",
  moderate: "bg-amber-100 text-amber-700",
  low: "bg-zinc-100 text-zinc-500",
};

const URGENCY_STYLES: Record<string, string> = {
  before_invite: "bg-red-100 text-red-700",
  before_bid_day: "bg-amber-100 text-amber-700",
  post_award: "bg-zinc-100 text-zinc-500",
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
    <div className="rounded-md border border-zinc-200 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 transition-colors text-left"
      >
        <span>{title}</span>
        <span className="text-zinc-400 text-xs font-normal">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && <div className="border-t border-zinc-200 px-4 py-4">{children}</div>}
    </div>
  );
}

// ----- Main component -----

export default function IntelligenceBrief({ bidId }: { bidId: number }) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null | undefined>(undefined); // undefined = loading
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const loadBrief = useCallback(() => {
    fetch(`/api/bids/${bidId}/intelligence`)
      .then((r) => (r.ok ? r.json() : { brief: null }))
      .then((data: { brief: Brief | null }) => setBrief(data.brief))
      .catch(() => setBrief(null));
  }, [bidId]);

  useEffect(() => {
    loadBrief();
  }, [loadBrief]);

  // Poll while generating
  useEffect(() => {
    if (brief?.status !== "generating") return;
    const t = setInterval(loadBrief, 4000);
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

  // ----- States -----

  if (brief === undefined) {
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  if (brief === null) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-6 flex flex-col gap-3 items-start">
        <p className="text-sm text-zinc-500">
          Upload a spec book, drawing index, or addendum in the Documents tab to generate your
          project intelligence brief.
        </p>
        <button
          onClick={() => router.push(`?tab=documents`)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-500 hover:text-zinc-900"
        >
          Go to Documents tab
        </button>
      </div>
    );
  }

  if (brief.status === "generating") {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-6">
        <div className="flex items-center gap-3">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          <p className="text-sm text-zinc-500">Analyzing project documents…</p>
        </div>
      </div>
    );
  }

  // Parse JSON fields
  const riskFlags = parseJson<RiskFlag[]>(brief.riskFlags) ?? [];
  const assumptions = parseJson<Assumption[]>(brief.assumptionsToResolve) ?? [];
  const addendumSummary = parseJson<AddendumSummaryItem[]>(brief.addendumSummary) ?? [];
  const sourceContext = parseJson<SourceContext>(brief.sourceContext);

  // Sort: before_invite first
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

  return (
    <div className="flex flex-col gap-3">
      {/* Stale banner */}
      {brief.isStale && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          New document uploaded — updating brief…
        </div>
      )}

      {regenError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {regenError}
        </p>
      )}

      {/* 1 — What is this job */}
      {brief.whatIsThisJob && (
        <BriefSection title="What Is This Job" defaultOpen>
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
            {brief.whatIsThisJob}
          </p>
        </BriefSection>
      )}

      {/* 2 — How it gets built */}
      {brief.howItGetsBuilt && (
        <BriefSection title="How It Gets Built" defaultOpen>
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
            {brief.howItGetsBuilt}
          </p>
        </BriefSection>
      )}

      {/* 3 — Risk flags */}
      {riskFlags.length > 0 && (
        <BriefSection title={`Risk Flags (${riskFlags.length})`} defaultOpen>
          <div className="flex flex-col gap-3">
            {riskFlags.map((f, i) => (
              <div key={i} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_STYLES[f.severity] ?? "bg-zinc-100 text-zinc-500"}`}
                  >
                    {f.severity}
                  </span>
                  <span className="text-xs text-zinc-500">Found in: {f.foundIn}</span>
                </div>
                <p className="text-sm font-medium text-zinc-800">{f.flag}</p>
                <p className="text-xs text-zinc-500">Impact: {f.potentialImpact}</p>
                <p className="text-xs text-zinc-500">Confirm before: {f.confirmBefore}</p>
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
              <div key={i} className="flex gap-3 items-start py-2 border-b border-zinc-100 last:border-0">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium mt-0.5 ${URGENCY_STYLES[a.urgency] ?? "bg-zinc-100 text-zinc-500"}`}
                >
                  {URGENCY_LABELS[a.urgency] ?? a.urgency}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm text-zinc-700">{a.assumption}</p>
                  <p className="text-xs text-zinc-400">Ref: {a.sourceRef}</p>
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
              <div key={i} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 flex flex-col gap-1.5">
                <p className="text-sm font-semibold text-zinc-800">
                  Addendum {a.addendumNumber}
                  {a.addendumDate ? ` — ${a.addendumDate}` : ""}
                </p>
                <p className="text-sm text-zinc-700">{a.changes}</p>
                {a.supersedes && (
                  <p className="text-xs text-zinc-500">Supersedes: {a.supersedes}</p>
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
      <div className="flex items-center justify-between pt-1 text-xs text-zinc-400">
        <div className="flex flex-col gap-0.5">
          <span>Generated {new Date(brief.generatedAt).toLocaleString()}</span>
          {sourceParts.length > 0 && <span>{sourceParts.join(" · ")}</span>}
        </div>
        <button
          onClick={regenerate}
          disabled={regenerating || brief.status === "generating"}
          className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
