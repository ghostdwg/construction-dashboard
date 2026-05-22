"use client";

import { useState, useEffect, useCallback, useTransition, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import OllamaModelsModal from "./OllamaModelsModal";
import { QueueManagerModal } from "./QueueManagerModal";

type RecentDoc = {
  id: string;
  scannedAt: string;
  signalsFound: number;
  documentDate: string | null;
  title: string | null;
};

type PublishStatus = "HEALTHY" | "STALE_PUBLISH" | "OPERATOR_REVIEW";

type Source = {
  id: string;
  name: string;
  jurisdiction: string;
  url: string;
  sourceType: string;
  isActive: boolean;
  lastScannedAt: string | null;
  docsProcessed: number;
  dateFrom: string | null;
  dateTo: string | null;
  minRelevanceScore: number;
  minEstimatedValue: number | null;
  projectTypeAllowlist: string | null;
  prefilterMode: "off" | "large" | "always";
  prefilterCharThreshold: number;
  prefilterModel: string | null;
  // O2.2 PR3 — cadence governance state.
  publishStatus: PublishStatus;
  consecutiveEmptyRuns: number;
  publishCadenceDays: number | null;
  cadenceConfidence: "LOW" | "MEDIUM" | "HIGH" | null;
  docs: RecentDoc[];
  _count: { docs: number };
};

type ScrapeResult = {
  docsFound: number;
  docsInRange: number;
  docsScanned: number;
  docsSkipped: number;
  docsDroppedDate: number;
  docsDroppedUndated: number;
  docsPrefilterApplied: number;
  docsPrefilterSkipped: number;
  docsPrefilterFailed: number;
  totalCharsSaved: number;
  signalsCreated: number;
  leadsCreated: number;
  relationshipsCreated: number;
  signalsDroppedRelevance: number;
  signalsDroppedProjectType: number;
  leadsDroppedValue: number;
  totalCostUsd: number;
  // O2.2 PR3 — hygiene + cadence summary (optional for backward compat).
  signalsSuppressedHeuristics?: number;
  publishStatus?: PublishStatus;
  heuristicsApplied?: boolean;
  error?: string;
};

const TYPE_LABELS: Record<string, string> = {
  city_council:        "Council",
  planning_commission: "Planning",
  permit_feed:         "Permits",
  rss:                 "RSS",
};

const PROJECT_TYPES = [
  "commercial",
  "industrial",
  "institutional",
  "infrastructure",
  "mixed_use",
  "office",
  "municipal",
  "residential_multi",
];

function fmtAge(d: string | null): string {
  if (!d) return "Never";
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000);
  if (h < 1)  return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

const chipBase: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.1)",
  whiteSpace: "nowrap",
};

const inputCls =
  "rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-[rgba(0,255,100,0.4)]";
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "var(--text)" };
const labelCls = "font-mono text-[9px] uppercase tracking-[0.08em]";
const labelStyle: React.CSSProperties = { color: "var(--text-dim)" };

export default function SourcesPanel() {
  const [sources, setSources]   = useState<Source[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [showQueueManager, setShowQueueManager] = useState(false);
  const [scraping, setScraping] = useState<string | null>(null);
  const [results, setResults]   = useState<Record<string, ScrapeResult | undefined>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queueSummary, setQueueSummary] = useState<{ queuedCount: number; nextRunAt: string | null; recentlyCompleted: number }>({ queuedCount: 0, nextRunAt: null, recentlyCompleted: 0 });
  const [, startTransition]     = useTransition();

  const load = useCallback(async () => {
    const res = await fetch("/api/market-intelligence/sources", { cache: "no-store" });
    const d = await res.json() as { sources: Source[] };
    setSources(d.sources ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll queue status every 30s so the user sees background scrapes finish
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/jobs/queue", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { jobs: Array<{ status: string; runAfter: string | null; completedAt: string | null }> };
        if (cancelled) return;
        const queued = data.jobs.filter((j) => j.status === "queued");
        const completedRecently = data.jobs.filter((j) =>
          j.status === "completed" && j.completedAt &&
          Date.now() - new Date(j.completedAt).getTime() < 12 * 3_600_000
        ).length;
        const next = queued
          .map((j) => j.runAfter ? new Date(j.runAfter).getTime() : Infinity)
          .reduce((a, b) => Math.min(a, b), Infinity);
        setQueueSummary({
          queuedCount: queued.length,
          nextRunAt: queued.length && Number.isFinite(next) ? new Date(next).toISOString() : null,
          recentlyCompleted: completedRecently,
        });
      } catch { /* ignore */ }
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  async function runScrape(sourceId: string, override?: { dateFrom?: string; dateTo?: string; maxDocs?: number }) {
    setScraping(sourceId);
    setResults((r) => ({ ...r, [sourceId]: undefined }));
    try {
      const res = await fetch(`/api/market-intelligence/sources/${sourceId}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(override ?? {}),
      });
      const d = await res.json() as ScrapeResult;
      setResults((r) => ({ ...r, [sourceId]: d }));
      startTransition(() => { load(); });
    } catch (err) {
      setResults((r) => ({ ...r, [sourceId]: { ...(r[sourceId] as ScrapeResult), error: err instanceof Error ? err.message : String(err) } as ScrapeResult }));
    } finally {
      setScraping(null);
    }
  }

  async function toggleActive(s: Source) {
    setSources((prev) => prev.map((p) => p.id === s.id ? { ...p, isActive: !p.isActive } : p));
    await fetch("/api/market-intelligence/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isActive: !s.isActive }),
    });
  }

  // O2.2 PR3 — reset publishStatus back to HEALTHY (operator override after
  // dormancy detection wrongly suspended a known-good source).
  async function resetPublishStatus(s: Source) {
    setSources((prev) => prev.map((p) => p.id === s.id
      ? { ...p, publishStatus: "HEALTHY" as PublishStatus, consecutiveEmptyRuns: 0 }
      : p));
    await fetch("/api/market-intelligence/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, publishStatus: "HEALTHY" }),
    });
  }

  return (
    <div
      className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div>
          <p className="text-sm font-[700]" style={{ color: "var(--text)" }}>Scrape Sources</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>
            Configured municipality feeds · date-bounded · per-source relevance &amp; value floors
          </p>
          {(queueSummary.queuedCount > 0 || queueSummary.recentlyCompleted > 0) && (
            <p className="font-mono text-[10px] mt-1" style={{ color: "var(--text-soft)" }}>
              {queueSummary.queuedCount > 0 && (
                <>
                  <span style={{ color: "#ffcc72" }}>● {queueSummary.queuedCount} queued</span>
                  {queueSummary.nextRunAt && (
                    <> · next at {new Date(queueSummary.nextRunAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>
                  )}
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => setShowQueueManager(true)}
                      className="underline hover:no-underline"
                      style={{ color: "#ffcc72", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                    >manage</button>
                  </>
                </>
              )}
              {queueSummary.queuedCount > 0 && queueSummary.recentlyCompleted > 0 && " · "}
              {queueSummary.recentlyCompleted > 0 && (
                <span style={{ color: "var(--signal)" }}>● {queueSummary.recentlyCompleted} completed in last 12h</span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
          style={{
            color:      showAdd ? "var(--signal)" : "var(--text-dim)",
            border:     `1px solid ${showAdd ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
            background: showAdd ? "rgba(0,255,100,0.06)" : "transparent",
          }}
        >
          + Add Source
        </button>
      </div>

      {showAdd && <AddSourceForm onAdded={() => { setShowAdd(false); load(); }} />}
      {showQueueManager && <QueueManagerModal onClose={() => setShowQueueManager(false)} />}

      {loading ? (
        <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-dim)" }}>Loading…</div>
      ) : sources.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-[500]" style={{ color: "var(--text-soft)" }}>No sources configured</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
            Add a city council minutes page and the scraper will find new documents automatically.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {sources.map((src) => {
            const isScraping = scraping === src.id;
            const result = results[src.id];
            const isExpanded = expanded === src.id;
            return (
              <SourceRow
                key={src.id}
                source={src}
                isScraping={isScraping}
                result={result}
                isExpanded={isExpanded}
                onExpand={() => setExpanded(isExpanded ? null : src.id)}
                onScrape={(override) => runScrape(src.id, override)}
                onToggleActive={() => toggleActive(src)}
                onResetPublishStatus={() => resetPublishStatus(src)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Add Source form ─────────────────────────────────────────────────────────

function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName]               = useState("");
  const [jurisdiction, setJuris]      = useState("");
  const [url, setUrl]                 = useState("");
  const [sourceType, setType]         = useState("city_council");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [minRelevance, setMinRelevance] = useState(60);
  const [minValue, setMinValue]       = useState("");
  const [allowedTypes, setAllowedTypes] = useState<Set<string>>(new Set());
  const [prefilterMode, setPrefilterMode] = useState<"off" | "large" | "always">("off");
  const [prefilterThreshold, setPrefilterThreshold] = useState(30000);
  const [prefilterModel, setPrefilterModel] = useState<string | null>(null);
  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [advanced, setAdvanced]       = useState(false);
  const [saving, setSaving]           = useState(false);

  const canSave = name.trim() && jurisdiction.trim() && url.trim();

  function toggleType(t: string) {
    setAllowedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    await fetch("/api/market-intelligence/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, jurisdiction, url, sourceType,
        dateFrom: dateFrom || null,
        dateTo:   dateTo   || null,
        minRelevanceScore: minRelevance,
        minEstimatedValue: minValue ? Number(minValue) : null,
        projectTypeAllowlist: allowedTypes.size ? Array.from(allowedTypes).join(",") : null,
        prefilterMode,
        prefilterCharThreshold: prefilterThreshold,
        prefilterModel,
      }),
    });
    setSaving(false);
    onAdded();
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--line)] flex flex-col gap-2.5" style={{ background: "rgba(0,255,100,0.03)" }}>
      <div className="flex gap-2">
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Source name (e.g. Norwalk IA — P&Z)"
          className={`flex-1 ${inputCls}`} style={inputStyle}
        />
        <select
          value={sourceType} onChange={(e) => setType(e.target.value)}
          className={inputCls} style={inputStyle}
        >
          <option value="city_council">City Council</option>
          <option value="planning_commission">Planning Commission</option>
          <option value="permit_feed">Permit Feed</option>
          <option value="energov">Tyler EnerGov (CSS)</option>
          <option value="rss">RSS</option>
        </select>
      </div>
      <div className="flex gap-2">
        <input
          type="text" value={jurisdiction} onChange={(e) => setJuris(e.target.value)}
          placeholder="Jurisdiction (e.g. Norwalk, IA)"
          className={`w-48 ${inputCls}`} style={inputStyle}
        />
        <input
          type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="Listing page URL (minutes index or agenda archive)"
          className={`flex-1 ${inputCls}`} style={inputStyle}
        />
      </div>

      <button
        type="button"
        onClick={() => setAdvanced(!advanced)}
        className="self-start font-mono text-[10px] uppercase tracking-[0.07em] py-1"
        style={{ color: "var(--text-dim)" }}
      >
        {advanced ? "▾" : "▸"} Advanced tuning
      </button>

      {advanced && (
        <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-[rgba(0,255,100,0.15)]">
          <div className="flex flex-col gap-1.5">
            <label className={labelCls} style={labelStyle}>Scrape from (inclusive)</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls} style={labelStyle}>Scrape to (inclusive)</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls} style={labelStyle}>Min relevance score (0–100, default 60)</label>
            <input type="number" min={0} max={100} value={minRelevance}
              onChange={(e) => setMinRelevance(Number(e.target.value))}
              className={inputCls} style={inputStyle} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls} style={labelStyle}>Min estimated value ($, optional)</label>
            <input type="number" min={0} value={minValue}
              onChange={(e) => setMinValue(e.target.value)} placeholder="e.g. 1000000"
              className={inputCls} style={inputStyle} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className={labelCls} style={labelStyle}>Project type allowlist (empty = all)</label>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_TYPES.map((t) => {
                const active = allowedTypes.has(t);
                return (
                  <button
                    key={t} type="button" onClick={() => toggleType(t)}
                    className="font-mono text-[10px] uppercase tracking-[0.07em] px-2.5 py-1 rounded-full"
                    style={{
                      color: active ? "var(--signal)" : "var(--text-dim)",
                      background: active ? "rgba(0,255,100,0.08)" : "transparent",
                      border: `1px solid ${active ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
                    }}
                  >
                    {t.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5 pt-1.5 mt-1 border-t border-[var(--line)]">
            <label className={labelCls} style={labelStyle}>
              Cost control — Ollama prefilter (local LLM on GPU PC strips boilerplate before Claude)
            </label>
            <div className="flex gap-2 items-center flex-wrap">
              {(["off", "large", "always"] as const).map((mode) => {
                const active = prefilterMode === mode;
                const label  = mode === "off" ? "Off — direct to Claude"
                            : mode === "large" ? "Auto — only large docs"
                            : "Always";
                return (
                  <button
                    key={mode} type="button" onClick={() => setPrefilterMode(mode)}
                    className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded-full"
                    style={{
                      color: active ? "var(--signal)" : "var(--text-dim)",
                      background: active ? "rgba(0,255,100,0.08)" : "transparent",
                      border: `1px solid ${active ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              {prefilterMode === "large" && (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>threshold</span>
                  <input type="number" min={5000} step={5000} value={prefilterThreshold}
                    onChange={(e) => setPrefilterThreshold(Math.max(5000, Number(e.target.value) || 30000))}
                    className={`w-28 ${inputCls}`} style={inputStyle} />
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>chars</span>
                </div>
              )}
            </div>
            <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {prefilterMode === "off"   && "Every scanned doc → Claude. Worst-case ~$0.10/doc."}
              {prefilterMode === "large" && `Docs over ${prefilterThreshold.toLocaleString()} chars get pre-filtered by local Ollama first. Empty docs skip Claude entirely.`}
              {prefilterMode === "always" && "Every doc → Ollama strip → Claude only on excerpts. Slowest, cheapest."}
            </p>
            {prefilterMode !== "off" && (
              <div className="flex items-center gap-2 pt-2 mt-1.5 border-t border-[var(--line)]">
                <span className={labelCls} style={labelStyle}>Model:</span>
                <code className="text-[11px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: prefilterModel ? "var(--text)" : "var(--text-dim)" }}>
                  {prefilterModel ?? "(sidecar default)"}
                </code>
                <button type="button" onClick={() => setModelsModalOpen(true)}
                  className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1 rounded transition-colors"
                  style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
                  Pick / Manage
                </button>
                {prefilterModel && (
                  <button type="button" onClick={() => setPrefilterModel(null)}
                    className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                    reset to default
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <OllamaModelsModal
        open={modelsModalOpen}
        onClose={() => setModelsModalOpen(false)}
        onPick={(m) => setPrefilterModel(m)}
        currentModel={prefilterModel}
      />

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={save} disabled={saving || !canSave}
          className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40 transition-colors"
          style={{ background: "var(--signal)", color: "#000" }}>
          {saving ? "Saving…" : "Add Source"}
        </button>
      </div>
    </div>
  );
}

// ── Source row ──────────────────────────────────────────────────────────────

function SourceRow({
  source: src, isScraping, result, isExpanded, onExpand, onScrape, onToggleActive, onResetPublishStatus,
}: {
  source: Source;
  isScraping: boolean;
  result: ScrapeResult | undefined;
  isExpanded: boolean;
  onExpand: () => void;
  onScrape: (override?: { dateFrom?: string; dateTo?: string; maxDocs?: number }) => void;
  onToggleActive: () => void;
  onResetPublishStatus: () => void;
}) {
  const [overrideOpen, setOverrideOpen]     = useState(false);
  const [overrideFrom, setOverrideFrom]     = useState("");
  const [overrideTo, setOverrideTo]         = useState("");
  // Anchor + position for the override popover. We portal it to document.body
  // so the outer panel's overflow-hidden (needed for rounded corners) doesn't
  // clip it — and re-measure on open/scroll/resize.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!overrideOpen) return;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopoverPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [overrideOpen]);
  // Sync scrape stays bounded at 5 (cost guardrail). Queued (overnight)
  // scrape defaults to 200 — enough to backfill a typical Iowa city's
  // 1-2 year archive in one run.
  const [maxDocsRun, setMaxDocsRun]         = useState(5);
  const [maxDocsQueue, setMaxDocsQueue]     = useState(200);

  function startScrape() {
    const opts: { dateFrom?: string; dateTo?: string; maxDocs?: number } = {};
    if (overrideFrom) opts.dateFrom = overrideFrom;
    if (overrideTo)   opts.dateTo   = overrideTo;
    if (maxDocsRun !== 5) opts.maxDocs = maxDocsRun;
    onScrape(Object.keys(opts).length ? opts : undefined);
    setOverrideOpen(false);
  }

  async function queueScrape() {
    const body: Record<string, unknown> = { maxDocs: maxDocsQueue };
    if (overrideFrom) body.dateFrom = overrideFrom;
    if (overrideTo)   body.dateTo   = overrideTo;
    const res = await fetch(`/api/market-intelligence/sources/${src.id}/queue-scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setOverrideOpen(false);
    if (!res.ok) {
      alert(`Queue failed: ${data.error ?? res.status}`);
      return;
    }
    const when = new Date(data.runAfter).toLocaleString();
    const prefilterNote = src.prefilterMode === "off"
      ? `\n\nCost estimate (no prefilter): ~$${(maxDocsQueue * 0.05).toFixed(2)} max. Turn on Ollama prefilter to cut this ~10×.`
      : "";
    alert(`Queued — up to ${maxDocsQueue} docs · runs ${when}${prefilterNote}`);
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span style={{ ...chipBase, color: "var(--blue)", background: "rgba(126,167,255,0.1)", borderColor: "rgba(126,167,255,0.2)" }}>
              {TYPE_LABELS[src.sourceType] ?? src.sourceType}
            </span>
            <p className="text-sm font-[600] truncate" style={{ color: "var(--text)" }}>{src.name}</p>
            {!src.isActive && (
              <span style={{ ...chipBase, color: "var(--text-dim)", background: "rgba(255,255,255,0.04)" }}>paused</span>
            )}
            {/* O2.2 PR3 — publishStatus badge. HEALTHY is the default and not surfaced. */}
            {src.publishStatus === "STALE_PUBLISH" && (
              <span
                style={{ ...chipBase, color: "#ffcc72", background: "rgba(245,166,35,0.1)", borderColor: "rgba(245,166,35,0.25)" }}
                title={`${src.consecutiveEmptyRuns} consecutive empty runs past expected publish — auto-paused by dormancy detection. Click "Mark healthy" to reset.`}
              >
                stale · {src.consecutiveEmptyRuns} empty
              </span>
            )}
            {src.publishStatus === "OPERATOR_REVIEW" && (
              <span
                style={{ ...chipBase, color: "var(--red)", background: "rgba(255,80,80,0.08)", borderColor: "rgba(255,80,80,0.25)" }}
                title="Held by operator review — runner will not auto-poll until reset."
              >
                operator review
              </span>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>{src.jurisdiction}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
              {src._count.docs} docs · last scan {fmtAge(src.lastScannedAt)}
            </span>
            {(src.dateFrom || src.dateTo) && (
              <span style={{ ...chipBase, color: "var(--text-soft)" }}>
                {fmtDate(src.dateFrom)} → {fmtDate(src.dateTo)}
              </span>
            )}
            {src.minRelevanceScore !== 60 && (
              <span style={{ ...chipBase, color: "var(--text-soft)" }}>relevance ≥ {src.minRelevanceScore}</span>
            )}
            {src.minEstimatedValue != null && (
              <span style={{ ...chipBase, color: "var(--text-soft)" }}>≥ {fmtMoney(src.minEstimatedValue)}</span>
            )}
            {src.projectTypeAllowlist && (
              <span style={{ ...chipBase, color: "var(--text-soft)" }} title={src.projectTypeAllowlist}>
                {src.projectTypeAllowlist.split(",").length} types
              </span>
            )}
            {src.prefilterMode !== "off" && (
              <span style={{ ...chipBase, color: "#ffcc72", background: "rgba(245,166,35,0.08)", borderColor: "rgba(245,166,35,0.25)" }}
                title={`Ollama prefilter: ${src.prefilterMode}${src.prefilterMode === "large" ? ` @ ${src.prefilterCharThreshold.toLocaleString()} chars` : ""}${src.prefilterModel ? ` · model: ${src.prefilterModel}` : ""}`}>
                prefilter: {src.prefilterMode}{src.prefilterMode === "large" ? ` ≥${Math.round(src.prefilterCharThreshold / 1000)}k` : ""}{src.prefilterModel ? ` · ${src.prefilterModel}` : ""}
              </span>
            )}
            {result && !result.error && (
              <span className="font-mono text-[10px]" style={{ color: "var(--signal)" }}>
                +{result.signalsCreated} sig · +{result.leadsCreated} leads · ${result.totalCostUsd.toFixed(3)}
              </span>
            )}
            {result?.error && (
              <span className="font-mono text-[10px]" style={{ color: "var(--red)" }}>{result.error}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {(src.publishStatus === "STALE_PUBLISH" || src.publishStatus === "OPERATOR_REVIEW") && (
            <button
              onClick={onResetPublishStatus}
              className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-1.5 rounded transition-colors"
              style={{ color: "#ffcc72", border: "1px solid rgba(245,166,35,0.3)", background: "rgba(245,166,35,0.05)" }}
              title="Reset publishStatus → HEALTHY and clear empty-run counter."
            >
              Mark healthy
            </button>
          )}
          <button onClick={onToggleActive}
            className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-1.5 rounded transition-colors"
            style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
            {src.isActive ? "Pause" : "Resume"}
          </button>
          <button onClick={onExpand}
            className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-1.5 rounded transition-colors"
            style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
            {isExpanded ? "Hide" : "Docs"}
          </button>
          <div>
            <button
              ref={triggerRef}
              onClick={() => setOverrideOpen(!overrideOpen)}
              disabled={isScraping || !src.isActive}
              className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors disabled:opacity-40"
              style={{
                color:      isScraping ? "var(--signal)" : "var(--text-dim)",
                border:     `1px solid ${isScraping ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
                background: isScraping ? "rgba(0,255,100,0.06)" : "transparent",
              }}>
              {isScraping ? "Scanning…" : "Scrape Now"}
            </button>
            {overrideOpen && !isScraping && popoverPos && typeof document !== "undefined" && createPortal(
              <>
                <div
                  onClick={() => setOverrideOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 49 }}
                />
                <div
                  className="rounded p-3 flex flex-col gap-2.5"
                  style={{
                    position: "fixed",
                    top: popoverPos.top,
                    right: popoverPos.right,
                    width: 320,
                    zIndex: 50,
                    background: "rgba(14,17,23,0.98)",
                    border: "1px solid var(--line)",
                    boxShadow: "var(--shadow)",
                  }}
                >
                <div>
                  <p className="text-[11px] mb-1.5" style={{ color: "var(--text-soft)" }}>Date range (optional)</p>
                  <div className="flex gap-2">
                    <input type="date" value={overrideFrom} onChange={(e) => setOverrideFrom(e.target.value)}
                      className={`flex-1 ${inputCls}`} style={inputStyle} placeholder="From" />
                    <input type="date" value={overrideTo} onChange={(e) => setOverrideTo(e.target.value)}
                      className={`flex-1 ${inputCls}`} style={inputStyle} placeholder="To" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] mb-1 font-mono uppercase tracking-[0.07em]" style={{ color: "var(--text-dim)" }}>Run now · max docs</p>
                    <input type="number" min={1} max={50} value={maxDocsRun}
                      onChange={(e) => setMaxDocsRun(Math.max(1, Math.min(50, Number(e.target.value) || 5)))}
                      className={`w-full ${inputCls}`} style={inputStyle} />
                  </div>
                  <div>
                    <p className="text-[10px] mb-1 font-mono uppercase tracking-[0.07em]" style={{ color: "var(--text-dim)" }}>Queue · max docs</p>
                    <input type="number" min={1} max={1000} value={maxDocsQueue}
                      onChange={(e) => setMaxDocsQueue(Math.max(1, Math.min(1000, Number(e.target.value) || 200)))}
                      className={`w-full ${inputCls}`} style={inputStyle} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setOverrideOpen(false)} className="text-xs px-3 py-1 rounded" style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
                    Cancel
                  </button>
                  <button onClick={queueScrape} className="text-xs px-3 py-1 rounded font-[600]" style={{ background: "rgba(255,255,255,0.05)", color: "var(--text)", border: "1px solid var(--line)" }} title="Queue this scrape to run tonight at 2am">
                    Queue tonight
                  </button>
                  <button onClick={startScrape} className="text-xs px-3 py-1 rounded font-[600]" style={{ background: "var(--signal)", color: "#000" }}>
                    Run now
                  </button>
                </div>
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>
      </div>

      {/* Result breakdown */}
      {result && !result.error && (
        <>
          <div className="mt-2.5 grid grid-cols-7 gap-2 text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
            <Metric label="found"        value={result.docsFound} />
            <Metric label="in range"     value={result.docsInRange} />
            <Metric label="scanned"      value={result.docsScanned} />
            <Metric label="dedup skip"   value={result.docsSkipped} />
            <Metric label="date drop"    value={result.docsDroppedDate + result.docsDroppedUndated} />
            <Metric label="rel drop"     value={result.signalsDroppedRelevance + result.signalsDroppedProjectType} />
            <Metric label="val drop"     value={result.leadsDroppedValue} />
          </div>
          {(result.docsPrefilterApplied > 0 || result.docsPrefilterSkipped > 0 || result.docsPrefilterFailed > 0) && (
            <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
              <span style={{ color: "#ffcc72" }}>prefilter:</span>
              <span>{result.docsPrefilterApplied} condensed</span>
              <span>·</span>
              <span style={{ color: "var(--signal)" }}>{result.docsPrefilterSkipped} skipped (empty)</span>
              {result.docsPrefilterFailed > 0 && <>
                <span>·</span>
                <span style={{ color: "var(--red)" }}>{result.docsPrefilterFailed} Ollama failed (used direct)</span>
              </>}
              {result.totalCharsSaved > 0 && <>
                <span>·</span>
                <span>~{(result.totalCharsSaved / 1000).toFixed(1)}K chars saved</span>
              </>}
            </div>
          )}
        </>
      )}

      {/* Recent docs accordion */}
      {isExpanded && (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          {src.docs.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>No documents scanned yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {src.docs.map((d) => (
                <Link key={d.id} href={`/market-intelligence/docs/${d.id}`}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded hover:bg-[rgba(255,255,255,0.03)] transition-colors">
                  <div className="min-w-0">
                    <p className="text-[12px] truncate" style={{ color: "var(--text-soft)" }}>{d.title || "(untitled)"}</p>
                    <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                      doc date {fmtDate(d.documentDate)} · scanned {fmtAge(d.scannedAt)} · {d.signalsFound} signals
                    </p>
                  </div>
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1.5 py-1 rounded" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}>
      <span className="text-[14px]" style={{ color: value > 0 ? "var(--text)" : "var(--text-dim)" }}>{value}</span>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
    </div>
  );
}
