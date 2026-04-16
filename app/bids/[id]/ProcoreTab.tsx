"use client";

// Tier F F1 — Procore Export Tab
//
// Generates Procore-compatible import CSVs from data assembled during
// the pursuit and post-award phases:
//
//   vendors.csv   — Company Directory (all subs invited/awarded on this bid)
//   budget.csv    — Budget lines (per-trade committed amounts + GC overhead)
//   contacts.csv  — People Directory (project team from H1+)
//   submittals    — Submittal Log (existing H3 export endpoint)
//
// Each section shows how many rows are ready, then provides a download button.
// After download, the estimator imports each CSV into Procore via Admin → Import.

import { useEffect, useState } from "react";
import { Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProcoreStats = {
  vendors: number;
  budgetTradeLines: number;
  budgetGcLines: number;
  submittals: number;
  contacts: number;
};

type DownloadState = "idle" | "loading" | "done" | "error";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function downloadCsv(url: string, fallbackName: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return json.error ?? `HTTP ${res.status}`;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const fileName = match ? match[1] : fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return null;
}

// ── Sub-component: Export card ─────────────────────────────────────────────────

function ExportCard({
  title,
  description,
  procorePath,
  rowCount,
  rowLabel,
  downloadUrl,
  downloadFallbackName,
  emptyMessage,
}: {
  title: string;
  description: string;
  procorePath: string;
  rowCount: number;
  rowLabel: string;
  downloadUrl: string;
  downloadFallbackName: string;
  emptyMessage: string;
}) {
  const [state, setState] = useState<DownloadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const isEmpty = rowCount === 0;

  async function handleDownload() {
    setState("loading");
    setError(null);
    try {
      const err = await downloadCsv(downloadUrl, downloadFallbackName);
      if (err) {
        setError(err);
        setState("error");
      } else {
        setState("done");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
          <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            Procore: <span className="font-mono">{procorePath}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {isEmpty ? (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">{emptyMessage}</span>
          ) : (
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {rowCount} {rowLabel}
            </span>
          )}

          <button
            onClick={handleDownload}
            disabled={isEmpty || state === "loading"}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {state === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {state === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
            {state === "error" && <AlertCircle className="h-3.5 w-3.5" />}
            {(state === "idle" || state === "error") && <Download className="h-3.5 w-3.5" />}
            {state === "loading"
              ? "Exporting…"
              : state === "done"
                ? "Downloaded"
                : "Download CSV"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProcoreTab({ bidId }: { bidId: number }) {
  const [stats, setStats] = useState<ProcoreStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/procore-export`)
      .then((r) => r.json() as Promise<ProcoreStats | { error: string }>)
      .then((data) => {
        if ("error" in data) {
          setStatsError(data.error);
        } else {
          setStats(data);
        }
      })
      .catch((e) => setStatsError(e instanceof Error ? e.message : String(e)));
  }, [bidId]);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Procore Export
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Generate Procore-compatible import CSVs from this project's pursuit
          and post-award data. Download each file and import in the order shown.
        </p>
      </div>

      {statsError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {statsError}
        </div>
      )}

      {/* ── Export cards ── */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Step 1 — Directory
        </p>

        <ExportCard
          title="Vendor Directory"
          description="All subcontractors invited or awarded on this project as Procore company records."
          procorePath="Admin → Directory → Companies → Import"
          rowCount={stats?.vendors ?? 0}
          rowLabel={stats?.vendors === 1 ? "company" : "companies"}
          downloadUrl={`/api/bids/${bidId}/procore-export/vendors`}
          downloadFallbackName={`procore-vendors.csv`}
          emptyMessage="No subs added yet"
        />

        <ExportCard
          title="Project Contacts"
          description="Owner, architect, engineer, and internal team members as Procore people records."
          procorePath="Admin → Directory → People → Import"
          rowCount={stats?.contacts ?? 0}
          rowLabel={stats?.contacts === 1 ? "contact" : "contacts"}
          downloadUrl={`/api/bids/${bidId}/procore-export/contacts`}
          downloadFallbackName={`procore-contacts.csv`}
          emptyMessage="No contacts added yet"
        />

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Step 2 — Budget
        </p>

        <ExportCard
          title="Budget Lines"
          description={
            stats
              ? `${stats.budgetTradeLines} trade ${stats.budgetTradeLines === 1 ? "line" : "lines"} (subcontract) + ${stats.budgetGcLines} GC overhead ${stats.budgetGcLines === 1 ? "line" : "lines"}.`
              : "Per-trade committed amounts plus GC overhead lines from H6."
          }
          procorePath="Project → Budget → Import"
          rowCount={(stats?.budgetTradeLines ?? 0) + (stats?.budgetGcLines ?? 0)}
          rowLabel="lines"
          downloadUrl={`/api/bids/${bidId}/procore-export/budget`}
          downloadFallbackName={`procore-budget.csv`}
          emptyMessage="No trades added yet"
        />

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Step 3 — Submittal Log
        </p>

        <ExportCard
          title="Submittal Log"
          description="Active submittal register items in Procore's submittal import format."
          procorePath="Project → Submittals → Import"
          rowCount={stats?.submittals ?? 0}
          rowLabel={stats?.submittals === 1 ? "submittal" : "submittals"}
          downloadUrl={`/api/bids/${bidId}/submittals/export`}
          downloadFallbackName={`procore-submittals.csv`}
          emptyMessage="No submittals yet"
        />
      </div>

      {/* ── Info box ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-800/40">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
          Import order matters
        </h3>
        <ol className="flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 list-decimal list-inside">
          <li>
            Import <strong>Vendor Directory</strong> first — Procore links subs to
            budget lines and submittals by company name.
          </li>
          <li>
            Import <strong>Project Contacts</strong> — these become available for
            assignment on RFIs, submittals, and daily logs.
          </li>
          <li>
            Import <strong>Budget Lines</strong> — cost codes must exist before
            submittals reference them.
          </li>
          <li>
            Import <strong>Submittal Log</strong> last — Procore links submittals
            to companies and spec sections from earlier imports.
          </li>
        </ol>
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          All CSVs include only the columns Procore's import templates accept.
          Blank cells are intentional — fill them in Procore after import.
        </p>
      </section>
    </div>
  );
}
