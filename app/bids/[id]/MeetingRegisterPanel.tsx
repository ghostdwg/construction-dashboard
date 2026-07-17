"use client";

// Module R2-B1 — the Meeting Register workspace section (MeetingsTab).
// Durable register of everything meaningful said in the meeting: filter by
// type/disposition, disposition each extracted entry (R2 rule 11), promote
// or link into the Operations Register (entries persist either way), add
// manual entries, and review/apply extraction reruns.

import { useCallback, useEffect, useState } from "react";

type EntryRow = {
  id: number;
  entryType: string;
  agendaTopic: string | null;
  rawSourceText: string;
  normalizedText: string;
  speakerLabel: string | null;
  speakerName: string | null;
  startSec: number | null;
  sourceCitation: string | null;
  segmentId: number | null;
  responsibleParty: string | null;
  dueDate: string | null;
  confidence: string | null;
  origin: string;
  reviewState: string;
  dispositionReason: string | null;
  dispositionBy: string | null;
  mergedIntoEntryId: number | null;
  linkedTrackedItem: { id: number; title: string; status: string; kind: string } | null;
  relatedPriorEntry: { id: number; meetingId: number; normalizedText: string; entryType: string } | null;
};

type Coverage = {
  total: number;
  extracted: number;
  pendingExtracted: number;
  byReviewState: Record<string, number>;
  byEntryType: Record<string, number>;
  fullyReviewed: boolean;
};

type RunRow = {
  id: number;
  analysisVersion: number;
  trigger: string;
  status: string;
  previewJson: string;
  createdBy: string | null;
  createdAt: string;
  appliedBy: string | null;
  appliedAt: string | null;
};

export const ENTRY_TYPES = [
  "DISCUSSION",
  "DECISION",
  "QUESTION",
  "ACTION_ITEM",
  "COMMITMENT",
  "DESIGN_CHANGE",
  "RISK",
  "CONSTRAINT",
  "SCHEDULE_ITEM",
  "PROCUREMENT_ITEM",
  "INFORMATIONAL",
] as const;

const TYPE_STYLES: Record<string, string> = {
  DECISION: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  ACTION_ITEM: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  COMMITMENT: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  DESIGN_CHANGE: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  RISK: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  QUESTION: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const STATE_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  PROMOTED_TO_OPERATIONS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  DISMISSED_WITH_REASON: "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

export default function MeetingRegisterPanel({
  bidId,
  meetingId,
  analyzedAt,
  onJumpToSegment,
}: {
  bidId: number;
  meetingId: number;
  analyzedAt: string | null;
  onJumpToSegment?: (segmentId: number) => void;
}) {
  const base = `/api/bids/${bidId}/meetings/${meetingId}`;
  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (typeFilter) qs.set("entryType", typeFilter);
      if (stateFilter) qs.set("reviewState", stateFilter);
      const [entRes, covRes, runRes] = await Promise.all([
        fetch(`${base}/register?${qs}`),
        fetch(`${base}/register/coverage`),
        fetch(`${base}/extraction-runs`),
      ]);
      if (!entRes.ok) throw new Error(`Register load failed (${entRes.status})`);
      setEntries(((await entRes.json()) as { entries: EntryRow[] }).entries);
      if (covRes.ok) setCoverage(((await covRes.json()) as { coverage: Coverage }).coverage);
      if (runRes.ok) setRuns(((await runRes.json()) as { runs: RunRow[] }).runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [base, typeFilter, stateFilter]);

  useEffect(() => {
    void load();
  }, [load, analyzedAt]);

  const previewedRuns = runs.filter((r) => r.status === "PREVIEWED");

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Meeting Register
            {coverage && (
              <span
                className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  coverage.fullyReviewed
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                }`}
              >
                {coverage.fullyReviewed
                  ? `fully reviewed (${coverage.total} entries)`
                  : `${coverage.pendingExtracted} of ${coverage.extracted} extracted entries need review`}
              </span>
            )}
          </h4>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            The durable record of this meeting. Entries persist even when not promoted;
            promotion into the Operations Register never removes them.
          </p>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">all types</option>
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>{t.replaceAll("_", " ").toLowerCase()}</option>
            ))}
          </select>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">all dispositions</option>
            {["PENDING", "CONFIRMED", "CORRECTED", "MERGED", "DUPLICATE", "DISMISSED_WITH_REASON", "DISCUSSION_ONLY", "INFORMATIONAL", "PROMOTED_TO_OPERATIONS"].map((s) => (
              <option key={s} value={s}>{s.replaceAll("_", " ").toLowerCase()}</option>
            ))}
          </select>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300"
          >
            + Manual entry
          </button>
        </div>
      </div>

      {previewedRuns.length > 0 && (
        <div className="space-y-1 rounded border border-violet-200 bg-violet-50 p-2 text-xs dark:border-violet-900 dark:bg-violet-950/30">
          <p className="font-medium text-violet-800 dark:text-violet-300">
            Extraction rerun awaiting review — nothing is applied until you approve it.
          </p>
          {previewedRuns.map((r) => (
            <RunCard key={r.id} base={base} run={r} onChanged={load} />
          ))}
        </div>
      )}

      {adding && <ManualEntryForm base={base} onDone={() => { setAdding(false); void load(); }} />}

      {error && <p className="text-xs text-red-500">{error}</p>}
      {entries !== null && entries.length === 0 && (
        <p className="text-xs text-zinc-500">
          No register entries{typeFilter || stateFilter ? " match the filter" : " yet — run the analysis or add one manually"}.
        </p>
      )}

      <ul className="space-y-1">
        {(entries ?? []).map((e) => (
          <EntryCard key={e.id} base={base} row={e} onChanged={load} onJumpToSegment={onJumpToSegment} />
        ))}
      </ul>
    </section>
  );
}

function RunCard({ base, run, onChanged }: { base: string; run: RunRow; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  let preview: { toAdd?: number; toReplacePending?: number; preservedDispositioned?: number } = {};
  try {
    preview = JSON.parse(run.previewJson) as typeof preview;
  } catch { /* previewJson stays informational */ }

  async function post(path: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/extraction-runs/${run.id}/${path}`, { method: "POST" });
    const json = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Action failed");
      return;
    }
    onChanged();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-violet-900 dark:text-violet-200">
        Run #{run.id} ({run.trigger.toLowerCase()}): +{preview.toAdd ?? "?"} new ·{" "}
        {preview.toReplacePending ?? "?"} pending replaced ·{" "}
        {preview.preservedDispositioned ?? "?"} dispositioned preserved
      </span>
      <button onClick={() => void post("apply")} disabled={busy} className="rounded bg-violet-700 px-2 py-0.5 text-white disabled:opacity-40">
        Apply
      </button>
      <button onClick={() => void post("discard")} disabled={busy} className="rounded border border-violet-300 px-2 py-0.5 text-violet-700 dark:border-violet-800 dark:text-violet-300">
        Discard
      </button>
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}

function ManualEntryForm({ base, onDone }: { base: string; onDone: () => void }) {
  const [entryType, setEntryType] = useState("DISCUSSION");
  const [text, setText] = useState("");
  const [responsible, setResponsible] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryType,
        normalizedText: text,
        responsibleParty: responsible.trim() || undefined,
        dueDate: dueDate || undefined,
      }),
    });
    const json = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Create failed");
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded border border-zinc-200 p-2 text-[11px] dark:border-zinc-700">
      <select
        value={entryType}
        onChange={(e) => setEntryType(e.target.value)}
        className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      >
        {ENTRY_TYPES.map((t) => (
          <option key={t} value={t}>{t.replaceAll("_", " ").toLowerCase()}</option>
        ))}
      </select>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="entry wording"
        className="min-w-64 flex-1 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <input
        value={responsible}
        onChange={(e) => setResponsible(e.target.value)}
        placeholder="responsible (optional)"
        className="w-40 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <button
        onClick={() => void submit()}
        disabled={busy || !text.trim()}
        className="rounded bg-sky-700 px-2 py-0.5 text-white disabled:opacity-40"
      >
        Add
      </button>
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}

function EntryCard({
  base,
  row: e,
  onChanged,
  onJumpToSegment,
}: {
  base: string;
  row: EntryRow;
  onChanged: () => void;
  onJumpToSegment?: (segmentId: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"" | "dismiss" | "correct" | "merge" | "promote" | "link">("");
  const [input1, setInput1] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/register/${e.id}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Action failed");
      return false;
    }
    onChanged();
    return true;
  }

  const disposition = (d: string, extra: Record<string, unknown> = {}) =>
    post("/disposition", { disposition: d, ...extra });

  const isPending = e.reviewState === "PENDING";
  const rawDiffers = e.rawSourceText !== e.normalizedText;

  return (
    <li className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-zinc-800 dark:text-zinc-200">
            <span className={`mr-1 rounded px-1 py-0.5 text-[10px] font-semibold ${TYPE_STYLES[e.entryType] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}>
              {e.entryType.replaceAll("_", " ")}
            </span>
            {e.normalizedText}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
            {e.sourceCitation && (
              e.segmentId && onJumpToSegment ? (
                <button
                  onClick={() => onJumpToSegment(e.segmentId!)}
                  className="underline decoration-dotted hover:text-sky-600"
                  title="Jump to this moment in the transcript"
                >
                  {e.sourceCitation}
                </button>
              ) : (
                <span>{e.sourceCitation}</span>
              )
            )}
            {e.speakerName && <span>{e.speakerName}</span>}
            {e.responsibleParty && <span>→ {e.responsibleParty}</span>}
            {e.dueDate && <span>due {new Date(e.dueDate).toLocaleDateString()}</span>}
            {e.confidence && <span>{e.confidence.toLowerCase()} confidence</span>}
            <span>{e.origin === "manual" ? "manual" : "extracted"}</span>
            {rawDiffers && (
              <button onClick={() => setShowRaw((v) => !v)} className="underline decoration-dotted">
                {showRaw ? "hide source wording" : "source wording"}
              </button>
            )}
            {e.relatedPriorEntry && (
              <span title={e.relatedPriorEntry.normalizedText}>
                ↩ continues #{e.relatedPriorEntry.id}
              </span>
            )}
          </p>
          {showRaw && (
            <p className="mt-0.5 border-l-2 border-zinc-300 pl-2 text-[11px] italic text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
              “{e.rawSourceText}”
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_STYLES[e.reviewState] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}>
          {e.reviewState.replaceAll("_", " ").toLowerCase()}
          {e.dispositionBy && ` — ${e.dispositionBy}`}
        </span>
      </div>

      {e.linkedTrackedItem && (
        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          Operations Register: #{e.linkedTrackedItem.id} “{e.linkedTrackedItem.title}” ·{" "}
          {e.linkedTrackedItem.status}
        </p>
      )}

      {isPending && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
          {mode === "" && (
            <>
              <button onClick={() => void disposition("CONFIRMED")} disabled={busy} className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">Confirm</button>
              <button onClick={() => { setMode("correct"); setInput1(e.normalizedText); }} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Correct…</button>
              <button onClick={() => void disposition("DISCUSSION_ONLY")} disabled={busy} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Discussion only</button>
              <button onClick={() => void disposition("INFORMATIONAL")} disabled={busy} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Informational</button>
              <button onClick={() => { setMode("merge"); setInput1(""); }} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Merge/dup…</button>
              <button onClick={() => { setMode("dismiss"); setInput1(""); }} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Dismiss…</button>
            </>
          )}
          {mode === "dismiss" && (
            <>
              <input value={input1} onChange={(ev) => setInput1(ev.target.value)} placeholder="reason (required)" className="w-52 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
              <button onClick={() => void disposition("DISMISSED_WITH_REASON", { reason: input1 }).then((ok) => ok && setMode(""))} disabled={busy || !input1.trim()} className="rounded bg-zinc-600 px-2 py-0.5 text-white disabled:opacity-40">Dismiss</button>
              <button onClick={() => setMode("")} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Cancel</button>
            </>
          )}
          {mode === "correct" && (
            <>
              <input value={input1} onChange={(ev) => setInput1(ev.target.value)} className="w-72 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
              <button onClick={() => void disposition("CORRECTED", { correctedText: input1 }).then((ok) => ok && setMode(""))} disabled={busy || !input1.trim()} className="rounded bg-sky-700 px-2 py-0.5 text-white disabled:opacity-40">Save corrected</button>
              <button onClick={() => setMode("")} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Cancel</button>
            </>
          )}
          {mode === "merge" && (
            <>
              <input value={input1} onChange={(ev) => setInput1(ev.target.value)} placeholder="surviving entry id" className="w-36 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
              <button onClick={() => void disposition("MERGED", { targetEntryId: Number(input1) }).then((ok) => ok && setMode(""))} disabled={busy || !/^\d+$/.test(input1)} className="rounded bg-zinc-600 px-2 py-0.5 text-white disabled:opacity-40">Merge</button>
              <button onClick={() => void disposition("DUPLICATE", { targetEntryId: Number(input1) }).then((ok) => ok && setMode(""))} disabled={busy || !/^\d+$/.test(input1)} className="rounded bg-zinc-600 px-2 py-0.5 text-white disabled:opacity-40">Duplicate</button>
              <button onClick={() => setMode("")} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Cancel</button>
            </>
          )}
        </div>
      )}

      {!e.linkedTrackedItem && e.reviewState !== "PROMOTED_TO_OPERATIONS" && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
          {mode === "promote" ? (
            <>
              <input value={input1} onChange={(ev) => setInput1(ev.target.value)} placeholder="item title" className="w-64 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
              <button onClick={() => void post("/promote", { title: input1.trim() || undefined }).then((ok) => ok && setMode(""))} disabled={busy} className="rounded bg-emerald-700 px-2 py-0.5 text-white disabled:opacity-40">Create item</button>
              <button onClick={() => setMode("")} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Cancel</button>
            </>
          ) : mode === "link" ? (
            <>
              <input value={input1} onChange={(ev) => setInput1(ev.target.value)} placeholder="existing item id" className="w-36 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
              <button onClick={() => void post("/link", { trackedItemId: Number(input1) }).then((ok) => ok && setMode(""))} disabled={busy || !/^\d+$/.test(input1)} className="rounded bg-emerald-700 px-2 py-0.5 text-white disabled:opacity-40">Link</button>
              <button onClick={() => setMode("")} className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => { setMode("promote"); setInput1(e.normalizedText.slice(0, 80)); }} className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:border-emerald-400 dark:border-emerald-800 dark:text-emerald-400">Promote to Operations…</button>
              <button onClick={() => { setMode("link"); setInput1(""); }} className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:border-emerald-400 dark:border-emerald-800 dark:text-emerald-400">Link existing…</button>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-red-500">{error}</p>}
    </li>
  );
}
