"use client";

// Module R2-B1 — minutes publication & amendments (MeetingsTab section).
// Publishing freezes an immutable revision snapshot; it is gated on every
// extracted register entry being dispositioned (R2 rules 9 & 11). Prior
// revisions are permanent — an amendment appends the next revision with a
// required reason.

import { useCallback, useEffect, useState } from "react";

type RevisionRow = {
  id: number;
  revisionIndex: number;
  publishedBy: string;
  publishedAt: string;
  amendmentReason: string | null;
  supersedesRevisionId: number | null;
  contentJson: string;
};

type Coverage = {
  total: number;
  extracted: number;
  pendingExtracted: number;
  fullyReviewed: boolean;
};

type Snapshot = {
  title?: string;
  summary?: string;
  keyDecisions?: unknown[];
  openIssues?: unknown[];
  redFlags?: unknown[];
  participants?: unknown[];
  registerEntries?: Array<{ entryType?: string; reviewState?: string; normalizedText?: string }>;
  correctionCount?: number;
  analysisVersion?: number;
};

export default function MeetingMinutesPanel({
  bidId,
  meetingId,
  analyzedAt,
}: {
  bidId: number;
  meetingId: number;
  analyzedAt: string | null;
}) {
  const base = `/api/bids/${bidId}/meetings/${meetingId}`;
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amendReason, setAmendReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [revRes, covRes] = await Promise.all([
        fetch(`${base}/minutes`),
        fetch(`${base}/register/coverage`),
      ]);
      if (!revRes.ok) throw new Error(`Minutes load failed (${revRes.status})`);
      setRevisions(((await revRes.json()) as { revisions: RevisionRow[] }).revisions);
      if (covRes.ok) setCoverage(((await covRes.json()) as { coverage: Coverage }).coverage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, analyzedAt]);

  const hasRevisions = (revisions?.length ?? 0) > 0;
  const canPublish = coverage?.fullyReviewed ?? false;

  async function publish() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/minutes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hasRevisions ? { amendmentReason: amendReason.trim() } : {}),
    });
    const json = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Publish failed");
      return;
    }
    setAmendReason("");
    void load();
  }

  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Minutes
          {hasRevisions && (
            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              published · rev {revisions![0].revisionIndex}
            </span>
          )}
        </h4>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Publishing freezes an immutable snapshot of the analysis, participants and
          Meeting Register. Prior publications are never edited — amendments append a
          new revision with a reason.
        </p>
      </div>

      {coverage && !coverage.fullyReviewed && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {coverage.pendingExtracted} extracted register{" "}
          {coverage.pendingExtracted === 1 ? "entry" : "entries"} still need a
          disposition — the meeting cannot publish until every extracted entry is
          reviewed.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {hasRevisions && (
          <input
            value={amendReason}
            onChange={(e) => setAmendReason(e.target.value)}
            placeholder="amendment reason (required)"
            className="w-64 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        )}
        <button
          onClick={() => void publish()}
          disabled={busy || !canPublish || (hasRevisions && !amendReason.trim())}
          className="rounded bg-emerald-700 px-2 py-0.5 text-white disabled:opacity-40"
          title={!canPublish ? "Disposition all extracted register entries first" : undefined}
        >
          {hasRevisions ? "Publish amendment" : "Publish minutes"}
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {revisions !== null && revisions.length === 0 && (
        <p className="text-xs text-zinc-500">No published minutes yet.</p>
      )}

      <ul className="space-y-1">
        {(revisions ?? []).map((rev) => {
          let snap: Snapshot = {};
          try {
            snap = JSON.parse(rev.contentJson) as Snapshot;
          } catch { /* snapshot stays summarized */ }
          const isOpen = expanded === rev.id;
          return (
            <li key={rev.id} className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-800 dark:text-zinc-200">
                  <span className="font-semibold">Revision {rev.revisionIndex}</span>
                  {rev.revisionIndex === 0 ? " — original publication" : " — amendment"}
                  {rev.amendmentReason && `: “${rev.amendmentReason}”`}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {rev.publishedBy} · {new Date(rev.publishedAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-zinc-500">
                <span>{snap.registerEntries?.length ?? 0} register entries</span>
                <span>{Array.isArray(snap.keyDecisions) ? snap.keyDecisions.length : 0} decisions</span>
                <span>{snap.correctionCount ?? 0} transcript corrections at publish</span>
                <button
                  onClick={() => setExpanded(isOpen ? null : rev.id)}
                  className="underline decoration-dotted"
                >
                  {isOpen ? "hide snapshot" : "view snapshot"}
                </button>
              </div>
              {isOpen && (
                <div className="mt-1 space-y-1 border-l-2 border-zinc-200 pl-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                  {snap.summary && <p>{snap.summary}</p>}
                  {Array.isArray(snap.keyDecisions) && snap.keyDecisions.length > 0 && (
                    <div>
                      <p className="font-medium">Decisions</p>
                      <ul className="list-disc pl-4">
                        {snap.keyDecisions.map((d, i) => (
                          <li key={i}>{String(d)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(snap.registerEntries) && snap.registerEntries.length > 0 && (
                    <div>
                      <p className="font-medium">Register at publication</p>
                      <ul className="list-disc pl-4">
                        {snap.registerEntries.map((en, i) => (
                          <li key={i}>
                            [{en.entryType?.replaceAll("_", " ")}] {en.normalizedText}{" "}
                            <span className="text-zinc-400">({en.reviewState?.replaceAll("_", " ").toLowerCase()})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
