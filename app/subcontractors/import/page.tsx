"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

type ResolvedTrade = {
  source: string;
  tradeId: number | null;
  matchedName: string | null;
  confidence: "exact" | "fuzzy" | "none";
};

type PreviewRow = {
  rowIndex: number;
  company: string;
  office: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isUnion: boolean;
  isMWBE: boolean;
  isPreferred: boolean;
  procoreVendorId: string | null;
  resolvedTrades: ResolvedTrade[];
  conflictWith: { id: number; company: string } | null;
  action: "create" | "update" | "skip";
};

type PreviewData = {
  detectedFormat: "procore" | "generic";
  totalRows: number;
  validRows: number;
  skippedRows: number;
  summary: {
    newCount: number;
    conflictCount: number;
    unmatchedTradeCount: number;
    fuzzyTradeCount: number;
  };
  unmatchedTrades: string[];
  fuzzyTrades: { source: string; matched: string }[];
  preview: PreviewRow[];
};

type CommitResult = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: { company: string; error: string }[];
};

// ── Page ───────────────────────────────────────────────────────────────────

export default function ImportSubsPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/subcontractors/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Upload failed");
        setUploading(false);
        return;
      }
      const data: PreviewData = await res.json();
      setPreview(data);
      setRows(data.preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setUploading(false);
  }

  function setRow(idx: number, patch: Partial<PreviewRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function setAllPreferred(value: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, isPreferred: value })));
  }

  function setAllAction(action: "create" | "update" | "skip") {
    setRows((prev) =>
      prev.map((r) => {
        if (action === "update" && !r.conflictWith) return { ...r, action: "create" };
        return { ...r, action };
      })
    );
  }

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/subcontractors/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Commit failed");
        setCommitting(false);
        return;
      }
      const data: CommitResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCommitting(false);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setRows([]);
    setResult(null);
    setError(null);
  }

  // ── Render: success state ────────────────────────────────────────────────
  if (result) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <Link href="/subcontractors" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Subcontractors</Link>
        <h1 className="text-2xl font-semibold mt-3 mb-6">Import Complete</h1>

        <div className="rounded-md border border-green-200 bg-green-50 p-6 mb-6">
          <p className="text-base font-semibold text-green-800 mb-3">Import successful</p>
          <ul className="text-sm text-green-700 flex flex-col gap-1">
            <li><strong>{result.createdCount}</strong> new subcontractors created</li>
            <li><strong>{result.updatedCount}</strong> existing subcontractors updated</li>
            <li><strong>{result.skippedCount}</strong> rows skipped</li>
            {result.errorCount > 0 && (
              <li className="text-red-700"><strong>{result.errorCount}</strong> errors</li>
            )}
          </ul>
        </div>

        {result.errors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 mb-6">
            <p className="text-sm font-semibold text-red-700 mb-2">Errors:</p>
            <ul className="text-xs text-red-600 flex flex-col gap-1">
              {result.errors.map((e, i) => (
                <li key={i}><strong>{e.company}:</strong> {e.error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => router.push("/subcontractors")}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-50"
          >
            Go to Subcontractors
          </button>
          <button
            onClick={reset}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-300"
          >
            Import Another File
          </button>
        </div>
      </div>
    );
  }

  // ── Render: preview state ────────────────────────────────────────────────
  if (preview) {
    const willCreate = rows.filter((r) => r.action === "create").length;
    const willUpdate = rows.filter((r) => r.action === "update").length;
    const willSkip = rows.filter((r) => r.action === "skip").length;
    const preferredCount = rows.filter((r) => r.isPreferred && r.action !== "skip").length;

    return (
      <div className="max-w-7xl mx-auto py-10 px-4">
        <Link href="/subcontractors" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Subcontractors</Link>
        <h1 className="text-2xl font-semibold mt-3 mb-2">Review Import</h1>
        <p className="text-sm text-zinc-500 mb-6 dark:text-zinc-400">
          Detected format: <span className="font-medium capitalize">{preview.detectedFormat}</span> ·
          {" "}{preview.validRows} rows parsed
          {preview.skippedRows > 0 && <> · {preview.skippedRows} skipped (no company name)</>}
        </p>

        {/* Summary banner */}
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <span className="text-zinc-700 dark:text-zinc-200">
            <span className="font-semibold text-green-700">{willCreate}</span> create
          </span>
          <span className="text-zinc-700 dark:text-zinc-200">
            <span className="font-semibold text-blue-700">{willUpdate}</span> update
          </span>
          <span className="text-zinc-700 dark:text-zinc-200">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">{willSkip}</span> skip
          </span>
          <span className="text-zinc-700 dark:text-zinc-200">
            <span className="font-semibold text-amber-700">★ {preferredCount}</span> preferred
          </span>
          {preview.summary.unmatchedTradeCount > 0 && (
            <span className="text-red-600">
              {preview.summary.unmatchedTradeCount} unmatched trades
            </span>
          )}
        </div>

        {/* Bulk actions */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setAllPreferred(true)}
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300"
          >
            ★ Mark all preferred
          </button>
          <button
            onClick={() => setAllPreferred(false)}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-300"
          >
            Clear all preferred
          </button>
          <span className="border-l border-zinc-300 mx-1 dark:border-zinc-600" />
          <button
            onClick={() => setAllAction("update")}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-300"
          >
            Update existing where conflict
          </button>
          <button
            onClick={() => setAllAction("skip")}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-300"
          >
            Skip all conflicts
          </button>
        </div>

        {/* Unmatched trades warning */}
        {preview.unmatchedTrades.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 mb-4">
            <p className="text-xs font-semibold text-amber-800 mb-1">Unmatched trades (will be skipped on commit):</p>
            <p className="text-xs text-amber-700">{preview.unmatchedTrades.join(", ")}</p>
          </div>
        )}

        {/* Preview table */}
        <div className="rounded-md border border-zinc-200 overflow-x-auto mb-6 dark:border-zinc-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Trades</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2 text-center" title="Internal — never shown to subs or in exports">★ Preferred</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((row, idx) => {
                const tradesDisplay = row.resolvedTrades.map((t) => {
                  if (t.confidence === "exact") return <span key={t.source} className="text-green-700">{t.matchedName}</span>;
                  if (t.confidence === "fuzzy") return <span key={t.source} className="text-amber-700" title={`Source: ${t.source}`}>~{t.matchedName}</span>;
                  return <span key={t.source} className="text-red-600 line-through" title="Not matched">{t.source}</span>;
                });
                return (
                  <tr key={idx} className={row.action === "skip" ? "opacity-50" : ""}>
                    <td className="px-3 py-2">
                      <select
                        value={row.action}
                        onChange={(e) => setRow(idx, { action: e.target.value as PreviewRow["action"] })}
                        className="rounded-md bg-white border border-zinc-300 px-2 py-1 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
                      >
                        <option value="create" disabled={!!row.conflictWith}>Create</option>
                        <option value="update" disabled={!row.conflictWith}>Update</option>
                        <option value="skip">Skip</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-800 dark:text-zinc-100">{row.company}</div>
                      {row.conflictWith && (
                        <div className="text-[10px] text-blue-600 mt-0.5">EXISTS — {row.conflictWith.company}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{row.office ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                      {row.contactEmail ?? row.email ?? "—"}
                      {row.contactPhone && <div className="text-[10px]">{row.contactPhone}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {tradesDisplay.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tradesDisplay.map((t, i) => (
                            <span key={i} className="text-[10px]">{t}</span>
                          ))}
                        </div>
                      ) : <span className="text-zinc-400 dark:text-zinc-500">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {row.isUnion && <span className="rounded bg-blue-100 text-blue-700 px-1 py-0.5 text-[9px] font-semibold dark:bg-blue-900/40 dark:text-blue-300">UNION</span>}
                        {row.isMWBE && <span className="rounded bg-purple-100 text-purple-700 px-1 py-0.5 text-[9px] font-semibold dark:bg-purple-900/40 dark:text-purple-300">MWBE</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.isPreferred}
                        disabled={row.action === "skip"}
                        onChange={(e) => setRow(idx, { isPreferred: e.target.checked })}
                        className="rounded accent-amber-600"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={reset}
            disabled={committing}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={handleCommit}
            disabled={committing || (willCreate + willUpdate === 0)}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50"
          >
            {committing ? "Importing…" : `Import ${willCreate + willUpdate} Subs`}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: upload state ─────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <Link href="/subcontractors" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Subcontractors</Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">Import Subcontractors</h1>
      <p className="text-sm text-zinc-500 mb-6 dark:text-zinc-400">
        Upload a CSV exported from Procore (Company Directory → Companies tab → Export to CSV) or any spreadsheet with a <strong>Name</strong> column. Trades will be auto-matched against your trade dictionary.
      </p>

      <form onSubmit={handleUpload} className="rounded-md border border-zinc-200 bg-white p-6 flex flex-col gap-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">CSV File</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1 file:text-xs file:text-zinc-700 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
          />
          {file && (
            <p className="text-xs text-zinc-500 mt-1 dark:text-zinc-400">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!file || uploading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50"
          >
            {uploading ? "Parsing…" : "Upload & Preview"}
          </button>
          <a
            href="/api/subcontractors/import/template"
            download
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-300"
          >
            Download Template
          </a>
        </div>
      </form>

      <div className="mt-6 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <p className="font-semibold mb-1">Procore export instructions:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
          <li>Open Procore → Company Directory</li>
          <li>Select the <strong>Companies</strong> tab</li>
          <li>Apply any filters (e.g., active vendors only)</li>
          <li>Click <strong>Export</strong> → choose CSV</li>
          <li>Upload the file here</li>
        </ol>
      </div>
    </div>
  );
}
