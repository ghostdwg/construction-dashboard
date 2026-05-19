"use client";

import { useState } from "react";

type CandidatePage = {
  url: string;
  link_text: string | null;
  inferred_type: string;          // city_council | planning_commission | generic
  viable: boolean;
  recent_doc_count: number;
  last_doc_date: string | null;
  preview_titles: string[];
  error?: string | null;
};

type Municipality = {
  name: string;
  state: string | null;
  distance_miles: number;
  website: string | null;
  candidates: CandidatePage[];
  error?: string | null;
};

type DiscoverResponse = {
  center: { lat: number; lon: number; label: string | null };
  radius_miles: number;
  municipalities_found: number;
  municipalities_with_candidates: number;
  municipalities: Municipality[];
};

type SelectedKey = string; // `${muniIdx}:${candIdx}`

const inputCls =
  "rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-[rgba(0,255,100,0.4)]";
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "var(--text)" };

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

export default function DiscoverPanel({ onSourcesAdded }: { onSourcesAdded?: () => void } = {}) {
  const [open, setOpen]       = useState(false);
  const [center, setCenter]   = useState("Des Moines, IA");
  const [radius, setRadius]   = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<DiscoverResponse | null>(null);
  const [selected, setSelected] = useState<Set<SelectedKey>>(new Set());
  const [adding, setAdding]   = useState(false);
  const [addResult, setAddResult] = useState<{ created: number; skipped: number } | null>(null);

  async function runDiscovery() {
    setLoading(true);
    setError(null);
    setData(null);
    setSelected(new Set());
    setAddResult(null);
    try {
      const res = await fetch("/api/market-intelligence/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ center: center.trim(), radius_miles: radius }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(json as DiscoverResponse);
      // Pre-select all viable candidates
      const auto = new Set<SelectedKey>();
      (json as DiscoverResponse).municipalities.forEach((m, mi) => {
        m.candidates.forEach((c, ci) => {
          if (c.viable) auto.add(`${mi}:${ci}`);
        });
      });
      setSelected(auto);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: SelectedKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function addSelected() {
    if (!data || selected.size === 0) return;
    setAdding(true);
    setAddResult(null);
    try {
      const payload = Array.from(selected).map((k) => {
        const [mi, ci] = k.split(":").map(Number);
        const muni = data.municipalities[mi];
        const cand = muni.candidates[ci];
        const stateSuffix = muni.state ? `, ${muni.state}` : "";
        return {
          name: `${muni.name}${stateSuffix} — ${cand.inferred_type === "planning_commission" ? "P&Z" : "Council"}`,
          jurisdiction: `${muni.name}${stateSuffix}`,
          url: cand.url,
          sourceType: cand.inferred_type === "generic" ? "city_council" : cand.inferred_type,
        };
      });
      const res = await fetch("/api/market-intelligence/sources/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: payload }),
      });
      const json = await res.json();
      setAddResult({ created: json.totalCreated ?? 0, skipped: json.totalSkipped ?? 0 });
      if (onSourcesAdded) onSourcesAdded();
      else if (typeof window !== "undefined") window.location.reload();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div>
          <p className="text-sm font-[700]" style={{ color: "var(--text)" }}>Discover Sources</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>
            Find council &amp; planning pages within a radius · auto-validates recent activity
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
          style={{
            color: open ? "var(--signal)" : "var(--text-dim)",
            border: `1px solid ${open ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
            background: open ? "rgba(0,255,100,0.06)" : "transparent",
          }}
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>

      {open && (
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Center (city, state)</label>
              <input value={center} onChange={(e) => setCenter(e.target.value)} className={inputCls} style={inputStyle} placeholder="Des Moines, IA" />
            </div>
            <div className="w-36 flex flex-col gap-1.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Radius (miles)</label>
              <input type="number" min={1} max={100} value={radius}
                onChange={(e) => setRadius(Math.max(1, Math.min(100, Number(e.target.value))))}
                className={inputCls} style={inputStyle} />
            </div>
            <button onClick={runDiscovery} disabled={loading || !center.trim()}
              className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40 transition-colors"
              style={{ background: "var(--signal)", color: "#000" }}>
              {loading ? "Searching…" : "Discover"}
            </button>
          </div>

          {error && (
            <p className="text-[11px] rounded px-3 py-2 border border-red-900/40 bg-red-900/20" style={{ color: "var(--red)" }}>
              {error}
            </p>
          )}

          {loading && (
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              Geocoding center → querying OpenStreetMap for cities → resolving websites → validating doc pages. Takes 30–60s.
            </p>
          )}

          {data && (
            <>
              <div className="flex items-center justify-between px-2 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-[11px]" style={{ color: "var(--text-soft)" }}>
                  <strong>{data.municipalities_found}</strong> municipalities within {data.radius_miles} mi ·{" "}
                  <strong style={{ color: "var(--signal)" }}>{data.municipalities_with_candidates}</strong> with active doc pages ·{" "}
                  <strong>{selected.size}</strong> selected
                </p>
                <button onClick={addSelected} disabled={adding || selected.size === 0}
                  className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40 transition-colors"
                  style={{ background: "var(--signal)", color: "#000" }}>
                  {adding ? "Adding…" : `Add ${selected.size} source${selected.size === 1 ? "" : "s"}`}
                </button>
              </div>

              {addResult && (
                <p className="text-[11px] rounded px-3 py-2" style={{ color: "var(--signal)", background: "rgba(0,255,100,0.06)", border: "1px solid rgba(0,255,100,0.2)" }}>
                  Created {addResult.created} new sources{addResult.skipped > 0 ? `, skipped ${addResult.skipped} (already exist or invalid)` : ""}.
                </p>
              )}

              <div className="flex flex-col divide-y divide-[var(--line)] max-h-[480px] overflow-y-auto rounded border border-[var(--line)]">
                {data.municipalities.map((m, mi) => (
                  <MuniBlock key={mi} mi={mi} muni={m} selected={selected} onToggle={toggle} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MuniBlock({
  mi, muni, selected, onToggle,
}: {
  mi: number;
  muni: Municipality;
  selected: Set<SelectedKey>;
  onToggle: (k: SelectedKey) => void;
}) {
  const hasViable = muni.candidates.some((c) => c.viable);
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-[600]" style={{ color: hasViable ? "var(--text)" : "var(--text-dim)" }}>
            {muni.name}{muni.state ? `, ${muni.state}` : ""} <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>· {muni.distance_miles} mi</span>
          </p>
          {muni.website && (
            <a href={muni.website} target="_blank" rel="noreferrer"
              className="text-[10px] hover:underline truncate inline-block max-w-[400px]"
              style={{ color: "var(--text-dim)" }}>{muni.website}</a>
          )}
          {muni.error && (
            <p className="text-[10px]" style={{ color: "var(--red)" }}>{muni.error}</p>
          )}
        </div>
      </div>

      {muni.candidates.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {muni.candidates.map((c, ci) => {
            const key = `${mi}:${ci}` as SelectedKey;
            const checked = selected.has(key);
            return (
              <label key={ci} className="flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[rgba(255,255,255,0.025)]">
                <input type="checkbox" checked={checked} onChange={() => onToggle(key)}
                  className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span style={{ ...chipBase, color: c.inferred_type === "planning_commission" ? "#ffcc72" : c.inferred_type === "city_council" ? "var(--blue)" : "var(--text-dim)", background: "rgba(255,255,255,0.04)" }}>
                      {c.inferred_type.replace("_", " ")}
                    </span>
                    {c.viable && (
                      <span style={{ ...chipBase, color: "var(--signal)", background: "rgba(0,255,100,0.08)", borderColor: "rgba(0,255,100,0.25)" }}>viable</span>
                    )}
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-soft)" }}>
                      {c.recent_doc_count} recent · last {c.last_doc_date ?? "—"}
                    </span>
                  </div>
                  <p className="text-[11px] truncate" style={{ color: "var(--text-soft)" }}>
                    {c.link_text || c.url.split("/").slice(-2).join("/")}
                  </p>
                  {c.preview_titles.length > 0 && (
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-dim)" }}>
                      e.g. {c.preview_titles.slice(0, 3).join(" · ")}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
