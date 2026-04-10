"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Submission = {
  id: number;
  outcome: string | null;
  winningBidAmount: number | null;
  ourRank: number | null;
  totalBidders: number | null;
  lostReason: string | null;
  lostReasonNote: string | null;
  lessonsLearned: string | null;
};

type Props = {
  bidId: number;
  submission: Submission;
  onClose: () => void;
  onSaved: () => void;
};

const OUTCOMES = [
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "no_decision", label: "No Decision Yet" },
];

const LOST_REASONS = [
  { value: "price", label: "Price" },
  { value: "scope", label: "Scope" },
  { value: "schedule", label: "Schedule" },
  { value: "relationship", label: "Relationship" },
  { value: "other", label: "Other" },
];

export default function OutcomeModal({ bidId, submission, onClose, onSaved }: Props) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(submission.outcome ?? "");
  const [winningBidAmount, setWinningBidAmount] = useState(
    submission.winningBidAmount?.toString() ?? ""
  );
  const [ourRank, setOurRank] = useState(submission.ourRank?.toString() ?? "");
  const [totalBidders, setTotalBidders] = useState(submission.totalBidders?.toString() ?? "");
  const [lostReason, setLostReason] = useState(submission.lostReason ?? "");
  const [lostReasonNote, setLostReasonNote] = useState(submission.lostReasonNote ?? "");
  const [lessonsLearned, setLessonsLearned] = useState(submission.lessonsLearned ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!outcome) {
      setError("Please select an outcome");
      return;
    }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      outcome,
      lessonsLearned: lessonsLearned.trim() || undefined,
    };

    if (outcome === "lost") {
      const wba = parseFloat(winningBidAmount.replace(/[,$]/g, ""));
      if (!isNaN(wba)) body.winningBidAmount = wba;
      const rank = parseInt(ourRank, 10);
      if (!isNaN(rank)) body.ourRank = rank;
      const total = parseInt(totalBidders, 10);
      if (!isNaN(total)) body.totalBidders = total;
      if (lostReason) body.lostReason = lostReason;
      if (lostReasonNote.trim()) body.lostReasonNote = lostReasonNote.trim();
    }

    const res = await fetch(`/api/bids/${bidId}/submission/outcome`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      onSaved();
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-zinc-900">
          {submission.outcome ? "Edit Outcome" : "Record Outcome"}
        </h3>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Outcome</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">— Select —</option>
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {outcome === "lost" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-700">Winning Bid Amount</label>
              <input
                type="text"
                value={winningBidAmount}
                onChange={(e) => setWinningBidAmount(e.target.value)}
                placeholder="e.g. 1,180,000"
                className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-700">Our Rank</label>
                <input
                  type="number"
                  value={ourRank}
                  onChange={(e) => setOurRank(e.target.value)}
                  placeholder="2"
                  min={1}
                  className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-700">Total Bidders</label>
                <input
                  type="number"
                  value={totalBidders}
                  onChange={(e) => setTotalBidders(e.target.value)}
                  placeholder="5"
                  min={1}
                  className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-700">Lost Reason</label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">— Select —</option>
                {LOST_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {lostReason && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-700">Reason Detail</label>
                <input
                  type="text"
                  value={lostReasonNote}
                  onChange={(e) => setLostReasonNote(e.target.value)}
                  placeholder="Additional context"
                  className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}
          </>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Lessons Learned</label>
          <textarea
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            rows={3}
            placeholder="What we learned from this bid"
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-zinc-500 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Outcome"}
          </button>
        </div>
      </div>
    </div>
  );
}
