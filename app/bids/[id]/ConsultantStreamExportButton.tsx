"use client";

// Module OPS6 (Phase 2) — "Export stream PDF" action. Opens a small filter
// row, POSTs the SSE export route, renders live progress, and surfaces the
// authenticated download link when done. Caps and errors come back as
// honest messages (over-cap responses name the count and the narrowing
// filters); nothing here retries automatically.

import { useState } from "react";

export default function ConsultantStreamExportButton({ bidId }: { bidId: number }) {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setDownloadUrl(null);
    setStage("starting");
    try {
      const res = await fetch(`/api/bids/${bidId}/consultant-reports/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
          ...(dateTo ? { dateTo: new Date(dateTo).toISOString() } : {}),
          includeDisposed,
        }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `Export failed (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const eventMatch = block.match(/^event: (.+)$/m);
          const dataMatch = block.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const data = JSON.parse(dataMatch[1]) as Record<string, unknown>;
          if (eventMatch[1] === "progress") setStage(String(data.stage ?? ""));
          if (eventMatch[1] === "done") {
            setStage(null);
            setDownloadUrl(String(data.downloadUrl ?? ""));
          }
          if (eventMatch[1] === "error") {
            setStage(null);
            setError(String(data.message ?? "Export failed"));
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setStage(null);
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-zinc-300 px-2 py-1 text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300"
      >
        Export stream PDF…
      </button>
      {open && (
        <>
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            from
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            to
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={includeDisposed}
              onChange={(e) => setIncludeDisposed(e.target.checked)}
            />
            include dismissed
          </label>
          <button
            onClick={run}
            disabled={busy}
            className="rounded bg-zinc-900 px-2 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Generate
          </button>
        </>
      )}
      {stage && (
        <span className="text-violet-600 dark:text-violet-400">
          <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-violet-500" />
          {stage}… (usually under a minute)
        </span>
      )}
      {downloadUrl && (
        <a href={downloadUrl} className="text-emerald-700 underline dark:text-emerald-400">
          Download PDF
        </a>
      )}
      {error && <span className="text-amber-600">{error}</span>}
    </span>
  );
}
