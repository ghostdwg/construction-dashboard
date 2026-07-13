"use client";

import { useCallback, useEffect, useState } from "react";

type InstalledModel = {
  name: string;
  size_gb: number | null;
  modified_at: string | null;
  parameter_size: string | null;
  quantization: string | null;
  family: string | null;
  loaded: boolean;
};

type Suggestion = {
  name: string;
  size_gb: number;
  context: number;
  note: string;
  recommended: boolean;
  use_case: string;
  installed: boolean;
};

type Health = {
  reachable: boolean;
  url: string;
  default_model: string;
  version: string | null;
  error: string | null;
};

type ModelsResponse = {
  health: Health;
  installed: InstalledModel[];
  suggestions: Suggestion[];
};

const inputCls =
  "rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-[rgba(45,123,255,0.4)]";
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "var(--text)" };

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs >= 1) return `${hrs}h ago`;
  return "fresh";
}

export default function OllamaModelsModal({
  open,
  onClose,
  onPick,
  currentModel,
  pollIntervalMs = 0,
}: {
  open: boolean;
  onClose: () => void;
  onPick?: (model: string) => void;
  currentModel: string | null;
  pollIntervalMs?: number;
}) {
  const [data, setData]         = useState<ModelsResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [pullName, setPullName] = useState("");
  const [pulling, setPulling]   = useState<{ model: string; status: string; pct: number } | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ollama/models", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(json as ModelsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Optional polling — only while open
  useEffect(() => {
    if (!open || !pollIntervalMs || pollIntervalMs < 2000) return;
    const t = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(t);
  }, [open, pollIntervalMs, refresh]);

  async function pullModel(name: string) {
    if (!name.trim() || pulling) return;
    setPullError(null);
    setPulling({ model: name.trim(), status: "starting", pct: 0 });
    try {
      const res = await fetch("/api/ollama/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name.trim() }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setPullError(j.error ?? `HTTP ${res.status}`);
        setPulling(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.error) { setPullError(evt.error); break; }
            const status = String(evt.status ?? "");
            let pct = 0;
            if (evt.total && evt.completed) {
              pct = Math.round((evt.completed / evt.total) * 100);
            }
            setPulling({ model: name.trim(), status, pct });
          } catch { /* ignore non-JSON lines */ }
        }
      }
      setPulling(null);
      setPullName("");
      refresh();
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
      setPulling(null);
    }
  }

  async function deleteModel(name: string) {
    if (!confirm(`Delete ${name}? This frees disk on the GPU PC.`)) return;
    setDeleting(name);
    try {
      await fetch(`/api/ollama/models/${encodeURIComponent(name)}`, { method: "DELETE" });
      refresh();
    } finally {
      setDeleting(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[820px] max-h-[88vh] overflow-y-auto rounded-lg flex flex-col gap-4 p-5"
        style={{ background: "linear-gradient(180deg,#13171f,#0e1119)", border: "1px solid var(--line-strong)", boxShadow: "var(--shadow)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-[700] tracking-[-0.02em]" style={{ color: "var(--text)" }}>
              Ollama Models
            </h2>
            {data?.health && (
              <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
                {data.health.reachable ? (
                  <>
                    <span style={{ color: "var(--signal)" }}>● connected</span> ·{" "}
                    {data.health.url} · v{data.health.version} · default:{" "}
                    <code style={{ color: "var(--text-soft)" }}>{data.health.default_model}</code>
                  </>
                ) : (
                  <span style={{ color: "var(--red)" }}>● unreachable · {data.health.error ?? "no error"}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={refresh} disabled={loading}
              className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
              style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={onClose}
              className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded"
              style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
              Close
            </button>
          </div>
        </div>

        {error && (
          <p className="text-[11px] rounded px-3 py-2 border border-red-900/40 bg-red-900/20" style={{ color: "var(--red)" }}>
            {error}
          </p>
        )}

        {/* Installed */}
        <Section title={`Installed (${data?.installed.length ?? 0})`}>
          {data?.installed.length === 0 ? (
            <Empty text="No models installed on the Ollama server." />
          ) : (
            <div className="flex flex-col divide-y divide-[var(--line)]">
              {data?.installed.map((m) => {
                const isCurrent = currentModel === m.name;
                const isDefault = data.health.default_model === m.name;
                return (
                  <div key={m.name} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-[13px] font-[600]" style={{ color: "var(--text)" }}>{m.name}</code>
                        {m.loaded && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
                            style={{ color: "var(--signal)", background: "rgba(45,123,255,0.08)", border: "1px solid rgba(45,123,255,0.25)" }}>
                            loaded
                          </span>
                        )}
                        {isCurrent && !isDefault && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
                            style={{ color: "#ffcc72", background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.25)" }}>
                            this source
                          </span>
                        )}
                        {isDefault && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
                            style={{ color: "var(--blue)", background: "rgba(126,167,255,0.1)", border: "1px solid rgba(126,167,255,0.2)" }}>
                            sidecar default
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                        {m.size_gb ? `${m.size_gb} GB · ` : ""}
                        {m.parameter_size ?? "?"} params · {m.quantization ?? "?"} · {m.family ?? "?"} · modified {fmtAge(m.modified_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onPick && (
                        <button onClick={() => { onPick(m.name); onClose(); }}
                          className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
                          style={{ color: "var(--signal)", border: "1px solid rgba(45,123,255,0.3)", background: "rgba(45,123,255,0.06)" }}>
                          Use here
                        </button>
                      )}
                      <button onClick={() => deleteModel(m.name)} disabled={deleting === m.name || isDefault}
                        title={isDefault ? "This is the sidecar default; change OLLAMA_MODEL env var to remove it." : "Delete from GPU PC"}
                        className="font-mono text-[10px] uppercase tracking-[0.07em] px-2.5 py-1.5 rounded transition-colors disabled:opacity-30"
                        style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
                        {deleting === m.name ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Pull new */}
        <Section title="Pull a model">
          <div className="px-3 py-2.5 flex flex-col gap-2.5">
            <div className="flex gap-2">
              <input value={pullName} onChange={(e) => setPullName(e.target.value)}
                placeholder="model name (e.g. qwen2.5:32b, gpt-oss:20b)"
                className={`flex-1 ${inputCls}`} style={inputStyle}
                disabled={!!pulling} />
              <button onClick={() => pullModel(pullName)} disabled={!!pulling || !pullName.trim()}
                className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40 transition-colors"
                style={{ background: "var(--signal)", color: "#000" }}>
                {pulling ? "Pulling…" : "Pull"}
              </button>
            </div>

            {pulling && (
              <div className="rounded p-2.5 border" style={{ background: "rgba(45,123,255,0.04)", borderColor: "rgba(45,123,255,0.2)" }}>
                <div className="flex items-center justify-between mb-1.5">
                  <code className="text-[11px]" style={{ color: "var(--text-soft)" }}>{pulling.model}</code>
                  <span className="font-mono text-[10px]" style={{ color: "var(--signal)" }}>{pulling.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full transition-all" style={{ width: `${pulling.pct}%`, background: "var(--signal)" }} />
                </div>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>{pulling.status}</p>
              </div>
            )}
            {pullError && (
              <p className="text-[11px] rounded px-3 py-2 border border-red-900/40 bg-red-900/20" style={{ color: "var(--red)" }}>
                {pullError}
              </p>
            )}
          </div>
        </Section>

        {/* Suggestions */}
        <Section title="Suggested for prefilter workload">
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {data?.suggestions.map((s) => (
              <div key={s.name} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <code className="text-[13px] font-[600]" style={{ color: "var(--text)" }}>{s.name}</code>
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{s.size_gb} GB</span>
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{(s.context / 1024).toFixed(0)}k ctx</span>
                      {s.recommended && (
                        <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
                          style={{ color: "var(--signal)", background: "rgba(45,123,255,0.08)", border: "1px solid rgba(45,123,255,0.25)" }}>
                          recommended
                        </span>
                      )}
                      {s.installed && (
                        <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
                          style={{ color: "var(--text-soft)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
                          installed
                        </span>
                      )}
                    </div>
                    <p className="text-[11px]" style={{ color: "var(--text-soft)" }}>{s.note}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{s.use_case}</p>
                  </div>
                  <div className="shrink-0">
                    {s.installed ? (
                      onPick && (
                        <button onClick={() => { onPick(s.name); onClose(); }}
                          className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
                          style={{ color: "var(--signal)", border: "1px solid rgba(45,123,255,0.3)", background: "rgba(45,123,255,0.06)" }}>
                          Use here
                        </button>
                      )
                    ) : (
                      <button onClick={() => pullModel(s.name)} disabled={!!pulling}
                        className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors disabled:opacity-40"
                        style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
                        Pull
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-[12px] font-[600]" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-6 text-center text-[11px]" style={{ color: "var(--text-dim)" }}>{text}</div>;
}
