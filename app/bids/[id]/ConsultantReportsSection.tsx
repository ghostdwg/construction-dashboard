"use client";

// Module OPS3 (Phase 1A) — Consultant Reports, mounted inside the
// Operations tab. Reports received from architects, engineers, and other
// consultants — tracked by consultant, cited into the Register, and
// answered. Minimal 1A surface: upload + list + expandable report detail
// with the observations workbench (inline PDF view with download
// fallback), the state-machine actions, and formal-response editing.
// NOTHING is extracted automatically — every observation is typed by a
// human reading the PDF. §12 polish (filters, four-counter rollups,
// Activity tab) is a deferred follow-up card.

import { useCallback, useEffect, useState } from "react";

const REPORT_TYPE_LABELS: Record<string, string> = {
  ARCHITECT_FIELD_REPORT: "Architect Field Report",
  ENGINEER_FIELD_REPORT: "Engineer Field Report",
  COMMISSIONING_REPORT: "Commissioning Report",
  TESTING_INSPECTION_REPORT: "Testing / Inspection Report",
  OTHER_CONSULTANT_REPORT: "Other Consultant Report",
};

type ReportRow = {
  id: number;
  vendorName: string;
  title: string | null;
  reportNumber: string | null;
  reportType: string;
  reportDate: string | null;
  status: string;
  revisionCount: number;
  observationCount: number;
  latestRevision: { id: number; originalFilename: string } | null;
};

type ObservationRow = {
  id: number;
  observationText: string;
  sourcePage: string | null;
  consultantTargetDate: string | null;
  state: string;
  dismissedReason: string | null;
  registerItem: {
    id: number;
    title: string;
    status: string;
    dueDate: string | null;
    formalResponse: string | null;
    formalResponseBy: string | null;
    formalResponseAt: string | null;
  } | null;
};

type ReportDetailData = {
  id: number;
  vendorName: string;
  title: string | null;
  reportNumber: string | null;
  reportType: string;
  status: string;
  revisions: Array<{
    id: number;
    revisionIndex: number;
    originalFilename: string;
    fileSizeBytes: number;
    supersedesRevisionId: number | null;
    replacementReason: string | null;
  }>;
  observations: ObservationRow[];
};

/** Shared formal-response editor — BOTH surfaces (Register Item detail and
 *  Consultant Report detail) render this and PATCH the identical field via
 *  the identical route. Explicit save only. */
export function FormalResponseEditor({
  bidId,
  itemId,
  current,
  byline,
  onSaved,
}: {
  bidId: number;
  itemId: number;
  current: string | null;
  byline: string | null;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(current ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/tracked-items/${itemId}/formal-response`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formalResponse: draft }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Save failed");
        return;
      }
      setEditing(false);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-medium text-zinc-600 dark:text-zinc-300">Formal response</p>
      <p className="text-[11px] text-zinc-400">
        What we&apos;ll say back to the consultant — one response per item, shown on every
        report that cites it.
      </p>
      {!editing ? (
        <div className="mt-1 space-y-1">
          {current ? (
            <>
              <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{current}</p>
              {byline && <p className="text-[11px] text-zinc-400">{byline}</p>}
            </>
          ) : (
            <p className="italic text-zinc-400">No formal response yet.</p>
          )}
          <button
            onClick={() => {
              setDraft(current ?? "");
              setEditing(true);
            }}
            className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300"
          >
            {current ? "Edit response" : "Write response"}
          </button>
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="rounded bg-zinc-900 px-2 py-0.5 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save response
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600"
            >
              Cancel
            </button>
            {error && <span className="text-red-500">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConsultantReportsSection({
  bidId,
  onItemsChanged,
}: {
  bidId: number;
  /** Called after an item is created/linked so the register refreshes. */
  onItemsChanged?: () => Promise<void> | void;
}) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [reportType, setReportType] = useState("ENGINEER_FIELD_REPORT");
  const [reportNumber, setReportNumber] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/consultant-reports`);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      setReports(
        ((await res.json()) as { consultantReports: ReportRow[] }).consultantReports
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Load failed");
    }
  }, [bidId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadReport() {
    if (!pendingFile || !vendorName.trim()) return;
    setBusy(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", pendingFile);
      form.append("vendorName", vendorName.trim());
      form.append("reportType", reportType);
      if (reportNumber.trim()) form.append("reportNumber", reportNumber.trim());
      if (reportDate) form.append("reportDate", new Date(reportDate).toISOString());
      const res = await fetch(`/api/bids/${bidId}/consultant-reports`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { error?: string; duplicate?: boolean; reportId?: number };
      if (!res.ok) {
        setUploadError(json.error ?? "Upload failed");
        return;
      }
      if (json.duplicate) {
        setUploadError(
          "Already on file — this exact PDF was uploaded before. Nothing new was created."
        );
        setExpandedId(json.reportId ?? null);
      } else {
        setVendorName("");
        setReportNumber("");
        setReportDate("");
      }
      setPendingFile(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Consultant Reports
        </h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Reports received from architects, engineers, and other consultants — tracked by
          consultant, cited into the Register, and answered. You read the PDF and enter
          observations yourself; nothing is extracted automatically.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <input
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="consultant (e.g. IMEG)"
          className="w-40 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value)}
          className="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={reportNumber}
          onChange={(e) => setReportNumber(e.target.value)}
          placeholder="report # (verbatim)"
          className="w-32 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          className="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <label className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300">
          {pendingFile ? pendingFile.name : "Choose PDF"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              setPendingFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
        <button
          onClick={uploadReport}
          disabled={busy || !pendingFile || !vendorName.trim()}
          className="rounded bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Upload report
        </button>
        {uploadError && <span className="text-xs text-amber-600">{uploadError}</span>}
      </div>

      {loadError && <p className="text-xs text-red-500">{loadError}</p>}
      {reports.length === 0 && !loadError && (
        <p className="text-xs text-zinc-400">
          No consultant reports yet. Upload a PDF to start entering observations.
        </p>
      )}

      <ul className="space-y-1">
        {reports.map((r) => (
          <li key={r.id} className="rounded border border-zinc-100 dark:border-zinc-800">
            <button
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs"
            >
              <span className="text-zinc-800 dark:text-zinc-200">
                {r.vendorName}
                {r.title ? ` — ${r.title}` : ""}
                {r.reportNumber ? ` ${r.reportNumber}` : ""}
                <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                  {REPORT_TYPE_LABELS[r.reportType] ?? r.reportType}
                </span>
                {r.status === "VOIDED" && (
                  <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    VOIDED
                  </span>
                )}
              </span>
              <span className="text-zinc-400">
                {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "no date"} ·{" "}
                {r.observationCount} observation{r.observationCount === 1 ? "" : "s"}
                {r.revisionCount > 1 ? ` · Rev ${r.revisionCount - 1}` : ""}
              </span>
            </button>
            {expandedId === r.id && (
              <ReportDetail
                bidId={bidId}
                reportId={r.id}
                onChanged={async () => {
                  await load();
                  await onItemsChanged?.();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportDetail({
  bidId,
  reportId,
  onChanged,
}: {
  bidId: number;
  reportId: number;
  onChanged: () => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<ReportDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [viewerFailed, setViewerFailed] = useState(false);
  const base = `/api/bids/${bidId}/consultant-reports/${reportId}`;

  const refresh = useCallback(async () => {
    const res = await fetch(`${base}/detail`);
    if (!res.ok) {
      setError(`Load failed (${res.status})`);
      return;
    }
    setDetail(
      ((await res.json()) as { consultantReport: ReportDetailData }).consultantReport
    );
  }, [base]);

  // Live linked-item status: a fresh fetch on every expand/refocus — never a
  // stale cache.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!detail) {
    return (
      <div className="border-t border-zinc-100 px-2 py-2 text-xs text-zinc-400 dark:border-zinc-800">
        {error ?? "Loading…"}
      </div>
    );
  }

  const voided = detail.status === "VOIDED";

  return (
    <div className="space-y-2 border-t border-zinc-100 px-2 py-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => {
            setShowViewer((v) => !v);
            setViewerFailed(false);
          }}
          className="rounded border border-zinc-300 px-2 py-1 text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300"
        >
          {showViewer ? "Hide PDF" : "View PDF"}
        </button>
        <a
          href={`${base}/download`}
          className="text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Download
        </a>
        {detail.revisions.length > 1 && (
          <span className="text-zinc-400">
            {detail.revisions.length} files on record — Rev{" "}
            {detail.revisions[0]?.revisionIndex} is current; superseded files stay
            downloadable.
          </span>
        )}
        <VoidButton bidId={bidId} reportId={reportId} voided={voided} onChanged={refresh} />
      </div>

      {showViewer &&
        (viewerFailed ? (
          <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            Preview unavailable here —{" "}
            <a href={`${base}/download`} className="underline">
              Download the PDF
            </a>{" "}
            and enter observations from your PDF app. Nothing else changes.
          </div>
        ) : (
          <iframe
            src={base}
            title="Consultant report PDF"
            className="h-96 w-full rounded border border-zinc-200 dark:border-zinc-700"
            onError={() => setViewerFailed(true)}
          />
        ))}

      <ObservationsWorkbench
        bidId={bidId}
        reportId={reportId}
        voided={voided}
        observations={detail.observations}
        onChanged={async () => {
          await refresh();
          await onChanged();
        }}
      />
    </div>
  );
}

function VoidButton({
  bidId,
  reportId,
  voided,
  onChanged,
}: {
  bidId: number;
  reportId: number;
  voided: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (voided) return <span className="text-red-500">Report voided — kept on record.</span>;
  return (
    <span className="ml-auto flex items-center gap-1">
      {confirming ? (
        <>
          <span className="text-zinc-500">Void this report? Files and history are kept.</span>
          <button
            onClick={async () => {
              setError(null);
              const res = await fetch(
                `/api/bids/${bidId}/consultant-reports/${reportId}/void`,
                { method: "POST" }
              );
              const json = (await res.json()) as { error?: string };
              if (!res.ok) {
                setError(json.error ?? "Void failed");
                return;
              }
              setConfirming(false);
              await onChanged();
            }}
            className="rounded bg-red-700 px-2 py-0.5 text-white"
          >
            Void report
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="rounded border border-red-300 px-2 py-0.5 text-red-600 hover:border-red-400 dark:border-red-800 dark:text-red-400"
          title="admin or pm only"
        >
          Void report…
        </button>
      )}
      {error && <span className="text-red-500">{error}</span>}
    </span>
  );
}

function ObservationsWorkbench({
  bidId,
  reportId,
  voided,
  observations,
  onChanged,
}: {
  bidId: number;
  reportId: number;
  voided: boolean;
  observations: ObservationRow[];
  onChanged: () => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [page, setPage] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = `/api/bids/${bidId}/consultant-reports/${reportId}`;

  async function createObservation() {
    setError(null);
    const res = await fetch(`${base}/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observationText: text,
        ...(page.trim() ? { sourcePage: page.trim() } : {}),
        ...(targetDate ? { consultantTargetDate: new Date(targetDate).toISOString() } : {}),
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Create failed");
      return;
    }
    setText("");
    setPage("");
    setTargetDate("");
    await onChanged();
  }

  return (
    <div className="space-y-2">
      {!voided && (
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="observation (typed from the PDF)"
            className="w-72 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <input
            value={page}
            onChange={(e) => setPage(e.target.value)}
            placeholder="page (e.g. p.2)"
            className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            Consultant target
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
          <button
            onClick={createObservation}
            disabled={!text.trim()}
            className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            Add observation
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      )}

      {observations.length === 0 && (
        <p className="text-[11px] text-zinc-400">
          No observations yet. Read the PDF and enter each observation you want tracked.
        </p>
      )}

      <ul className="space-y-1">
        {observations.map((o) => (
          <ObservationCard
            key={o.id}
            bidId={bidId}
            reportId={reportId}
            observation={o}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function ObservationCard({
  bidId,
  reportId,
  observation: o,
  onChanged,
}: {
  bidId: number;
  reportId: number;
  observation: ObservationRow;
  onChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [acceptTitle, setAcceptTitle] = useState("");
  const [acceptDue, setAcceptDue] = useState(""); // human-confirmed pre-fill, never auto-synced
  const [linkItemId, setLinkItemId] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const base = `/api/bids/${bidId}/consultant-reports/${reportId}/observations/${o.id}`;

  async function post(url: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Action failed");
      return false;
    }
    await onChanged();
    return true;
  }

  const stateChip =
    o.state === "ACCEPTED_NEW_ITEM" && o.registerItem ? (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        Source of Item #{o.registerItem.id}
      </span>
    ) : o.state === "ACCEPTED_LINKED_ITEM" && o.registerItem ? (
      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
        Supports Item #{o.registerItem.id}
      </span>
    ) : o.state === "DISMISSED" ? (
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
        Dismissed — kept on record{o.dismissedReason ? ` (${o.dismissedReason})` : ""}
      </span>
    ) : null;

  return (
    <li className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Source-verbatim band — frozen once the row leaves ENTERED. */}
          <p className="text-zinc-800 dark:text-zinc-200">
            {o.observationText}
            {o.sourcePage && <span className="ml-1 text-zinc-400">· {o.sourcePage}</span>}
            {o.state !== "ENTERED" && (
              <span
                className="ml-1 text-zinc-400"
                title="Source-verbatim fields are frozen after resolution — corrections happen on the Register Item"
              >
                🔒
              </span>
            )}
          </p>
          {(o.consultantTargetDate || o.registerItem?.dueDate) && (
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {o.consultantTargetDate &&
                `Consultant target ${new Date(o.consultantTargetDate).toLocaleDateString()}`}
              {o.consultantTargetDate && o.registerItem?.dueDate && " · "}
              {o.registerItem?.dueDate &&
                `Our due date ${new Date(o.registerItem.dueDate).toLocaleDateString()}`}
            </p>
          )}
        </div>
        {stateChip}
      </div>

      {o.registerItem && (
        <div className="mt-1 space-y-1">
          <p className="text-[11px] text-zinc-500">
            Item #{o.registerItem.id} “{o.registerItem.title}” —{" "}
            <span className="font-medium">{o.registerItem.status.replaceAll("_", " ")}</span>
          </p>
          <FormalResponseEditor
            bidId={bidId}
            itemId={o.registerItem.id}
            current={o.registerItem.formalResponse}
            byline={
              o.registerItem.formalResponseBy
                ? `Response by ${o.registerItem.formalResponseBy}${
                    o.registerItem.formalResponseAt
                      ? ` · ${new Date(o.registerItem.formalResponseAt).toLocaleDateString()}`
                      : ""
                  }`
                : null
            }
            onSaved={onChanged}
          />
        </div>
      )}

      {o.state === "ENTERED" && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <input
            value={acceptTitle}
            onChange={(e) => setAcceptTitle(e.target.value)}
            placeholder="new item title"
            className="w-48 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            Due
            <input
              type="date"
              value={acceptDue}
              onChange={(e) => setAcceptDue(e.target.value)}
              className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {o.consultantTargetDate && !acceptDue && (
              <button
                onClick={() => setAcceptDue(o.consultantTargetDate!.slice(0, 10))}
                className="rounded border border-zinc-300 px-1 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-600"
                title="Suggested from consultant target — yours to change"
              >
                use consultant target
              </button>
            )}
          </label>
          <button
            onClick={() =>
              post(`${base}/accept-new`, {
                title: acceptTitle,
                ...(acceptDue ? { dueDate: new Date(acceptDue).toISOString() } : {}),
              }).then((ok) => ok && setAcceptTitle(""))
            }
            disabled={!acceptTitle.trim()}
            className="rounded bg-emerald-700 px-2 py-0.5 text-white disabled:opacity-40"
          >
            Accept → new item
          </button>
          <input
            value={linkItemId}
            onChange={(e) => setLinkItemId(e.target.value)}
            placeholder="item #"
            className="w-16 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={() =>
              post(`/api/bids/${bidId}/tracked-items/${parseInt(linkItemId, 10)}/link-observation`, {
                reportId,
                observationId: o.id,
              }).then((ok) => ok && setLinkItemId(""))
            }
            disabled={!/^\d+$/.test(linkItemId.trim())}
            className="rounded bg-sky-700 px-2 py-0.5 text-white disabled:opacity-40"
          >
            Link to existing item
          </button>
          {confirmingDismiss ? (
            <>
              <input
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="reason (optional)"
                className="w-40 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={() =>
                  post(`${base}/dismiss`, {
                    ...(dismissReason.trim() ? { reason: dismissReason.trim() } : {}),
                  }).then((ok) => ok && setConfirmingDismiss(false))
                }
                className="rounded bg-zinc-600 px-2 py-0.5 text-white"
              >
                Confirm dismiss
              </button>
              <button
                onClick={() => setConfirmingDismiss(false)}
                className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingDismiss(true)}
              className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 hover:border-zinc-400 dark:border-zinc-600"
            >
              Dismiss…
            </button>
          )}
        </div>
      )}

      {o.state === "DISMISSED" && (
        <button
          onClick={() => post(`${base}/reinstate`)}
          className="mt-1 rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 hover:border-zinc-400 dark:border-zinc-600"
        >
          Reinstate
        </button>
      )}

      {o.state === "ACCEPTED_LINKED_ITEM" && (
        <div className="mt-1 flex items-center gap-1">
          <input
            value={linkItemId}
            onChange={(e) => setLinkItemId(e.target.value)}
            placeholder="correct to item #"
            className="w-28 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={() =>
              post(`/api/bids/${bidId}/tracked-items/${parseInt(linkItemId, 10)}/link-observation`, {
                reportId,
                observationId: o.id,
              }).then((ok) => ok && setLinkItemId(""))
            }
            disabled={!/^\d+$/.test(linkItemId.trim())}
            className="rounded border border-sky-300 px-2 py-0.5 text-sky-700 disabled:opacity-40 dark:border-sky-800 dark:text-sky-400"
          >
            Correct link
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-red-500">{error}</p>}
    </li>
  );
}
