"use client";

// Phase 5E — Superintendent Initial Assessment Tab
//
// Generates a one-time onboarding PDF for the superintendent assembled from
// all preconstruction data captured in this tool:
//   §1 Contract & spec risk flags
//   §2 Required inspections (special, AHJ, third-party, owner witness)
//   §3 Warranty requirements (manufacturer / installer / system)
//   §4 Training requirements
//   §5 Closeout deliverables checklist
//   §6 Submittals requiring attention
//   §7 Schedule lookahead
//   §8 Open preconstruction commitments

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BriefingTab({ bidId }: { bidId: number }) {
  const [asOfDate, setAsOfDate]       = useState<string>(todayStr());
  const [lookaheadDays, setLookaheadDays] = useState<number>(30);
  const [generating, setGenerating]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/bids/${bidId}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asOfDate:     new Date(asOfDate).toISOString(),
          lookaheadDays,
        }),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) msg = json.error;
        } catch { /* ignore */ }
        setError(msg);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : `briefing-${asOfDate}.pdf`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          Superintendent Initial Assessment
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
          One-time onboarding document for the superintendent — assembled from specs,
          schedule, submittals, and meeting intelligence captured during preconstruction.
        </p>
      </div>

      {/* ── Generator card ── */}
      <section
        className="rounded-lg border p-5"
        style={{ borderColor: "var(--line)", background: "var(--panel)" }}
      >
        <h3 className="text-sm font-[600] mb-4" style={{ color: "var(--text)" }}>
          Generate Assessment PDF
        </h3>

        <div className="flex flex-wrap items-end gap-4">

          {/* Schedule reference date */}
          <div>
            <label
              htmlFor="briefing-as-of"
              className="block font-mono text-[9px] uppercase tracking-[0.08em] mb-1.5"
              style={{ color: "var(--text-dim)" }}
            >
              Schedule Reference Date
            </label>
            <input
              id="briefing-as-of"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--line-strong)",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            />
          </div>

          {/* Lookahead window */}
          <div>
            <label
              htmlFor="briefing-lookahead"
              className="block font-mono text-[9px] uppercase tracking-[0.08em] mb-1.5"
              style={{ color: "var(--text-dim)" }}
            >
              Schedule Lookahead
            </label>
            <select
              id="briefing-lookahead"
              value={lookaheadDays}
              onChange={(e) => setLookaheadDays(Number(e.target.value))}
              className="rounded border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--line-strong)",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            >
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={45}>45 days</option>
              <option value={60}>60 days</option>
            </select>
          </div>

          {/* Download button */}
          <button
            onClick={handleDownload}
            disabled={generating}
            className="flex items-center gap-2 rounded px-4 py-2 text-sm font-[600] transition-opacity disabled:opacity-40"
            style={{ background: "var(--signal-dim)", color: "var(--signal-soft)", border: "1px solid rgba(0,255,100,0.22)" }}
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
            ) : (
              <><FileDown className="h-4 w-4" /> Download Assessment PDF</>
            )}
          </button>
        </div>

        {error && (
          <div
            className="mt-4 rounded border px-4 py-3 text-sm"
            style={{ borderColor: "rgba(232,69,60,0.3)", background: "var(--red-dim)", color: "#ff968f" }}
          >
            {error}
          </div>
        )}
      </section>

      {/* ── What's included ── */}
      <section
        className="rounded-lg border p-5"
        style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.02)" }}
      >
        <h3 className="text-sm font-[600] mb-3" style={{ color: "var(--text-soft)" }}>
          What's included
        </h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {[
            ["Contract & Spec Risk Flags", "Intelligence brief flags + HIGH/CRITICAL spec pain points"],
            ["Pre-Award Decisions", "Scope inclusions/exclusions, substitutions, assumptions, VE, and design interpretations"],
            ["Required Inspections",       "Special, AHJ, third-party, owner-witness — extracted from specs"],
            ["Warranty Requirements",      "Manufacturer, installer, and system warranties with durations"],
            ["Training Requirements",      "Owner and maintenance staff training obligations"],
            ["Closeout Deliverables",      "O&M manuals, record drawings, attic stock, commissioning, certs"],
            ["Submittals",                 "Overdue and approaching deadline items"],
            ["Schedule Lookahead",         `Overdue activities, this week, and ${lookaheadDays}-day window`],
            ["Preconstruction Commitments","Open meeting action items carried into construction"],
          ].map(([title, desc]) => (
            <div key={title} className="flex flex-col gap-0.5">
              <span className="text-xs font-[600]" style={{ color: "var(--text-soft)" }}>{title}</span>
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>{desc}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.06em]" style={{ color: "var(--text-dim)", opacity: 0.6 }}>
          Requires sidecar online · Spec analysis must be run to populate inspections, warranties, and training
        </p>
      </section>
    </div>
  );
}
