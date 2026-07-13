"use client";

// Module OPS5 — Design Log panel, mounted inside a meeting's detail view
// (MeetingsTab). Lists design intent changes the analysis proposed; a
// human confirms (optionally creating a Register Item) or dismisses each.
// Nothing here is automatic: PROPOSED is the extractor's ceiling, and the
// speaker attribution is a draft transcript label, never verified identity.

import { useCallback, useEffect, useState } from "react";

type DesignChangeRow = {
  id: number;
  changeText: string;
  priorIntent: string | null;
  affectedSpec: string | null;
  severity: string;
  sourceQuote: string | null;
  speakerLabel: string | null;
  state: string;
  confirmedBy: string | null;
  dismissedReason: string | null;
  linkedItem: { id: number; title: string; status: string } | null;
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  MAJOR: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  MINOR: "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
};

export default function MeetingDesignLog({
  bidId,
  meetingId,
  analyzedAt,
}: {
  bidId: number;
  meetingId: number;
  /** Re-fetches when a fresh analysis lands. */
  analyzedAt: string | null;
}) {
  const [rows, setRows] = useState<DesignChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/bids/${bidId}/meetings/${meetingId}/design-changes`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(base);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      setRows(((await res.json()) as { designChanges: DesignChangeRow[] }).designChanges);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, analyzedAt]);

  if (rows === null && !error) return null;
  if (rows !== null && rows.length === 0 && !error) return null; // no panel when nothing was ever proposed

  const proposed = (rows ?? []).filter((r) => r.state === "PROPOSED").length;

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Design Log
          {proposed > 0 && (
            <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              {proposed} awaiting review
            </span>
          )}
        </h4>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Design direction detected in this meeting — a change to the documented or
          previously approved design. Confirm or dismiss each; nothing is recorded
          without your review.
        </p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <ul className="space-y-1">
        {(rows ?? []).map((r) => (
          <DesignChangeCard key={r.id} bidId={bidId} meetingId={meetingId} row={r} onChanged={load} />
        ))}
      </ul>
    </section>
  );
}

function DesignChangeCard({
  bidId,
  meetingId,
  row: r,
  onChanged,
}: {
  bidId: number;
  meetingId: number;
  row: DesignChangeRow;
  onChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showQuote, setShowQuote] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [createItem, setCreateItem] = useState(false);
  const [title, setTitle] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const base = `/api/bids/${bidId}/meetings/${meetingId}/design-changes/${r.id}`;

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

  return (
    <li className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-zinc-800 dark:text-zinc-200">
            <span
              className={`mr-1 rounded px-1 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.MINOR}`}
            >
              {r.severity}
            </span>
            {r.changeText}
            {r.affectedSpec && (
              <span className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {r.affectedSpec}
              </span>
            )}
          </p>
          {r.priorIntent && (
            <p className="mt-0.5 text-[11px] text-zinc-500">was: {r.priorIntent}</p>
          )}
          {r.speakerLabel && (
            <p className="mt-0.5 text-[11px] text-zinc-400">
              directed by {r.speakerLabel}{" "}
              <span title="Draft transcript attribution — not verified identity">(draft)</span>
            </p>
          )}
          {r.sourceQuote && (
            <button
              onClick={() => setShowQuote((v) => !v)}
              className="mt-0.5 text-[11px] text-zinc-400 underline decoration-dotted"
            >
              {showQuote ? "hide quote" : "show quote"}
            </button>
          )}
          {showQuote && r.sourceQuote && (
            <p className="mt-0.5 border-l-2 border-zinc-300 pl-2 text-[11px] italic text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
              “{r.sourceQuote}”
            </p>
          )}
        </div>
        {r.state === "CONFIRMED" && (
          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
            Confirmed{r.confirmedBy ? ` — ${r.confirmedBy}` : ""}
            {r.linkedItem && ` · Item #${r.linkedItem.id}`}
          </span>
        )}
        {r.state === "DISMISSED" && (
          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            Dismissed — kept on record{r.dismissedReason ? ` (${r.dismissedReason})` : ""}
          </span>
        )}
      </div>

      {r.state === "PROPOSED" && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {confirming ? (
            <>
              <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                <input
                  type="checkbox"
                  checked={createItem}
                  onChange={(e) => {
                    setCreateItem(e.target.checked);
                    if (e.target.checked && !title) setTitle(r.changeText.slice(0, 80));
                  }}
                />
                also create Register Item
              </label>
              {createItem && (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="item title"
                  className="w-56 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              )}
              <button
                onClick={() =>
                  post(`${base}/confirm`, {
                    createItem,
                    ...(createItem ? { title } : {}),
                  }).then((ok) => ok && setConfirming(false))
                }
                disabled={createItem && !title.trim()}
                className="rounded bg-sky-700 px-2 py-0.5 text-white disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600"
              >
                Cancel
              </button>
            </>
          ) : dismissing ? (
            <>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="reason (optional)"
                className="w-44 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={() =>
                  post(`${base}/dismiss`, reason.trim() ? { reason: reason.trim() } : {}).then(
                    (ok) => ok && setDismissing(false)
                  )
                }
                className="rounded bg-zinc-600 px-2 py-0.5 text-white"
              >
                Confirm dismiss
              </button>
              <button
                onClick={() => setDismissing(false)}
                className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-600"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirming(true)}
                className="rounded border border-sky-300 px-2 py-0.5 text-sky-700 hover:border-sky-400 dark:border-sky-800 dark:text-sky-400"
              >
                Confirm…
              </button>
              <button
                onClick={() => setDismissing(true)}
                className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 hover:border-zinc-400 dark:border-zinc-600"
              >
                Dismiss…
              </button>
            </>
          )}
        </div>
      )}

      {r.state === "DISMISSED" && (
        <button
          onClick={() => post(`${base}/reinstate`)}
          className="mt-1 rounded border border-zinc-300 px-2 py-0.5 text-zinc-500 hover:border-zinc-400 dark:border-zinc-600"
        >
          Reinstate
        </button>
      )}

      {error && <p className="mt-1 text-red-500">{error}</p>}
    </li>
  );
}
