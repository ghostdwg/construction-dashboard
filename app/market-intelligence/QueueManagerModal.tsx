"use client";

import { useCallback, useEffect, useState } from "react";

type Job = {
  id: string;
  status: string;
  sourceId: string | null;
  source: { id: string; name: string; jurisdiction: string | null } | null;
  createdAt: string;
  runAfter: string | null;
  startedAt: string | null;
  completedAt: string | null;
  inputSummary: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
};

const inputCls =
  "rounded px-2 py-1 text-xs border border-[var(--line)] outline-none focus:border-[rgba(0,255,100,0.4)] bg-transparent text-[var(--text)]";

function parseParams(inputSummary: string | null): Record<string, unknown> {
  if (!inputSummary) return {};
  try { return JSON.parse(inputSummary); } catch { return {}; }
}

export function QueueManagerModal({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [maxDocsDraft, setMaxDocsDraft] = useState<string>("");
  // Inline confirm state — replaces native confirm() which can be suppressed
  // per-origin by the browser ("Don't let this site prompt again").
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/queue", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { jobs: Job[] };
      setJobs(data.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function cancel(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirmingCancelId(null);
      await refresh();
    } catch (e) {
      setRowError({ id, msg: `Cancel failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function saveMaxDocs(id: string) {
    const n = parseInt(maxDocsDraft, 10);
    if (!Number.isFinite(n) || n < 1) {
      setRowError({ id, msg: "maxDocs must be a positive integer" });
      return;
    }
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxDocs: n }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setEditingId(null);
      setMaxDocsDraft("");
      await refresh();
    } catch (e) {
      setRowError({ id, msg: `Edit failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  const queued = jobs.filter((j) => j.status === "queued");
  const running = jobs.filter((j) => j.status === "running");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)", border: "1px solid var(--line)",
          borderRadius: 8, padding: 20, width: "min(720px, 92vw)",
          maxHeight: "80vh", overflow: "auto",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-[600]">Manage queue</h2>
          <button onClick={onClose} className="text-xs opacity-70 hover:opacity-100">Close</button>
        </div>

        {loading && <div className="text-xs opacity-70">Loading…</div>}
        {error && <div className="text-xs" style={{ color: "#ff7272" }}>Error: {error}</div>}

        {!loading && queued.length === 0 && running.length === 0 && (
          <div className="text-xs opacity-70">No queued or running market_scrape jobs.</div>
        )}

        {running.length > 0 && (
          <>
            <div className="text-xs uppercase tracking-wide opacity-60 mt-2 mb-1">Running</div>
            {running.map((j) => {
              const params = parseParams(j.inputSummary);
              return (
                <div key={j.id} className="text-xs py-1.5 border-b border-[var(--line)]">
                  <div><strong>{j.source?.name ?? "(unknown source)"}</strong> · {String(params.maxDocs ?? "default 200")} max docs</div>
                  <div className="opacity-60">started {j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"} · cannot edit while running</div>
                </div>
              );
            })}
          </>
        )}

        {queued.length > 0 && (
          <>
            <div className="text-xs uppercase tracking-wide opacity-60 mt-3 mb-1">Queued</div>
            {queued.map((j) => {
              const params = parseParams(j.inputSummary);
              const isEditing = editingId === j.id;
              const isBusy = busyId === j.id;
              return (
                <div key={j.id} className="text-xs py-2 border-b border-[var(--line)]">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <strong>{j.source?.name ?? "(unknown source)"}</strong>
                      {j.source?.jurisdiction && <span className="opacity-60"> · {j.source.jurisdiction}</span>}
                    </div>
                    <div className="opacity-60">runs {j.runAfter ? new Date(j.runAfter).toLocaleString() : "asap"}</div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="opacity-70">maxDocs:</span>
                    {isEditing ? (
                      <>
                        <input
                          type="number" min={1} max={5000}
                          value={maxDocsDraft}
                          onChange={(e) => setMaxDocsDraft(e.target.value)}
                          className={inputCls} style={{ width: 80 }}
                          autoFocus
                        />
                        <button
                          onClick={() => saveMaxDocs(j.id)} disabled={isBusy}
                          className="text-xs px-2 py-0.5 rounded font-[600]"
                          style={{ background: "var(--signal)", color: "#000" }}
                        >Save</button>
                        <button
                          onClick={() => { setEditingId(null); setMaxDocsDraft(""); }}
                          className="text-xs px-2 py-0.5 rounded opacity-70"
                        >Cancel</button>
                      </>
                    ) : (
                      <>
                        <span>{String(params.maxDocs ?? "default 200")}</span>
                        <button
                          onClick={() => { setEditingId(j.id); setMaxDocsDraft(String(params.maxDocs ?? "")); }}
                          disabled={isBusy}
                          className="text-xs px-2 py-0.5 rounded opacity-80"
                          style={{ border: "1px solid var(--line)" }}
                        >Edit</button>
                      </>
                    )}
                    <span className="ml-auto" />
                    {confirmingCancelId === j.id ? (
                      <>
                        <span className="opacity-70 mr-1">Cancel for sure?</span>
                        <button
                          onClick={() => cancel(j.id)} disabled={isBusy}
                          className="text-xs px-2 py-0.5 rounded font-[600]"
                          style={{ background: "#ff7272", color: "#000", border: "1px solid #ff7272" }}
                        >{isBusy ? "Cancelling…" : "Yes, cancel"}</button>
                        <button
                          onClick={() => { setConfirmingCancelId(null); setRowError(null); }}
                          className="text-xs px-2 py-0.5 rounded opacity-70"
                        >Keep job</button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setConfirmingCancelId(j.id); setRowError(null); }}
                        disabled={isBusy}
                        className="text-xs px-2 py-0.5 rounded font-[600]"
                        style={{ background: "rgba(255,114,114,0.15)", color: "#ff7272", border: "1px solid rgba(255,114,114,0.3)" }}
                      >Cancel job</button>
                    )}
                  </div>
                  {rowError?.id === j.id && (
                    <div className="mt-1 text-[11px]" style={{ color: "#ff7272" }}>{rowError.msg}</div>
                  )}
                  {params.dateFrom || params.dateTo ? (
                    <div className="opacity-60 mt-1">date range: {String(params.dateFrom ?? "—")} → {String(params.dateTo ?? "—")}</div>
                  ) : null}
                </div>
              );
            })}
          </>
        )}

        <div className="mt-4 text-xs opacity-60">
          Editing only allowed on <code>queued</code> jobs. Running jobs must finish or fail naturally.
        </div>
      </div>
    </div>
  );
}
