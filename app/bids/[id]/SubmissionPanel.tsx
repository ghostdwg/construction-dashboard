"use client";

import { useEffect, useState } from "react";
import OutcomeModal from "./OutcomeModal";

// ── Types ──────────────────────────────────────────────────────────────────

type Submission = {
  id: number;
  bidId: number;
  submittedAt: string;
  submittedBy: string | null;
  ourBidAmount: number | null;
  notes: string | null;
  briefSnapshot: string | null;
  questionSnapshot: string | null;
  complianceSnapshot: string | null;
  spreadSnapshot: string | null;
  intelligenceSnapshot: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  winningBidAmount: number | null;
  ourRank: number | null;
  totalBidders: number | null;
  lostReason: string | null;
  lostReasonNote: string | null;
  lessonsLearned: string | null;
};

type SnapshotData = {
  brief?: { hasContent: boolean; riskFlagCount: number; criticalRiskCount: number; assumptionCount: number };
  questions?: { total: number; criticalOpen: number; impactFlagged: number };
  compliance?: { total: number; checked: number; percentage: number };
  spread?: { tradesWithPricing: number; overallLow: number; overallHigh: number };
  intelligence?: { warningCount: number; cautionCount: number; infoCount: number };
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString();
}

function parseSnap<T>(s: string | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

const OUTCOME_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  won: { bg: "bg-green-100", text: "text-green-700", label: "Won" },
  lost: { bg: "bg-red-100", text: "text-red-700", label: "Lost" },
  withdrawn: { bg: "bg-zinc-100", text: "text-zinc-600", label: "Withdrawn" },
  no_decision: { bg: "bg-blue-100", text: "text-blue-700", label: "No Decision" },
};

// ── Main component ─────────────────────────────────────────────────────────

export default function SubmissionPanel({ bidId }: { bidId: number }) {
  const [submission, setSubmission] = useState<Submission | null | undefined>(undefined);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  // Refresh helper for mutation handlers (e.g. outcome saved)
  async function refresh() {
    try {
      const res = await fetch(`/api/bids/${bidId}/submission`);
      if (res.ok) {
        const data = await res.json();
        setSubmission(data.submission);
      } else {
        setSubmission(null);
      }
    } catch {
      setSubmission(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/submission`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setSubmission(data.submission);
        } else {
          setSubmission(null);
        }
      } catch {
        if (!cancelled) setSubmission(null);
      }
    })();
    return () => { cancelled = true; };
  }, [bidId]);

  if (submission === undefined) return <div className="h-12 rounded-md bg-zinc-100 animate-pulse dark:bg-zinc-800" />;
  if (!submission) return null;

  const brief = parseSnap<SnapshotData["brief"]>(submission.briefSnapshot);
  const questions = parseSnap<SnapshotData["questions"]>(submission.questionSnapshot);
  const compliance = parseSnap<SnapshotData["compliance"]>(submission.complianceSnapshot);
  const spread = parseSnap<SnapshotData["spread"]>(submission.spreadSnapshot);
  const intelligence = parseSnap<SnapshotData["intelligence"]>(submission.intelligenceSnapshot);

  const outcomeStyle = submission.outcome ? OUTCOME_STYLES[submission.outcome] : null;
  const bidGap = submission.ourBidAmount && submission.winningBidAmount
    ? submission.ourBidAmount - submission.winningBidAmount
    : null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Bid Submission</h2>

      <div className="rounded-md border border-zinc-200 bg-white p-4 flex flex-col gap-3 dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                Submitted {new Date(submission.submittedAt).toLocaleDateString()}
              </span>
              {outcomeStyle && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${outcomeStyle.bg} ${outcomeStyle.text}`}>
                  {outcomeStyle.label}
                </span>
              )}
            </div>
            {submission.submittedBy && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">By {submission.submittedBy}</span>
            )}
          </div>

          <div className="flex flex-col items-end gap-1">
            {submission.ourBidAmount != null && (
              <span className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                {fmtDollar(submission.ourBidAmount)}
              </span>
            )}
            <button
              onClick={() => setShowOutcomeModal(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              {submission.outcome ? "Edit outcome" : "Record outcome"}
            </button>
          </div>
        </div>

        {/* Outcome detail */}
        {submission.outcome === "lost" && submission.winningBidAmount && (
          <div className="rounded-md bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
            Winning bid: <span className="font-semibold">{fmtDollar(submission.winningBidAmount)}</span>
            {bidGap != null && bidGap > 0 && (
              <> — we were <span className="font-semibold">{fmtDollar(bidGap)}</span> higher</>
            )}
            {submission.ourRank && submission.totalBidders && (
              <> · Rank {submission.ourRank} of {submission.totalBidders}</>
            )}
            {submission.lostReason && (
              <> · Reason: <span className="capitalize">{submission.lostReason}</span></>
            )}
          </div>
        )}

        {submission.lessonsLearned && (
          <div className="rounded-md bg-zinc-50 border border-zinc-100 px-3 py-2 dark:bg-zinc-800 dark:border-zinc-800">
            <p className="text-xs font-medium text-zinc-600 mb-0.5 dark:text-zinc-300">Lessons learned</p>
            <p className="text-xs text-zinc-700 whitespace-pre-wrap dark:text-zinc-200">{submission.lessonsLearned}</p>
          </div>
        )}

        {submission.notes && (
          <p className="text-xs text-zinc-500 italic dark:text-zinc-400">{submission.notes}</p>
        )}

        {/* Snapshot toggle */}
        <button
          onClick={() => setSnapshotOpen(!snapshotOpen)}
          className="text-xs text-zinc-500 hover:text-zinc-700 self-start dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {snapshotOpen ? "▲ Hide snapshot" : "▼ Show submission snapshot"}
        </button>

        {snapshotOpen && (
          <div className="border-t border-zinc-100 pt-3 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs dark:border-zinc-800">
            {brief && (
              <div>
                <p className="font-medium text-zinc-600 mb-1 dark:text-zinc-300">Brief</p>
                <p className="text-zinc-500 dark:text-zinc-400">{brief.riskFlagCount} risk flags ({brief.criticalRiskCount} critical)</p>
                <p className="text-zinc-500 dark:text-zinc-400">{brief.assumptionCount} assumptions</p>
              </div>
            )}
            {questions && (
              <div>
                <p className="font-medium text-zinc-600 mb-1 dark:text-zinc-300">Questions</p>
                <p className="text-zinc-500 dark:text-zinc-400">{questions.total} total</p>
                <p className="text-zinc-500 dark:text-zinc-400">{questions.criticalOpen} critical open</p>
                {questions.impactFlagged > 0 && (
                  <p className="text-zinc-500 dark:text-zinc-400">{questions.impactFlagged} impact flagged</p>
                )}
              </div>
            )}
            {compliance && (
              <div>
                <p className="font-medium text-zinc-600 mb-1 dark:text-zinc-300">Compliance</p>
                <p className="text-zinc-500 dark:text-zinc-400">{compliance.checked}/{compliance.total} ({compliance.percentage}%)</p>
              </div>
            )}
            {spread && spread.tradesWithPricing > 0 && (
              <div>
                <p className="font-medium text-zinc-600 mb-1 dark:text-zinc-300">Spread</p>
                <p className="text-zinc-500 dark:text-zinc-400">{spread.tradesWithPricing} trades priced</p>
                <p className="text-zinc-500 dark:text-zinc-400">{fmtDollar(spread.overallLow)} – {fmtDollar(spread.overallHigh)}</p>
              </div>
            )}
            {intelligence && (
              <div>
                <p className="font-medium text-zinc-600 mb-1 dark:text-zinc-300">Intelligence</p>
                <p className="text-zinc-500 dark:text-zinc-400">{intelligence.warningCount} warnings</p>
                <p className="text-zinc-500 dark:text-zinc-400">{intelligence.cautionCount} cautions</p>
              </div>
            )}
          </div>
        )}
      </div>

      {showOutcomeModal && (
        <OutcomeModal
          bidId={bidId}
          submission={submission}
          onClose={() => setShowOutcomeModal(false)}
          onSaved={() => {
            setShowOutcomeModal(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
