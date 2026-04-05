"use client";

import { useEffect, useState } from "react";

type ScopeStats = {
  totalItems: number;
  tradeCount: number;
  restrictedItems: number;
};

type ExportResult = {
  json: string;
  restrictedStripped: number;
  filename: string;
};

const CONFIRMATIONS = [
  "I confirm this export contains no cost or budget data",
  "I confirm this export has been reviewed for sensitive information",
  "I understand this file will be sent to an external AI service",
] as const;

export default function AiReviewTab({ bidId }: { bidId: number }) {
  const [stats, setStats] = useState<ScopeStats | null>(null);
  const [checks, setChecks] = useState([false, false, false]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/bids/${bidId}/scope`).then((r) => r.json()),
      fetch(`/api/bids/${bidId}`).then((r) => r.json()),
    ]).then(([scopeData, bidData]) => {
      const byTrade: Record<string, { items: { restricted: boolean }[] }> =
        scopeData.byTrade ?? {};
      const unassigned: { restricted: boolean }[] = scopeData.unassigned ?? [];

      const allItems = [
        ...Object.values(byTrade).flatMap((g) => g.items),
        ...unassigned,
      ];

      const tradeCount = Object.keys(byTrade).length;
      const restrictedItems = allItems.filter((i) => i.restricted).length;

      setStats({
        totalItems: allItems.length,
        tradeCount,
        restrictedItems,
      });

      void bidData; // fetched for future use
    });
  }, [bidId]);

  function toggleCheck(i: number) {
    setChecks((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  const allChecked = checks.every(Boolean);

  async function generate() {
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/bids/${bidId}/export/ai-safe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setError(err.error ?? "Export failed");
        return;
      }

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "ai_safe_export.json";

      const json = await res.text();
      const parsed = JSON.parse(json) as {
        exportMetadata?: { restrictedItemsStripped?: number };
      };
      const restrictedStripped =
        parsed.exportMetadata?.restrictedItemsStripped ?? 0;

      setResult({ json, restrictedStripped, filename });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  async function copyJson() {
    if (!result) return;
    await navigator.clipboard.writeText(result.json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Section 1 — Export */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-800">AI Safe Export</h2>

        {/* Stats */}
        {stats && (
          <div className="flex gap-6 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm">
            <span className="text-zinc-700">
              <span className="font-semibold">{stats.totalItems}</span>{" "}
              <span className="text-zinc-500">scope items</span>
            </span>
            <span className="text-zinc-700">
              <span className="font-semibold">{stats.tradeCount}</span>{" "}
              <span className="text-zinc-500">trades</span>
            </span>
            {stats.restrictedItems > 0 ? (
              <span className="text-amber-700">
                <span className="font-semibold">{stats.restrictedItems}</span>{" "}
                <span className="text-amber-600">
                  restricted item{stats.restrictedItems !== 1 ? "s" : ""} will
                  be stripped
                </span>
              </span>
            ) : (
              <span className="text-zinc-400">no restricted items</span>
            )}
          </div>
        )}

        {/* Confirmation checkboxes */}
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 bg-white">
          {CONFIRMATIONS.map((label, i) => (
            <label
              key={i}
              className="flex items-start gap-3 text-sm text-zinc-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={() => toggleCheck(i)}
                className="mt-0.5 rounded"
              />
              {label}
            </label>
          ))}
        </div>

        {/* Generate button */}
        <div>
          <button
            onClick={generate}
            disabled={!allChecked || generating}
            className="rounded bg-black px-5 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? "Generating…" : "Generate AI Export"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* Result */}
        {result && (
          <div className="flex flex-col gap-3">
            {result.restrictedStripped > 0 && (
              <p className="text-sm text-amber-700">
                <span className="font-semibold">{result.restrictedStripped}</span>{" "}
                restricted item{result.restrictedStripped !== 1 ? "s were" : " was"} stripped
                from this export.
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={copyJson}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
              >
                {copied ? "Copied!" : "Copy JSON"}
              </button>
              <button
                onClick={downloadJson}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
              >
                Download JSON
              </button>
            </div>

            <pre className="overflow-auto max-h-96 rounded-md border border-zinc-200 bg-zinc-950 text-zinc-100 text-xs p-4 leading-relaxed">
              {result.json}
            </pre>
          </div>
        )}
      </section>

      {/* Section 2 — Import Findings (stub) */}
      <section>
        <div className="rounded-md border border-zinc-200 p-6 text-center text-sm text-zinc-400">
          Paste AI findings here — coming in Step 7
        </div>
      </section>
    </div>
  );
}
