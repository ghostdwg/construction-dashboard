"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Analysis = {
  id: string;
  engine: string;
  modelName: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  signalsCount: number;
  leadsCount: number;
  errorMessage: string | null;
};

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtCost(usd: number): string {
  if (usd === 0) return "free";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

const engineColors: Record<string, { fg: string; bg: string; border: string }> = {
  claude: { fg: "#c47dff", bg: "rgba(196,125,255,0.10)", border: "rgba(196,125,255,0.35)" },
  ollama: { fg: "#72e0ff", bg: "rgba(114,224,255,0.10)", border: "rgba(114,224,255,0.35)" },
};

export function AnalysisPanel({
  docId,
  initial,
}: {
  docId: string;
  initial: Analysis[];
}) {
  const [analyses, setAnalyses] = useState<Analysis[]>(initial);
  const [submitting, setSubmitting] = useState<null | "claude" | "ollama">(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/market-intelligence/docs/${docId}/analyses`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { analyses: Analysis[] };
      setAnalyses(data.analyses);
    } catch { /* swallow — next tick retries */ }
  }, [docId]);

  // Poll while any analysis is in flight (queued or running). Stops when all done.
  useEffect(() => {
    const anyInFlight = analyses.some((a) => a.status === "queued" || a.status === "running");
    if (anyInFlight) {
      if (!pollRef.current) {
        pollRef.current = setInterval(refresh, 3000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [analyses, refresh]);

  async function fire(engine: "claude" | "ollama") {
    setSubmitting(engine);
    setError(null);
    try {
      const res = await fetch(`/api/market-intelligence/docs/${docId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }

  const hasInFlight = analyses.some((a) => a.status === "queued" || a.status === "running");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => fire("claude")}
          disabled={submitting !== null}
          className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-2 rounded disabled:opacity-40 transition-colors"
          style={{
            color: engineColors.claude.fg,
            background: engineColors.claude.bg,
            border: `1px solid ${engineColors.claude.border}`,
          }}
        >
          {submitting === "claude" ? "Sending to Claude…" : "Send to Claude"}
        </button>
        <button
          onClick={() => fire("ollama")}
          disabled={submitting !== null}
          className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-2 rounded disabled:opacity-40 transition-colors"
          style={{
            color: engineColors.ollama.fg,
            background: engineColors.ollama.bg,
            border: `1px solid ${engineColors.ollama.border}`,
          }}
        >
          {submitting === "ollama" ? "Sending to Ollama…" : "Send to Ollama (GPU)"}
        </button>
        {hasInFlight && (
          <span className="font-mono text-[10px] opacity-70" style={{ color: "#ffcc72" }}>
            ● polling… run takes 5–90s
          </span>
        )}
        <span className="ml-auto opacity-60 font-mono text-[10px] uppercase tracking-[0.07em]">
          {analyses.length} {analyses.length === 1 ? "run" : "runs"}
        </span>
      </div>

      {error && (
        <div className="text-[11px] rounded px-3 py-2" style={{ background: "rgba(255,114,114,0.10)", border: "1px solid rgba(255,114,114,0.3)", color: "#ff7272" }}>
          {error}
        </div>
      )}

      {analyses.length === 0 ? (
        <p className="text-[11px] opacity-70 px-3 py-4 border border-dashed border-[var(--line)] rounded text-center">
          No analyses yet. Click an engine button to run one against this document.
        </p>
      ) : (
        <div className="flex flex-col">
          {analyses.map((a) => {
            const c = engineColors[a.engine] ?? { fg: "var(--text)", bg: "transparent", border: "var(--line)" };
            const isDone = a.status === "complete";
            const isFail = a.status === "failed";
            const isLive = a.status === "running" || a.status === "queued";
            return (
              <div
                key={a.id}
                className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 border-b border-[var(--line)] last:border-b-0"
              >
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-0.5 rounded shrink-0"
                    style={{ color: c.fg, background: c.bg, border: `1px solid ${c.border}` }}
                  >{a.engine}</span>
                  <span className="text-[11px] opacity-80 truncate" title={a.modelName}>{a.modelName}</span>
                </div>
                <div className="col-span-3 font-mono text-[10px] flex items-center gap-2">
                  {isDone && <span style={{ color: "var(--signal)" }}>✓ complete</span>}
                  {isFail && <span style={{ color: "#ff7272" }}>✕ failed</span>}
                  {isLive && <span style={{ color: "#ffcc72" }}>● {a.status}</span>}
                  <span className="opacity-60">· {fmtAge(a.completedAt ?? a.startedAt ?? a.requestedAt)}</span>
                </div>
                <div className="col-span-2 font-mono text-[10px] text-right">
                  <span className="opacity-60 mr-1">signals</span>
                  <span style={{ color: "var(--text)" }}>{isDone ? a.signalsCount : "—"}</span>
                </div>
                <div className="col-span-2 font-mono text-[10px] text-right">
                  <span className="opacity-60 mr-1">took</span>
                  <span style={{ color: "var(--text)" }}>{fmtDuration(a.durationMs)}</span>
                </div>
                <div className="col-span-2 font-mono text-[10px] text-right">
                  <span className="opacity-60 mr-1">cost</span>
                  <span style={{ color: "var(--text)" }}>{fmtCost(a.costUsd)}</span>
                </div>
                {isFail && a.errorMessage && (
                  <div className="col-span-12 text-[11px] mt-1 pl-2" style={{ color: "#ff7272" }}>
                    {a.errorMessage}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
