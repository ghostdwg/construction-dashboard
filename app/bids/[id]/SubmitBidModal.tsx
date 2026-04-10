"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  bidId: number;
  onClose: () => void;
  onSubmitted: () => void;
};

export default function SubmitBidModal({ bidId, onClose, onSubmitted }: Props) {
  const router = useRouter();
  const [ourBidAmount, setOurBidAmount] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const amount = parseFloat(ourBidAmount.replace(/[,$]/g, ""));
    const res = await fetch(`/api/bids/${bidId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ourBidAmount: isNaN(amount) ? undefined : amount,
        submittedBy: submittedBy.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    });
    if (res.ok) {
      onSubmitted();
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">Submit Bid</h3>
          <p className="text-xs text-zinc-500 mt-1">
            This locks the current bid state and creates a snapshot of the brief, questions, compliance, and spread analysis.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Our Bid Amount</label>
          <input
            type="text"
            value={ourBidAmount}
            onChange={(e) => setOurBidAmount(e.target.value)}
            placeholder="e.g. 1,250,000"
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Submitted By</label>
          <input
            type="text"
            value={submittedBy}
            onChange={(e) => setSubmittedBy(e.target.value)}
            placeholder="Your name"
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Submission notes (optional)"
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-zinc-500 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Bid"}
          </button>
        </div>
      </div>
    </div>
  );
}
