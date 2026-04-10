"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ----- Types -----

type CheckStatus = "pass" | "caution" | "fail";
type Score = "GO" | "CAUTION" | "NO-GO";

type Check = {
  label: string;
  status: CheckStatus;
  detail: string;
};

type Gate = {
  id: "readiness" | "procurement" | "scope" | "deadline" | "compliance";
  label: string;
  score: Score;
  checks: Check[];
};

type GnoGData = {
  overall: Score;
  gates: Gate[];
  meta: {
    daysUntilDue: number | null;
    projectType: string;
    isStubMode: false;
  };
};

// ----- Styles -----

const BANNER_STYLES: Record<Score, { border: string; bg: string; text: string; label: string }> = {
  GO: {
    border: "border-green-200",
    bg: "bg-green-50",
    text: "text-green-800",
    label: "GO — Ready to bid",
  },
  CAUTION: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-800",
    label: "CAUTION — Items need attention",
  },
  "NO-GO": {
    border: "border-red-200",
    bg: "bg-red-50",
    text: "text-red-800",
    label: "NO-GO — Critical issues to resolve",
  },
};

const BADGE_STYLES: Record<Score, string> = {
  GO: "bg-green-100 text-green-700",
  CAUTION: "bg-amber-100 text-amber-700",
  "NO-GO": "bg-red-100 text-red-700",
};

const CHECK_STYLES: Record<CheckStatus, { icon: string; color: string }> = {
  pass: { icon: "✓", color: "text-green-600" },
  caution: { icon: "⚠", color: "text-amber-500" },
  fail: { icon: "✗", color: "text-red-500" },
};

// Which tab to navigate to for a failing/cautioning check
const CHECK_TAB: Record<string, string> = {
  "Project documents uploaded": "documents",
  "Intelligence brief generated": "overview",
  "Critical risk flags": "overview",
  "Before-invite assumptions": "overview",
  "Trades confirmed on bid": "trades",
  "Subs invited per trade": "subs",
  "Estimates received": "leveling",
  "Gap analysis run": "ai-review",
  "Critical gaps resolved": "ai-review",
  "Brief is current": "documents",
  "Bid due date set": "overview",
  "Compliance items verified": "overview",
  "Compliance checklist initialized": "overview",
  "Bid bond": "overview",
  "DBE goal": "overview",
};

const TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  documents: "Documents",
  trades: "Trades",
  subs: "Subs",
  leveling: "Leveling",
  "ai-review": "AI Review",
};

// ----- Gate card -----

function GateCard({
  gate,
  bidId,
}: {
  gate: Gate;
  bidId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const badge = BADGE_STYLES[gate.score];

  return (
    <div className="flex-1 min-w-[180px] rounded-md border border-zinc-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
      >
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide leading-none">
            {gate.label}
          </span>
          <span
            className={`inline-flex items-center self-start rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}
          >
            {gate.score}
          </span>
        </div>
        <span className="text-zinc-400 text-xs ml-2 shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 py-3 flex flex-col gap-2.5">
          {gate.checks.map((check, i) => {
            const { icon, color } = CHECK_STYLES[check.status];
            const tabKey = CHECK_TAB[check.label];
            const isActionable = check.status !== "pass" && tabKey;
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 text-sm font-bold leading-none mt-0.5 ${color}`}>
                  {icon}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-xs font-medium text-zinc-700 leading-snug">
                    {check.label}
                  </span>
                  <span className="text-xs text-zinc-500 leading-relaxed">{check.detail}</span>
                  {isActionable && (
                    <button
                      onClick={() => router.replace(`/bids/${bidId}?tab=${tabKey}`)}
                      className="self-start text-xs text-blue-600 hover:underline mt-0.5"
                    >
                      Go to {TAB_LABELS[tabKey] ?? tabKey} →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----- Skeleton -----

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-11 rounded-md bg-zinc-100 animate-pulse" />
      <div className="flex gap-3 flex-wrap">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 min-w-[180px] h-20 rounded-md bg-zinc-100 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ----- Main component -----

export default function GoNoGoWidget({ bidId }: { bidId: number }) {
  const [data, setData] = useState<GnoGData | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}/go-no-go`);
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as GnoGData);
    } catch {
      setData(null);
    }
  }, [bidId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (data === undefined) return <Skeleton />;

  if (data === null) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm text-zinc-500">Unable to load go/no-go data.</p>
      </div>
    );
  }

  const banner = BANNER_STYLES[data.overall];

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800">Go / No-Go</h2>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-xs text-zinc-500 hover:text-zinc-700 border border-zinc-200 rounded px-2.5 py-1 disabled:opacity-50 transition-colors"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Overall banner */}
      <div className={`rounded-md border px-5 py-3 ${banner.border} ${banner.bg}`}>
        <p className={`text-sm font-semibold ${banner.text}`}>{banner.label}</p>
      </div>

      {/* Gate cards */}
      <div className="flex gap-3 flex-wrap">
        {data.gates.map((gate) => (
          <GateCard key={gate.id} gate={gate} bidId={bidId} />
        ))}
      </div>
    </div>
  );
}
