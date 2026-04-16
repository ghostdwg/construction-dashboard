"use client";

// Phase 5E — Superintendent Briefing Tab
//
// Generates a WeasyPrint PDF briefing from assembled project data:
//   - Schedule status (overdue / this week / lookahead)
//   - Submittals requiring attention
//   - Open meeting action items
//   - Risk flags from intelligence brief
//
// PDF is generated on the sidecar (port 8001) and streamed as a download.

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function BriefingTab({ bidId }: { bidId: number }) {
  const [asOfDate, setAsOfDate] = useState<string>(todayStr());
  const [lookaheadDays, setLookaheadDays] = useState<number>(14);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/bids/${bidId}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asOfDate: new Date(asOfDate).toISOString(),
          lookaheadDays,
        }),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) msg = json.error;
        } catch {
          // ignore parse failure
        }
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
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Superintendent Briefing
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Auto-assembles a PDF field briefing from schedule status, submittals,
          meeting action items, and risk flags.
        </p>
      </div>

      {/* ── Generator card ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Generate Briefing
        </h3>

        <div className="flex flex-wrap items-end gap-4">
          {/* As of Date */}
          <div>
            <label
              htmlFor="briefing-as-of"
              className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400"
            >
              As of Date
            </label>
            <input
              id="briefing-as-of"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* Lookahead window */}
          <div>
            <label
              htmlFor="briefing-lookahead"
              className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400"
            >
              Lookahead Window
            </label>
            <select
              id="briefing-lookahead"
              value={lookaheadDays}
              onChange={(e) => setLookaheadDays(Number(e.target.value))}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={21}>21 days</option>
              <option value={28}>28 days</option>
            </select>
          </div>

          {/* Download button */}
          <button
            onClick={handleDownload}
            disabled={generating}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                Download Briefing PDF
              </>
            )}
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}
      </section>

      {/* ── Info box ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-800/40">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
          What's included
        </h3>
        <ul className="flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside">
          <li>
            <strong>Schedule</strong> — overdue activities, this week's work,
            and the {lookaheadDays}-day lookahead
          </li>
          <li>
            <strong>Submittals</strong> — overdue submissions, items under
            review, and approaching deadlines
          </li>
          <li>
            <strong>Open action items</strong> — all non-closed items from
            meeting intelligence, sorted by priority
          </li>
          <li>
            <strong>Risk flags</strong> — from the AI intelligence brief (if
            generated)
          </li>
        </ul>
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Requires the Python sidecar running on port 8001. PDF is generated
          with WeasyPrint and styled for US Letter (8.5" × 11").
        </p>
      </section>
    </div>
  );
}
