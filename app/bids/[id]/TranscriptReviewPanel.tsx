"use client";

// Module R2-B1 — transcript review with audited diarization/transcript
// corrections, mounted in a meeting's Transcript section (MeetingsTab).
// Renders the materialized segment overlay (originals stay immutable
// server-side); every action posts ONE correction op with author + reason
// and lands in the append-only correction history shown below.

import { useCallback, useEffect, useRef, useState } from "react";

type SegmentRow = {
  id: number;
  sortKey: number;
  startSec: number | null;
  endSec: number | null;
  originalSpeakerLabel: string | null;
  originalText: string;
  currentSpeakerLabel: string | null;
  currentText: string;
  isUnknownSpeaker: boolean;
};

type CorrectionRow = {
  id: number;
  correctionType: string;
  segmentId: number | null;
  fromValue: string | null;
  toValue: string | null;
  affectedSegmentCount: number;
  reason: string | null;
  correctedBy: string;
  createdAt: string;
};

function fmtTs(sec: number | null): string {
  if (sec == null) return "—:—";
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function TranscriptReviewPanel({
  bidId,
  meetingId,
  focusSegmentId,
}: {
  bidId: number;
  meetingId: number;
  /** When set, scrolls to and highlights this segment (timestamp navigation). */
  focusSegmentId?: number | null;
}) {
  const base = `/api/bids/${bidId}/meetings/${meetingId}`;
  const [segments, setSegments] = useState<SegmentRow[] | null>(null);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [speakerTool, setSpeakerTool] = useState<"" | "rename" | "reassign-all" | "merge" | "unknown">("");
  const [toolFrom, setToolFrom] = useState("");
  const [toolTo, setToolTo] = useState("");
  const [toolReason, setToolReason] = useState("");
  const [busy, setBusy] = useState(false);
  const focusRef = useRef<HTMLLIElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [segRes, corRes] = await Promise.all([
        fetch(`${base}/segments`),
        fetch(`${base}/segments/corrections`),
      ]);
      if (!segRes.ok) throw new Error(`Segments load failed (${segRes.status})`);
      setSegments(((await segRes.json()) as { segments: SegmentRow[] }).segments);
      if (corRes.ok) {
        setCorrections(((await corRes.json()) as { corrections: CorrectionRow[] }).corrections);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (focusSegmentId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusSegmentId, segments]);

  async function postCorrection(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/segments/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Correction failed");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (segments === null && !error) {
    return <p className="text-xs text-zinc-500">Loading transcript segments…</p>;
  }
  if (segments !== null && segments.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No transcript segments yet — they materialize once a transcript exists.
      </p>
    );
  }

  const speakerLabels = Array.from(
    new Set((segments ?? []).map((s) => s.currentSpeakerLabel).filter((v): v is string => !!v))
  ).sort();

  async function runSpeakerTool() {
    if (!speakerTool) return;
    const common = { reason: toolReason.trim() || undefined };
    let ok = false;
    if (speakerTool === "rename") {
      ok = await postCorrection({
        correctionType: "RENAME_SPEAKER",
        fromSpeakerLabel: toolFrom,
        toValue: toolTo,
        ...common,
      });
    } else if (speakerTool === "reassign-all") {
      ok = await postCorrection({
        correctionType: "REASSIGN_ALL_MATCHING",
        fromSpeakerLabel: toolFrom,
        toValue: toolTo,
        ...common,
      });
    } else if (speakerTool === "merge") {
      ok = await postCorrection({
        correctionType: "MERGE_SPEAKERS",
        fromSpeakerLabel: toolFrom,
        toValue: toolTo,
        ...common,
      });
    } else if (speakerTool === "unknown") {
      ok = await postCorrection({
        correctionType: "MARK_UNKNOWN",
        fromSpeakerLabel: toolFrom,
        ...common,
      });
    }
    if (ok) {
      setSpeakerTool("");
      setToolFrom("");
      setToolTo("");
      setToolReason("");
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Transcript Review
            <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {segments?.length ?? 0} segments
            </span>
            {corrections.length > 0 && (
              <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                {corrections.length} corrections
              </span>
            )}
          </h4>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            The original recording and raw transcript are immutable — every fix here is
            an audited correction with author and reason.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {(["rename", "reassign-all", "merge", "unknown"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSpeakerTool(speakerTool === t ? "" : t)}
              className={`rounded border px-2 py-0.5 ${
                speakerTool === t
                  ? "border-sky-400 text-sky-700 dark:text-sky-300"
                  : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-600"
              }`}
            >
              {t === "rename" && "Rename speaker…"}
              {t === "reassign-all" && "Reassign all…"}
              {t === "merge" && "Merge speakers…"}
              {t === "unknown" && "Mark unknown…"}
            </button>
          ))}
        </div>
      </div>

      {speakerTool && (
        <div className="flex flex-wrap items-center gap-1 rounded border border-zinc-200 p-2 text-[11px] dark:border-zinc-700">
          <select
            value={toolFrom}
            onChange={(e) => setToolFrom(e.target.value)}
            className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">speaker…</option>
            {speakerLabels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          {speakerTool !== "unknown" && (
            <input
              value={toolTo}
              onChange={(e) => setToolTo(e.target.value)}
              placeholder={speakerTool === "rename" ? "new display name" : "target speaker label"}
              className="w-44 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              list={speakerTool === "rename" ? undefined : "r2-speaker-labels"}
            />
          )}
          <datalist id="r2-speaker-labels">
            {speakerLabels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <input
            value={toolReason}
            onChange={(e) => setToolReason(e.target.value)}
            placeholder="reason (optional)"
            className="w-44 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={() => void runSpeakerTool()}
            disabled={busy || !toolFrom || (speakerTool !== "unknown" && !toolTo.trim())}
            className="rounded bg-sky-700 px-2 py-0.5 text-white disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <ul className="max-h-[28rem] space-y-0.5 overflow-y-auto pr-1">
        {(segments ?? []).map((seg) => (
          <SegmentLine
            key={seg.id}
            seg={seg}
            focused={seg.id === focusSegmentId}
            focusRef={seg.id === focusSegmentId ? focusRef : undefined}
            speakerLabels={speakerLabels}
            busy={busy}
            onCorrection={postCorrection}
          />
        ))}
      </ul>

      <button
        onClick={() => setShowHistory((v) => !v)}
        className="text-[11px] text-zinc-400 underline decoration-dotted"
      >
        {showHistory ? "hide" : "show"} correction history ({corrections.length})
      </button>
      {showHistory && (
        <ul className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {corrections.length === 0 && <li>No corrections yet.</li>}
          {corrections.map((c) => (
            <li key={c.id} className="rounded border border-zinc-100 px-2 py-1 dark:border-zinc-800">
              <span className="font-medium">{c.correctionType}</span>
              {c.fromValue && <> · {c.fromValue.slice(0, 60)}</>}
              {c.toValue && <> → {c.toValue.slice(0, 60)}</>}
              {c.affectedSegmentCount > 0 && <> · {c.affectedSegmentCount} segment(s)</>}
              <> · {c.correctedBy}</>
              {c.reason && <> · “{c.reason}”</>}
              <> · {new Date(c.createdAt).toLocaleString()}</>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SegmentLine({
  seg,
  focused,
  focusRef,
  speakerLabels,
  busy,
  onCorrection,
}: {
  seg: SegmentRow;
  focused: boolean;
  focusRef?: React.RefObject<HTMLLIElement | null>;
  speakerLabels: string[];
  busy: boolean;
  onCorrection: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"" | "reassign" | "edit" | "split">("");
  const [value, setValue] = useState("");
  const [splitOffset, setSplitOffset] = useState(0);
  const [splitSpeaker, setSplitSpeaker] = useState("");
  const [reason, setReason] = useState("");

  const edited = seg.currentText !== seg.originalText;
  const reattributed = seg.currentSpeakerLabel !== seg.originalSpeakerLabel;

  async function apply() {
    let ok = false;
    const common = { segmentId: seg.id, reason: reason.trim() || undefined };
    if (mode === "reassign") {
      ok = await onCorrection({ correctionType: "REASSIGN_SEGMENT", toValue: value, ...common });
    } else if (mode === "edit") {
      ok = await onCorrection({ correctionType: "EDIT_TEXT", newText: value, ...common });
    } else if (mode === "split") {
      ok = await onCorrection({
        correctionType: "SPLIT_SEGMENT",
        splitOffset,
        secondSpeakerLabel: splitSpeaker.trim() || undefined,
        ...common,
      });
    }
    if (ok) {
      setMode("");
      setValue("");
      setReason("");
    }
  }

  return (
    <li
      ref={focusRef}
      className={`group rounded px-2 py-1 text-xs ${
        focused
          ? "bg-sky-50 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-700"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-mono text-[10px] text-zinc-400">{fmtTs(seg.startSec)}</span>
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${
            seg.isUnknownSpeaker
              ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          }`}
          title={
            reattributed
              ? `Originally ${seg.originalSpeakerLabel ?? "unknown"} — reattributed by correction`
              : undefined
          }
        >
          {seg.isUnknownSpeaker ? "[UNKNOWN]" : seg.currentSpeakerLabel ?? "—"}
          {reattributed && "*"}
        </span>
        <p className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
          {seg.currentText}
          {edited && (
            <span
              className="ml-1 text-[10px] text-amber-600 dark:text-amber-400"
              title={`Original wording (immutable): ${seg.originalText}`}
            >
              (edited)
            </span>
          )}
        </p>
        <div className="hidden shrink-0 gap-1 text-[10px] group-hover:flex">
          <button onClick={() => { setMode(mode === "reassign" ? "" : "reassign"); setValue(seg.currentSpeakerLabel ?? ""); }} className="text-zinc-400 hover:text-sky-600">reassign</button>
          <button onClick={() => { setMode(mode === "edit" ? "" : "edit"); setValue(seg.currentText); }} className="text-zinc-400 hover:text-sky-600">edit</button>
          <button onClick={() => { setMode(mode === "split" ? "" : "split"); setSplitOffset(Math.floor(seg.currentText.length / 2)); }} className="text-zinc-400 hover:text-sky-600">split</button>
          <button
            onClick={() => void onCorrection({ correctionType: "MARK_UNKNOWN", segmentId: seg.id })}
            disabled={busy || seg.isUnknownSpeaker}
            className="text-zinc-400 hover:text-sky-600 disabled:opacity-30"
          >
            unknown
          </button>
        </div>
      </div>

      {mode && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-12 text-[11px]">
          {mode === "reassign" && (
            <>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                list="r2-speaker-labels"
                placeholder="speaker label"
                className="w-40 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              {speakerLabels.length === 0 && null}
            </>
          )}
          {mode === "edit" && (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={2}
              className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          )}
          {mode === "split" && (
            <>
              <label className="text-zinc-500">split after character</label>
              <input
                type="number"
                min={1}
                max={seg.currentText.length - 1}
                value={splitOffset}
                onChange={(e) => setSplitOffset(Number(e.target.value))}
                className="w-20 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <input
                value={splitSpeaker}
                onChange={(e) => setSplitSpeaker(e.target.value)}
                list="r2-speaker-labels"
                placeholder="second half speaker (optional)"
                className="w-52 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <span className="w-full text-[10px] text-zinc-400">
                “{seg.currentText.slice(0, splitOffset)}” | “{seg.currentText.slice(splitOffset)}”
              </span>
            </>
          )}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional)"
            className="w-40 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={() => void apply()}
            disabled={busy || (mode !== "split" && !value.trim())}
            className="rounded bg-sky-700 px-2 py-0.5 text-white disabled:opacity-40"
          >
            Apply
          </button>
          <button
            onClick={() => setMode("")}
            className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
