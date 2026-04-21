"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type RfqSendCandidate = {
  subcontractorId: number;
  company: string;
  email: string | null;
  trades: string[];
};

type SendResult = {
  sent: Array<{ subId: number; subName: string; email: string; messageId: string }>;
  skipped: Array<{ subId: number; subName: string; reason: string }>;
  failed: Array<{ subId: number; subName: string; error: string }>;
};

type Props = {
  bidId: number;
  candidates: RfqSendCandidate[];
  defaultEstimatorName: string;
  defaultEstimatorEmail: string;
  onClose: () => void;
  onSent: (result: SendResult) => void;
};

// localStorage keys for "remember last used"
const LS_NAME = "construction-dashboard-estimator-name";
const LS_EMAIL = "construction-dashboard-estimator-email";

export default function RfqSendModal({
  bidId,
  candidates,
  defaultEstimatorName,
  defaultEstimatorEmail,
  onClose,
  onSent,
}: Props) {
  const [estimatorName, setEstimatorName] = useState(defaultEstimatorName);
  const [estimatorEmail, setEstimatorEmail] = useState(defaultEstimatorEmail);
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount, but only if no env-driven default exists
  useEffect(() => {
    if (!defaultEstimatorName) {
      const stored = window.localStorage.getItem(LS_NAME);
      if (stored) setEstimatorName(stored);
    }
    if (!defaultEstimatorEmail) {
      const stored = window.localStorage.getItem(LS_EMAIL);
      if (stored) setEstimatorEmail(stored);
    }
  }, [defaultEstimatorName, defaultEstimatorEmail]);

  const withEmail = candidates.filter((c) => c.email && c.email.includes("@"));
  const withoutEmail = candidates.filter((c) => !c.email || !c.email.includes("@"));

  const canSend =
    withEmail.length > 0 &&
    estimatorName.trim().length > 0 &&
    estimatorEmail.trim().includes("@") &&
    !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    // Persist for next time
    try {
      window.localStorage.setItem(LS_NAME, estimatorName.trim());
      window.localStorage.setItem(LS_EMAIL, estimatorEmail.trim());
    } catch {
      // ignore
    }

    try {
      const res = await fetch(`/api/bids/${bidId}/rfq/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subIds: candidates.map((c) => c.subcontractorId),
          customMessage: customMessage.trim() || undefined,
          estimatorName: estimatorName.trim(),
          estimatorEmail: estimatorEmail.trim(),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const result = (await res.json()) as SendResult;
      onSent(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-zinc-200 dark:border-zinc-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Send RFQ Invitations
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {candidates.length} subcontractor{candidates.length === 1 ? "" : "s"} selected
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Recipient list */}
          <section>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 dark:text-zinc-400">
              Recipients
            </p>
            <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {withEmail.map((c) => (
                <div
                  key={c.subcontractorId}
                  className="px-3 py-2 border-b border-zinc-100 last:border-0 dark:border-zinc-800 flex justify-between items-center"
                >
                  <div>
                    <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {c.company}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {c.email}
                    </div>
                    {c.trades.length > 0 && (
                      <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                        {c.trades.join(" · ")}
                      </div>
                    )}
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    Will send
                  </span>
                </div>
              ))}
              {withoutEmail.map((c) => (
                <div
                  key={c.subcontractorId}
                  className="px-3 py-2 border-b border-zinc-100 last:border-0 dark:border-zinc-800 flex justify-between items-center bg-amber-50 dark:bg-amber-900/20"
                >
                  <div>
                    <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {c.company}
                    </div>
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      No email on primary contact
                    </div>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    Skip
                  </span>
                </div>
              ))}
            </div>
            {withoutEmail.length > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {withoutEmail.length} sub
                {withoutEmail.length === 1 ? "" : "s"} will be skipped — add an email
                to their primary contact and try again.
              </p>
            )}
          </section>

          {/* Estimator info */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide block mb-1 dark:text-zinc-400">
                Your Name
              </label>
              <input
                type="text"
                value={estimatorName}
                onChange={(e) => setEstimatorName(e.target.value)}
                disabled={sending}
                className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100 disabled:opacity-50"
                placeholder="Jane Estimator"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide block mb-1 dark:text-zinc-400">
                Reply-to Email
              </label>
              <input
                type="email"
                value={estimatorEmail}
                onChange={(e) => setEstimatorEmail(e.target.value)}
                disabled={sending}
                className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100 disabled:opacity-50"
                placeholder="jane@yourcompany.com"
              />
            </div>
          </section>

          {/* Custom message */}
          <section>
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide block mb-1 dark:text-zinc-400">
              Custom Message <span className="font-normal normal-case text-zinc-400 dark:text-zinc-500">(optional, appears in email)</span>
            </label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              disabled={sending}
              rows={3}
              className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100 disabled:opacity-50 resize-none"
              placeholder="Optional note to include in this batch of invitations..."
            />
          </section>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-5 py-3 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={sending}
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending
              ? "Sending…"
              : `Send ${withEmail.length} invitation${withEmail.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
