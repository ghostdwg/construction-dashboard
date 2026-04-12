"use client";

// Module H5 — Owner-Facing Estimate section on the Handoff tab
//
// Form for ephemeral inputs (GC markup lines, contingency, exclusions,
// qualifications, validity date) + Generate button that POSTs to the export
// endpoint and downloads the XLSX.
//
// No server persistence — the estimator fills in fresh values each time they
// generate. Trade-level costs come from BuyoutItem at export time.

import { useState } from "react";

type MarkupLine = { label: string; amount: string };

const DEFAULT_MARKUP: MarkupLine[] = [
  { label: "General Conditions", amount: "" },
  { label: "Overhead & Profit", amount: "" },
];

export default function OwnerEstimateSection({ bidId }: { bidId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [markupLines, setMarkupLines] = useState<MarkupLine[]>(() =>
    DEFAULT_MARKUP.map((m) => ({ ...m }))
  );
  const [contingency, setContingency] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addMarkupLine() {
    setMarkupLines([...markupLines, { label: "", amount: "" }]);
  }
  function removeMarkupLine(idx: number) {
    setMarkupLines(markupLines.filter((_, i) => i !== idx));
  }
  function updateMarkupLine(idx: number, field: "label" | "amount", value: string) {
    setMarkupLines(
      markupLines.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    );
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const body = {
        markupLines: markupLines
          .filter((m) => m.label.trim() && m.amount.trim())
          .map((m) => ({
            label: m.label.trim(),
            amount: parseFloat(m.amount.replace(/[^\d.]/g, "")) || 0,
          })),
        contingencyPercent: parseFloat(contingency) || 0,
        exclusions,
        qualifications,
        validUntil: validUntil || null,
      };

      const res = await fetch(`/api/bids/${bidId}/owner-estimate/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : "owner_estimate.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-3 flex items-start justify-between gap-4 hover:bg-zinc-50 transition-colors dark:hover:bg-zinc-800/40"
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Owner-Facing Estimate
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Generate a professional cost summary for the owner — trade totals,
            markup, contingency, exclusions. No sub-level detail.
          </p>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-5 py-4 flex flex-col gap-4">
          {/* Markup line items */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2 dark:text-zinc-400">
              GC Markup Line Items
            </label>
            <div className="flex flex-col gap-2">
              {markupLines.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={m.label}
                    onChange={(e) => updateMarkupLine(i, "label", e.target.value)}
                    placeholder="Line item label"
                    className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={m.amount}
                    onChange={(e) => updateMarkupLine(i, "amount", e.target.value)}
                    placeholder="$0"
                    className="w-28 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <button
                    onClick={() => removeMarkupLine(i)}
                    className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                    title="Remove line"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addMarkupLine}
              className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              + Add line item
            </button>
          </div>

          {/* Contingency */}
          <div className="w-40">
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
              Contingency %
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={contingency}
              onChange={(e) => setContingency(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* Exclusions */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
              Exclusions
            </label>
            <textarea
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              rows={3}
              placeholder="List any scope exclusions — e.g. hazmat abatement, owner-furnished equipment, temporary utilities…"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* Qualifications */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
              Qualifications
            </label>
            <textarea
              value={qualifications}
              onChange={(e) => setQualifications(e.target.value)}
              rows={3}
              placeholder="List any qualifications or assumptions — e.g. standard working hours only, no overtime premium…"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* Valid until */}
          <div className="w-48">
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
              Valid Until (optional)
            </label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={generate}
            disabled={generating}
            className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate Owner Estimate"}
          </button>
        </div>
      )}
    </section>
  );
}
