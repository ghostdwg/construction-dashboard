"use client";

import { useState } from "react";

type ScanResult = {
  signalsCreated: number;
  leadsCreated: number;
  relationshipsCreated: number;
  jurisdiction: string | null;
  documentDate: string | null;
  costUsd: number;
};

export default function ScanPanel() {
  const [open, setOpen]           = useState(false);
  const [mode, setMode]           = useState<"url" | "text">("url");
  const [url, setUrl]             = useState("");
  const [text, setText]           = useState("");
  const [jurisdiction, setJuris]  = useState("");
  const [sourceDate, setDate]     = useState("");
  const [scanning, setScanning]   = useState(false);
  const [result, setResult]       = useState<ScanResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  async function runScan() {
    setScanning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/market-intelligence/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url:          mode === "url"  ? url.trim()  : undefined,
          text:         mode === "text" ? text.trim() : undefined,
          jurisdiction: jurisdiction.trim() || undefined,
          sourceDate:   sourceDate || undefined,
        }),
      });
      const data = await res.json() as ScanResult & { error?: string };
      if (!res.ok) { setError(data.error ?? `HTTP ${res.status}`); return; }
      setResult(data);
      // Reload page to show new signals/leads/relationships
      setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      {/* Trigger button */}
      <button
        onClick={() => { setOpen(!open); setResult(null); setError(null); }}
        className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
        style={{
          color:      open ? "var(--signal)" : "var(--text-dim)",
          border:     `1px solid ${open ? "rgba(0,255,100,0.3)" : "var(--line)"}`,
          background: open ? "rgba(0,255,100,0.06)" : "transparent",
        }}
      >
        Scan Document
      </button>

      {/* Panel */}
      {open && (
        <div
          className="absolute right-6 top-[72px] z-50 w-[480px] rounded-[var(--radius)] border border-[var(--line)] shadow-2xl"
          style={{ background: "rgba(14,17,23,0.98)", backdropFilter: "blur(12px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
            <p className="text-sm font-[700]" style={{ color: "var(--text)" }}>Scan Market Document</p>
            <button onClick={() => setOpen(false)} className="text-xs" style={{ color: "var(--text-dim)" }}>✕</button>
          </div>

          <div className="p-4 flex flex-col gap-3">
            {/* Mode toggle */}
            <div className="flex rounded overflow-hidden border border-[var(--line)]" style={{ background: "rgba(255,255,255,0.03)" }}>
              {(["url", "text"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-[0.07em] transition-colors"
                  style={{
                    color:      mode === m ? "var(--signal)" : "var(--text-dim)",
                    background: mode === m ? "rgba(0,255,100,0.08)" : "transparent",
                  }}
                >
                  {m === "url" ? "URL / Link" : "Paste Text"}
                </button>
              ))}
            </div>

            {/* Input */}
            {mode === "url" ? (
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://cityname.gov/council/minutes-2026-04-15.pdf"
                className="w-full rounded px-3 py-2 text-sm outline-none border border-[var(--line)]"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
              />
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="Paste city council meeting minutes or permit record text here…"
                className="w-full rounded px-3 py-2 text-sm outline-none border border-[var(--line)] resize-y"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
              />
            )}

            {/* Jurisdiction + Date row */}
            <div className="flex gap-2">
              <input
                type="text"
                value={jurisdiction}
                onChange={(e) => setJuris(e.target.value)}
                placeholder="Jurisdiction (city/county)"
                className="flex-1 rounded px-3 py-2 text-sm outline-none border border-[var(--line)]"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
              />
              <input
                type="date"
                value={sourceDate}
                onChange={(e) => setDate(e.target.value)}
                className="rounded px-3 py-2 text-sm outline-none border border-[var(--line)]"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--text)" }}
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs rounded px-3 py-2 border border-red-900/40 bg-red-900/20" style={{ color: "var(--red)" }}>
                {error}
              </p>
            )}

            {/* Result */}
            {result && (
              <div className="rounded px-3 py-2.5 border border-[rgba(0,255,100,0.2)] bg-[rgba(0,255,100,0.06)] text-xs space-y-0.5">
                <p style={{ color: "var(--signal)" }} className="font-[600]">
                  Scan complete{result.jurisdiction ? ` · ${result.jurisdiction}` : ""}
                </p>
                <p style={{ color: "var(--text-soft)" }}>
                  {result.signalsCreated} signals · {result.leadsCreated} leads auto-created · {result.relationshipsCreated} relationships mapped
                </p>
                <p style={{ color: "var(--text-dim)" }}>
                  ${result.costUsd.toFixed(4)} · Reloading…
                </p>
              </div>
            )}

            {/* Action */}
            <button
              onClick={runScan}
              disabled={scanning || (mode === "url" ? !url.trim() : !text.trim())}
              className="w-full py-2 rounded font-[600] text-sm transition-colors disabled:opacity-40"
              style={{
                background: "var(--signal)",
                color: "#000",
              }}
            >
              {scanning ? "Scanning…" : "Run Scan"}
            </button>

            <p className="text-[10px] text-center" style={{ color: "var(--text-dim)" }}>
              Claude reads the document · city council minutes, permit logs, planning agendas
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
