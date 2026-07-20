"use client";

// Module OPS7 — Commitments band, mounted inside a meeting's detail view
// (sibling of the Design Log panel). Lists verbal commitments the analysis
// proposed; a human confirms (optionally spawning a linked action item),
// dismisses, fulfills. Attribution is a draft transcript label — never
// verified identity. OVERDUE is derived server-side, never stored.

import { useCallback, useEffect, useState } from "react";

type CommitmentRow = {
  id: number;
  committedBy: string;
  speakerLabel: string | null;
  commitmentText: string;
  duePhrase: string | null;
  dueDate: string | null;
  sourceQuote: string | null;
  status: string;
  confirmedBy: string | null;
  fulfilledBy: string | null;
  dismissedReason: string | null;
  overdue: boolean;
  linkedActionItem: { id: number; description: string; status: string } | null;
};

export default function MeetingCommitments({
  bidId,
  meetingId,
  analyzedAt,
}: {
  bidId: number;
  meetingId: number;
  /** Re-fetches when a fresh analysis lands. */
  analyzedAt: string | null;
}) {
  const [rows, setRows] = useState<CommitmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/bids/${bidId}/meetings/${meetingId}/commitments`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(base);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      setRows(((await res.json()) as { commitments: CommitmentRow[] }).commitments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, analyzedAt]);

  if (rows === null && !error) return null;
  if (rows !== null && rows.length === 0 && !error) return null;

  const proposed = (rows ?? []).filter((r) => r.status === "PROPOSED").length;
  const overdue = (rows ?? []).filter((r) => r.overdue).length;

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Commitments
          {proposed > 0 && (
            <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              {proposed} awaiting review
            </span>
          )}
          {overdue > 0 && (
            <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {overdue} overdue
            </span>
          )}
        </h4>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Verbal commitments detected in this meeting — who said they&apos;d do what,
          by when. Confirm or dismiss each; nothing is tracked without your review.
        </p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <ul className="space-y-1">
        {(rows ?? []).map((r) => (
          <CommitmentCard key={r.id} bidId={bidId} meetingId={meetingId} row={r} onChanged={load} />
        ))}
      </ul>
    </section>
  );
}

function dueLabel(r: CommitmentRow): string | null {
  if (r.dueDate) return new Date(r.dueDate).toLocaleDateString();
  if (r.duePhrase) return `“${r.duePhrase}”`;
  return null;
}

function CommitmentCard({
  bidId,
  meetingId,
  row: r,
  onChanged,
}: {
  bidId: number;
  meetingId: number;
  row: CommitmentRow;
  onChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showQuote, setShowQuote] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [spawnItem, setSpawnItem] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const base = `/api/bids/${bidId}/meetings/${meetingId}/commitments/${r.id}`;

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

  const due = dueLabel(r);

  return (
    <li className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-zinc-800 dark:text-zinc-200">
            <span className="font-medium">{r.committedBy}</span>
            <span
              className="ml-1 text-zinc-400"
              title="Draft transcript attribution — not verified identity"
            >
              (draft)
            </span>
            : {r.commitmentText}
          </p>
          {due && (
            <p
              className={`mt-0.5 text-[11px] ${r.overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-500"}`}
            >
              due {due}
              {r.overdue && " — OVERDUE"}
            </p>
          )}
          {r.linkedActionItem && (
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Action item #{r.linkedActionItem.id} —{" "}
              {r.linkedActionItem.status.replaceAll("_", " ")}
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
        {r.status === "OPEN" && !r.overdue && (
          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
            Open{r.confirmedBy ? ` — ${r.confirmedBy}` : ""}
          </span>
        )}
        {r.status === "FULFILLED" && (
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Fulfilled{r.fulfilledBy ? ` — ${r.fulfilledBy}` : ""}
          </span>
        )}
        {r.status === "DISMISSED" && (
          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            Dismissed — kept on record{r.dismissedReason ? ` (${r.dismissedReason})` : ""}
          </span>
        )}
      </div>

      {r.status === "PROPOSED" && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {confirming ? (
            <>
              <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                <input
                  type="checkbox"
                  checked={spawnItem}
                  onChange={(e) => setSpawnItem(e.target.checked)}
                />
                also create action item
              </label>
              <button
                onClick={() =>
                  post(`${base}/confirm`, { spawnActionItem: spawnItem }).then(
                    (ok) => ok && setConfirming(false)
                  )
                }
                className="rounded bg-sky-700 px-2 py-0.5 text-white"
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

      {r.status === "OPEN" && (
        <button
          onClick={() => post(`${base}/fulfill`)}
          className="mt-1 rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:border-emerald-400 dark:border-emerald-800 dark:text-emerald-400"
        >
          Mark fulfilled
        </button>
      )}

      {r.status === "DISMISSED" && (
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
