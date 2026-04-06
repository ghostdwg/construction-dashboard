"use client";

import { useRef, useState, useEffect } from "react";
import { TierBadge } from "@/app/subcontractors/[id]/SubIntelligencePanel";

// ---- Types: Estimate Upload ----

type Sub = {
  id: number;
  company: string;
  tier: string;
};

type EstimateUpload = {
  id: number;
  subcontractorId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  scopeLines: string;
  parseStatus: string;
  parseError: string | null;
  uploadedAt: Date | string;
};

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done"; upload: EstimateUpload }
  | { status: "error"; message: string };

// ---- Types: Leveling Matrix ----

type LevelingRowData = {
  id: number;
  estimateUploadId: number;
  division: string;
  scopeText: string;
  status: string;
  note: string | null;
};

type SubInfo = {
  estimateUploadId: number;
  subcontractorId: number;
  fileName: string;
  label: string;
};

type TradeGroup = {
  tradeId: number | null;
  tradeName: string;
  rows: LevelingRowData[];
};

type LevelingData = {
  sessionId: number;
  status: string;
  subs: SubInfo[];
  trades: TradeGroup[];
};

// ---- Helpers ----

function scopeLineCount(scopeLines: string): number {
  try {
    const parsed = JSON.parse(scopeLines);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  unreviewed: { label: "Unreviewed", badge: "bg-zinc-100 text-zinc-500" },
  included: { label: "Included", badge: "bg-green-100 text-green-700" },
  excluded: { label: "Excluded", badge: "bg-red-100 text-red-600" },
  clarification_needed: { label: "Clarify", badge: "bg-amber-100 text-amber-700" },
};

function tradeKey(t: TradeGroup): string {
  return t.tradeId != null ? String(t.tradeId) : "unassigned";
}

// ---- SubUploadRow ----

function SubUploadRow({
  bidId,
  sub,
  initial,
}: {
  bidId: number;
  sub: Sub;
  initial: EstimateUpload | null;
}) {
  const [upload, setUpload] = useState<EstimateUpload | null>(initial);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setState({ status: "uploading" });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("subcontractorId", String(sub.id));

    try {
      const res = await fetch(`/api/bids/${bidId}/estimates`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok && res.status !== 422) {
        setState({ status: "error", message: data.error ?? "Upload failed" });
        return;
      }
      setUpload(data);
      setState({ status: "done", upload: data });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  const current = upload;

  return (
    <div className="flex items-start justify-between py-3 border-b border-zinc-100 last:border-0">
      {/* Sub info */}
      <div className="flex items-center gap-3 w-1/3">
        <div>
          <p className="text-sm font-medium text-zinc-800">{sub.company}</p>
        </div>
        <TierBadge tier={sub.tier} />
      </div>

      {/* Status + actions */}
      <div className="flex-1 flex items-center justify-between gap-4">
        {!current || current.parseStatus === "failed" ? (
          <>
            <div>
              {current?.parseStatus === "failed" ? (
                <p className="text-xs text-red-600">
                  Parse failed:{" "}
                  <span className="font-normal">{current.parseError}</span>
                </p>
              ) : (
                <p className="text-xs text-zinc-400">No estimate uploaded</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {state.status === "uploading" && (
                <span className="text-xs text-zinc-400">Uploading…</span>
              )}
              {state.status === "error" && (
                <span className="text-xs text-red-500">{state.message}</span>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={state.status === "uploading"}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {current?.parseStatus === "failed" ? "Re-upload" : "Upload estimate"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </>
        ) : current.parseStatus === "processing" ? (
          <p className="text-xs text-amber-600">Processing…</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-green-700 font-medium">
                Ready — {scopeLineCount(current.scopeLines)} scope lines
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {current.fileName} &middot;{" "}
                {formatFileSize(current.fileSize)} &middot;{" "}
                {new Date(String(current.uploadedAt)).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={state.status === "uploading"}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
            >
              {state.status === "uploading" ? "Uploading…" : "Replace"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---- ScopeRowCard ----

function ScopeRowCard({
  bidId,
  row: initialRow,
  onUpdate,
}: {
  bidId: number;
  row: LevelingRowData;
  onUpdate: (updated: LevelingRowData) => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(row.note ?? "");
  const [questionSent, setQuestionSent] = useState(false);
  const [saving, setSaving] = useState(false);

  async function patchRow(data: Partial<Pick<LevelingRowData, "status" | "note">>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/leveling/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated: LevelingRowData = await res.json();
        setRow(updated);
        onUpdate(updated);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleNoteSave() {
    setEditingNote(false);
    const trimmed = noteValue.trim() || null;
    if (trimmed !== row.note) {
      await patchRow({ note: trimmed });
    }
  }

  async function sendToQuestions() {
    const res = await fetch(`/api/bids/${bidId}/leveling/${row.id}/question`, {
      method: "POST",
    });
    if (res.ok) setQuestionSent(true);
  }

  const cfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.unreviewed;

  return (
    <div
      className={`rounded border border-zinc-100 p-3 mb-2 bg-white transition-opacity ${
        saving ? "opacity-50" : ""
      }`}
    >
      {row.division && (
        <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wide mb-0.5">
          {row.division}
        </p>
      )}
      <p className="text-xs text-zinc-800 leading-relaxed">{row.scopeText}</p>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {/* Status selector */}
        <select
          value={row.status}
          onChange={(e) => patchRow({ status: e.target.value })}
          disabled={saving}
          className={`text-xs rounded px-1.5 py-0.5 font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300 ${cfg.badge}`}
        >
          {Object.entries(STATUS_CONFIG).map(([val, c]) => (
            <option key={val} value={val}>
              {c.label}
            </option>
          ))}
        </select>

        {/* Note toggle */}
        {!editingNote && (
          <button
            onClick={() => setEditingNote(true)}
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            {row.note ? "Edit note" : "+ Note"}
          </button>
        )}

        {/* Send to Questions */}
        {row.status === "clarification_needed" && !questionSent && (
          <button
            onClick={sendToQuestions}
            className="ml-auto text-xs text-amber-700 hover:underline"
          >
            Send to Questions →
          </button>
        )}
        {questionSent && (
          <span className="ml-auto text-xs text-green-600">Sent ✓</span>
        )}
      </div>

      {/* Inline note editor */}
      {editingNote && (
        <textarea
          autoFocus
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          onBlur={handleNoteSave}
          rows={2}
          placeholder="Add a note…"
          className="mt-2 w-full text-xs border border-zinc-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-zinc-300"
        />
      )}
      {row.note && !editingNote && (
        <p className="mt-1.5 text-xs text-zinc-500 italic">{row.note}</p>
      )}
    </div>
  );
}

// ---- LevelingMatrix ----

function LevelingMatrix({ bidId }: { bidId: number }) {
  const [data, setData] = useState<LevelingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTrade, setActiveTrade] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/leveling`)
      .then((r) => r.json())
      .then((d: LevelingData) => {
        setData(d);
        if (d.trades.length > 0) setActiveTrade(tradeKey(d.trades[0]));
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [bidId]);

  function handleRowUpdate(tKey: string, updated: LevelingRowData) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        trades: prev.trades.map((t) =>
          tradeKey(t) !== tKey
            ? t
            : { ...t, rows: t.rows.map((r) => (r.id === updated.id ? updated : r)) }
        ),
      };
    });
  }

  if (loading) {
    return <p className="text-xs text-zinc-400">Loading scope matrix…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-500">Error: {error}</p>;
  }
  if (!data || data.subs.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No complete estimates yet. Upload and parse estimates in the section above, then
        return here to level.
      </p>
    );
  }
  if (data.trades.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        Estimates parsed but no scope lines found. Try re-uploading.
      </p>
    );
  }

  const activeGroup = data.trades.find((t) => tradeKey(t) === activeTrade);

  return (
    <div>
      {/* Header row: trade selector + export button */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex gap-1.5 flex-wrap">
        {data.trades.map((t) => {
          const key = tradeKey(t);
          const isActive = activeTrade === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTrade(key)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                isActive
                  ? "bg-zinc-800 text-white border-zinc-800"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {t.tradeName}
              <span className="ml-1.5 opacity-60">{t.rows.length}</span>
            </button>
          );
        })}
        </div>
        <a
          href={`/api/bids/${bidId}/leveling/export`}
          download
          className="shrink-0 rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 whitespace-nowrap"
        >
          Export XLSX
        </a>
      </div>

      {/* Side-by-side columns */}
      {activeGroup ? (
        <div className="overflow-x-auto -mx-1 px-1">
          <div
            className="flex gap-4"
            style={{ minWidth: `${data.subs.length * 280}px` }}
          >
            {data.subs.map((sub) => {
              const subRows = activeGroup.rows.filter(
                (r) => r.estimateUploadId === sub.estimateUploadId
              );
              const tKey = tradeKey(activeGroup);
              return (
                <div key={sub.estimateUploadId} className="flex-1 min-w-[260px]">
                  {/* Column header */}
                  <div className="flex items-baseline gap-2 mb-3 pb-2 border-b border-zinc-200">
                    <span className="text-xs font-semibold text-zinc-700">{sub.label}</span>
                    <span
                      className="text-xs text-zinc-400 truncate flex-1"
                      title={sub.fileName}
                    >
                      {sub.fileName}
                    </span>
                    <span className="text-xs text-zinc-400 shrink-0">
                      {subRows.length} lines
                    </span>
                  </div>

                  {/* Scope rows */}
                  {subRows.length === 0 ? (
                    <p className="text-xs text-zinc-300 italic px-1">
                      No scope lines for this trade
                    </p>
                  ) : (
                    subRows.map((row) => (
                      <ScopeRowCard
                        key={row.id}
                        bidId={bidId}
                        row={row}
                        onUpdate={(updated) => handleRowUpdate(tKey, updated)}
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Main component ----

export default function LevelingTab({
  bidId,
  subs,
  initialUploads,
}: {
  bidId: number;
  subs: Sub[];
  initialUploads: EstimateUpload[];
}) {
  const uploadMap = new Map(initialUploads.map((u) => [u.subcontractorId, u]));

  return (
    <div className="flex flex-col gap-8">
      {/* ── Section 1: Estimate Uploads ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-1">
          Estimate Uploads
        </h2>
        <p className="text-xs text-zinc-400 mb-4">
          Upload estimates for subs with received, reviewing, or accepted
          status. Pricing is stripped before any AI use.
        </p>

        {subs.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No subs with estimates received yet. Update RFQ status on the Subs
            tab.
          </p>
        ) : (
          <div className="rounded-md border border-zinc-200 px-4">
            {subs.map((sub) => (
              <SubUploadRow
                key={sub.id}
                bidId={bidId}
                sub={sub}
                initial={uploadMap.get(sub.id) ?? null}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Project Baseline ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Project Baseline
        </h2>
        <div className="rounded-md border border-zinc-200 p-6 text-center">
          <p className="text-sm text-zinc-400">
            Spec book or drawing index — coming in Tier 4
          </p>
        </div>
      </section>

      {/* ── Section 3: Scope Matrix ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-1">
          Scope Matrix
        </h2>
        <p className="text-xs text-zinc-400 mb-4">
          Review each sub&apos;s scope lines side by side. Mark items included,
          excluded, or flagged for clarification. Flagged items can be sent
          directly to the Questions tab.
        </p>
        <LevelingMatrix bidId={bidId} />
      </section>
    </div>
  );
}
