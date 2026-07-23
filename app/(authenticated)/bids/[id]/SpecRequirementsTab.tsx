"use client";

import { useCallback, useEffect, useState } from "react";

type Candidate = {
  id: number;
  requirementType: string;
  draftTitle: string;
  draftText: string;
  reviewState: string;
  evidenceExcerpt: string;
  sourceLocator: string;
  effectiveSet: { versionNumber: number; status: string };
  citation: {
    id: number;
    textSha256: string;
    citationVerified: boolean;
    specParagraph: {
      paragraphLabel: string;
      pageNumber: number | null;
    } | null;
    sectionEvidenceRevision: {
      specSection: { csiNumber: string; csiTitle: string };
    };
  };
  decisions: Array<{
    id: number;
    decision: string;
    reason: string | null;
    decidedBy: string;
    decidedAt: string;
  }>;
};

export default function SpecRequirementsTab({ bidId }: { bidId: number }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/bids/${bidId}/spec-evidence/requirements`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { candidates: Candidate[] };
    setCandidates(body.candidates);
  }, [bidId]);

  useEffect(() => {
    load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [load]);

  async function extractDrafts() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/bids/${bidId}/spec-evidence/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function decide(candidateId: number, decision: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/bids/${bidId}/spec-evidence/requirements/${candidateId}/decisions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!candidates && !error) {
    return <p className="text-sm text-zinc-500">Loading requirement candidates…</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Draft requirement candidates</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Human decisions append history. This foundation never creates operational records.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={extractDrafts}
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Extract drafts from stored analysis
        </button>
      </header>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {candidates?.length === 0 ? (
        <section className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No candidates. Publish an effective set, then extract drafts from already stored section analysis.
        </section>
      ) : (
        <div className="space-y-4">
          {candidates?.map((candidate) => (
            <article key={candidate.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-wide text-blue-600">
                    {candidate.requirementType} · {candidate.reviewState}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold">{candidate.draftTitle}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["ACCEPT", "Accept"],
                    ["REJECT", "Reject"],
                    ["RETURN_FOR_EDIT", "Return"],
                    ["VOID", "Void"],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      disabled={busy}
                      key={value}
                      onClick={() => decide(candidate.id, value)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-600"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-200">{candidate.draftText}</p>
              <aside className="mt-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <p className="text-xs font-medium">{candidate.sourceLocator}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-300">
                  {candidate.evidenceExcerpt}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                  <span>SHA {candidate.citation.textSha256.slice(0, 12)}</span>
                  <span>{candidate.citation.citationVerified ? "Human verified" : "Not yet verified"}</span>
                  <a
                    href={`/api/bids/${bidId}/spec-evidence/citations/${candidate.citation.id}/source`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    Open cited source
                  </a>
                </div>
              </aside>
              {candidate.decisions.length > 0 && (
                <ol className="mt-3 space-y-1 text-xs text-zinc-500">
                  {candidate.decisions.map((decision) => (
                    <li key={decision.id}>
                      {decision.decision} · {new Date(decision.decidedAt).toLocaleString()} ·{" "}
                      {decision.decidedBy}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
