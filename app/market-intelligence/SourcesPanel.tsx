"use client";

import { useState, useEffect, useCallback } from "react";

type Source = {
  id: string;
  name: string;
  jurisdiction: string;
  url: string;
  sourceType: string;
  isActive: boolean;
  lastScannedAt: string | null;
  docsProcessed: number;
  docs: { scannedAt: string; signalsFound: number }[];
  _count: { docs: number };
};

type ScrapeResult = {
  docsFound: number;
  docsScanned: number;
  docsSkipped: number;
  signalsCreated: number;
  leadsCreated: number;
  relationshipsCreated: number;
  totalCostUsd: number;
  error?: string;
};

const TYPE_LABELS: Record<string, string> = {
  city_council:        "Council",
  planning_commission: "Planning",
  permit_feed:         "Permits",
  rss:                 "RSS",
};

function fmtAge(d: string | null): string {
  if (!d) return "Never";
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000);
  if (h < 1)  return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SourcesPanel() {
  const [sources, setSources]     = useState<Source[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [scraping, setScraping]   = useState<string | null>(null);
  const [results, setResults]     = useState<Record<string, ScrapeResult>>({});

  // Add form state
  const [name, setName]         = useState("");
  const [jurisdiction, setJuris]= useState("");
  const [url, setUrl]           = useState("");
  const [sourceType, setType]   = useState("city_council");
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/market-intelligence/sources");
    const d = await res.json() as { sources: Source[] };
    setSources(d.sources ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addSource() {
    if (!name.trim() || !url.trim() || !jurisdiction.trim()) return;
    setSaving(true);
    await fetch("/api/market-intelligence/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, jurisdiction, url, sourceType }),
    });
    setName(""); setJuris(""); setUrl(""); setType("city_council");
    setShowAdd(false);
    setSaving(false);
    load();
  }

  async function runScrape(sourceId: string) {
    setScraping(sourceId);
    setResults((r) => ({ ...r, [sourceId]: undefined as unknown as ScrapeResult }));
    try {
      const res = await fetch(`/api/market-intelligence/sources/${sourceId}/scrape`, { method: "POST" });
      const d = await res.json() as ScrapeResult;
      setResults((r) => ({ ...r, [sourceId]: d }));
      load();
      if (d.leadsCreated > 0 || d.signalsCreated > 0) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } finally {
      setScraping(null);
    }
  }

  return (
    <div
      className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div>
          <p className="text-sm font-[700]" style={{ color: "var(--text)" }}>Scrape Sources</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>
            Configured municipality feeds · auto-scan for new documents
          </p>
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

      {/* Add form */}
      {showAdd && (
        <div className="px-4 py-3 border-b border-[var(--line)] flex flex-col gap-2" style={{ background: "rgba(0,255,100,0.03)" }}>
          <div className="flex gap-2">
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Source name (e.g. Springfield City Council)"
              className="flex-1 rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none"
              style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
            />
            <select
              value={sourceType} onChange={(e) => setType(e.target.value)}
              className="rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none"
              style={{ background: "rgba(20,24,32,0.98)", color: "var(--text)" }}
            >
              <option value="city_council">City Council</option>
              <option value="planning_commission">Planning Commission</option>
              <option value="permit_feed">Permit Feed</option>
              <option value="rss">RSS</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input
              type="text" value={jurisdiction} onChange={(e) => setJuris(e.target.value)}
              placeholder="Jurisdiction (e.g. Springfield, MA)"
              className="w-48 rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none"
              style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
            />
            <input
              type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="Listing page URL (minutes index or agenda archive)"
              className="flex-1 rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none"
              style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="text-xs px-3 py-1.5 rounded border border-[var(--line)]" style={{ color: "var(--text-dim)" }}>
              Cancel
            </button>
            <button
              onClick={addSource} disabled={saving || !name.trim() || !url.trim() || !jurisdiction.trim()}
              className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40 transition-colors"
              style={{ background: "var(--signal)", color: "#000" }}
            >
              {saving ? "Saving…" : "Add Source"}
            </button>
          </div>
        </div>
      )}

      {/* Source list */}
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
            return (
              <div key={src.id} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
                      style={{ color: "var(--blue)", background: "rgba(126,167,255,0.1)", border: "1px solid rgba(126,167,255,0.2)" }}
                    >
                      {TYPE_LABELS[src.sourceType] ?? src.sourceType}
                    </span>
                    <p className="text-sm font-[600] truncate" style={{ color: "var(--text)" }}>{src.name}</p>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>{src.jurisdiction}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                      {src._count.docs} docs · last scan {fmtAge(src.lastScannedAt)}
                    </span>
                    {result && !result.error && (
                      <span className="font-mono text-[10px]" style={{ color: "var(--signal)" }}>
                        +{result.signalsCreated} signals · +{result.leadsCreated} leads · ${result.totalCostUsd.toFixed(3)}
                      </span>
                    )}
                    {result?.error && (
                      <span className="font-mono text-[10px]" style={{ color: "var(--red)" }}>{result.error}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => runScrape(src.id)}
                  disabled={isScraping || !src.isActive}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors disabled:opacity-40"
                  style={{
                    color:      isScraping ? "var(--signal)" : "var(--text-dim)",
                    border:     `1px solid ${isScraping ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
                    background: isScraping ? "rgba(0,255,100,0.06)" : "transparent",
                  }}
                >
                  {isScraping ? "Scanning…" : "Scrape Now"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
