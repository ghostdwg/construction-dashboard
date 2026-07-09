"use client";

// Module OPS2 (Slice 2) — Field Reports V0, mounted inside the Operations
// tab. Reports are SOURCE DOCUMENTS: list/create/upload/metadata plus a
// human-triggered "create tracked item from this report" form that lands on
// the shared TrackedItem spine. Honest V0 limits shown in the UI: no file
// preview, no OCR, no AI extraction — parseStatus stays UNPARSED.

import { useCallback, useEffect, useState } from "react";

type FieldReportRow = {
  id: number;
  title: string;
  reportDate: string | null;
  authorName: string | null;
  originalFileName: string | null;
  byteSize: number | null;
  parseStatus: string;
  trackedItemCount: number;
  hasFile: boolean;
};

export default function FieldReportsSection({
  bidId,
  onItemsChanged,
}: {
  bidId: number;
  /** Called after an item is created from a report so the register refreshes. */
  onItemsChanged?: () => Promise<void> | void;
}) {
  const [reports, setReports] = useState<FieldReportRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [author, setAuthor] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/field-reports`);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      setReports(((await res.json()) as { fieldReports: FieldReportRow[] }).fieldReports);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Load failed");
    }
  }, [bidId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createReport() {
    setCreateError(null);
    const res = await fetch(`/api/bids/${bidId}/field-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        ...(reportDate ? { reportDate: new Date(reportDate).toISOString() } : {}),
        ...(author.trim() ? { authorName: author.trim() } : {}),
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setCreateError(json.error ?? "Create failed");
      return;
    }
    setTitle("");
    setReportDate("");
    setAuthor("");
    await load();
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Field Reports</h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Source documents (dailies, site reports). Upload the file, then create tracked
          items from it yourself — nothing is auto-extracted. File preview, OCR, and AI
          extraction are not built yet; files are stored privately (metadata shown only).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="report title (e.g. Daily 07/09)"
          className="w-52 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          className="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="author"
          className="w-28 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          onClick={createReport}
          disabled={!title.trim()}
          className="rounded bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add report
        </button>
        {createError && <span className="text-xs text-red-500">{createError}</span>}
      </div>

      {loadError && <p className="text-xs text-red-500">{loadError}</p>}
      {reports.length === 0 && !loadError && (
        <p className="text-xs text-zinc-400">No field reports yet.</p>
      )}

      <ul className="space-y-1">
        {reports.map((r) => (
          <li key={r.id} className="rounded border border-zinc-100 dark:border-zinc-800">
            <button
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs"
            >
              <span className="text-zinc-800 dark:text-zinc-200">
                {r.title}
                <span className="ml-2 text-zinc-400">
                  {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "no date"}
                  {r.authorName ? ` · ${r.authorName}` : ""}
                </span>
              </span>
              <span className="text-zinc-400">
                {r.hasFile ? `📄 ${r.originalFileName}` : "no file"} · {r.trackedItemCount} item
                {r.trackedItemCount === 1 ? "" : "s"}
              </span>
            </button>
            {expandedId === r.id && (
              <ReportDetail bidId={bidId} report={r} onChanged={async () => {
                await load();
                await onItemsChanged?.();
              }} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportDetail({
  bidId,
  report,
  onChanged,
}: {
  bidId: number;
  report: FieldReportRow;
  onChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [itemTitle, setItemTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [locator, setLocator] = useState("");
  const base = `/api/bids/${bidId}/field-reports/${report.id}`;

  async function uploadFile(file: File) {
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${base}/upload`, { method: "POST", body: form });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Upload failed");
      return;
    }
    await onChanged();
  }

  async function createItem() {
    setError(null);
    const res = await fetch(`${base}/tracked-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: itemTitle,
        ...(excerpt.trim() ? { evidenceExcerpt: excerpt.trim() } : {}),
        ...(locator.trim() ? { sourceLocator: locator.trim() } : {}),
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Create failed");
      return;
    }
    setItemTitle("");
    setExcerpt("");
    setLocator("");
    await onChanged();
  }

  return (
    <div className="space-y-2 border-t border-zinc-100 px-2 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-2 text-xs">
        <label className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300">
          {report.hasFile ? "Replace file" : "Upload file"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {report.hasFile && report.byteSize != null && (
          <span className="text-zinc-400">
            {Math.max(1, Math.round(report.byteSize / 1024))} KB · status {report.parseStatus}
            {" "}(no preview/OCR yet)
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <input
          value={itemTitle}
          onChange={(e) => setItemTitle(e.target.value)}
          placeholder="tracked item from this report (title)"
          className="w-64 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="evidence excerpt (optional, typed)"
          className="w-56 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          value={locator}
          onChange={(e) => setLocator(e.target.value)}
          placeholder="locator (e.g. p.2)"
          className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          onClick={createItem}
          disabled={!itemTitle.trim()}
          className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-40"
        >
          Create tracked item
        </button>
      </div>
      <p className="text-[11px] text-zinc-400">
        Items land in the register above as FIELD ITEM, citing this report. You choose
        each item — nothing is extracted automatically.
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
