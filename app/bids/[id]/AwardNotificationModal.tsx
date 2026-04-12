"use client";

// Module H8 — Award Notification modal
//
// Shows a preview of who will receive notifications (awarded subs + project
// team), lets the user add a custom message, and sends via the active email
// provider. Follows the same UX pattern as the RFQ send modal.

import { useEffect, useState } from "react";

type SubRecipient = {
  subcontractorId: number;
  company: string;
  email: string | null;
  trades: string[];
};

type TeamRecipient = {
  projectContactId: number;
  name: string;
  roleLabel: string;
  email: string | null;
};

type Preview = {
  subRecipients: SubRecipient[];
  teamRecipients: TeamRecipient[];
  estimatorDefaults: { name: string; email: string };
  emailConfigured: boolean;
  alreadySentCount: number;
};

type SendResult = {
  sent: Array<{ type: string; name: string; email: string }>;
  skipped: Array<{ type: string; name: string; reason: string }>;
  failed: Array<{ type: string; name: string; error: string }>;
};

export default function AwardNotificationModal({
  bidId,
  onClose,
  onSent,
}: {
  bidId: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [estName, setEstName] = useState("");
  const [estEmail, setEstEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [sendToSubs, setSendToSubs] = useState(true);
  const [sendToTeam, setSendToTeam] = useState(true);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/bids/${bidId}/notifications/award/preview`
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as Preview;
        if (cancelled) return;
        setPreview(data);
        setEstName(data.estimatorDefaults.name);
        setEstEmail(data.estimatorDefaults.email);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bidId]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/notifications/award/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estimatorName: estName,
            estimatorEmail: estEmail,
            customMessage: customMessage.trim() || undefined,
            sendToSubs,
            sendToTeam,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as SendResult;
      setResult(data);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const subsWithEmail = preview?.subRecipients.filter((s) => s.email) ?? [];
  const subsNoEmail = preview?.subRecipients.filter((s) => !s.email) ?? [];
  const teamWithEmail = preview?.teamRecipients.filter((t) => t.email) ?? [];
  const teamNoEmail = preview?.teamRecipients.filter((t) => !t.email) ?? [];

  const willSendCount =
    (sendToSubs ? subsWithEmail.length : 0) +
    (sendToTeam ? teamWithEmail.length : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Send Award Notifications
            </h2>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-700 text-lg dark:hover:text-zinc-200"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4">
          {loading && (
            <p className="text-sm text-zinc-500">Loading recipients…</p>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
              <p className="font-semibold">
                Sent {result.sent.length} notification(s).
              </p>
              {result.skipped.length > 0 && (
                <p className="mt-1">
                  Skipped {result.skipped.length}:{" "}
                  {result.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}
                </p>
              )}
              {result.failed.length > 0 && (
                <p className="mt-1 text-red-700 dark:text-red-300">
                  Failed {result.failed.length}:{" "}
                  {result.failed.map((f) => `${f.name} (${f.error})`).join(", ")}
                </p>
              )}
            </div>
          )}

          {preview && !result && (
            <>
              {preview.alreadySentCount > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  <strong>Heads up:</strong> {preview.alreadySentCount} notification(s) have already been sent for this bid. Sending again will create duplicate emails.
                </div>
              )}

              {!preview.emailConfigured && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
                  Email is not configured. Go to{" "}
                  <a href="/settings" className="underline">
                    /settings → Email
                  </a>{" "}
                  to set up your provider.
                </div>
              )}

              {/* Awarded Subs group */}
              <RecipientGroup
                title="Awarded Subcontractors"
                enabled={sendToSubs}
                onToggle={() => setSendToSubs(!sendToSubs)}
                withEmail={subsWithEmail.map((s) => ({
                  name: s.company,
                  detail: s.trades.join(", "),
                  email: s.email!,
                }))}
                noEmail={subsNoEmail.map((s) => ({
                  name: s.company,
                  detail: "no email on primary contact",
                }))}
              />

              {/* Project Team group */}
              <RecipientGroup
                title="Project Team"
                enabled={sendToTeam}
                onToggle={() => setSendToTeam(!sendToTeam)}
                withEmail={teamWithEmail.map((t) => ({
                  name: t.name,
                  detail: t.roleLabel,
                  email: t.email!,
                }))}
                noEmail={teamNoEmail.map((t) => ({
                  name: t.name,
                  detail: "no email",
                }))}
              />

              {/* Sender fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={estName}
                    onChange={(e) => setEstName(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
                    Reply-to Email
                  </label>
                  <input
                    type="email"
                    value={estEmail}
                    onChange={(e) => setEstEmail(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
              </div>

              {/* Custom message */}
              <div>
                <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
                  Custom Message (optional)
                </label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={3}
                  placeholder="Add a personal note to the notifications…"
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white px-6 py-3 border-t border-zinc-200 flex items-center justify-between dark:bg-zinc-900 dark:border-zinc-700">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={send}
              disabled={
                sending ||
                willSendCount === 0 ||
                !estName.trim() ||
                !estEmail.includes("@") ||
                !preview?.emailConfigured
              }
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending
                ? "Sending…"
                : `Send ${willSendCount} notification${willSendCount !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RecipientGroup({
  title,
  enabled,
  onToggle,
  withEmail,
  noEmail,
}: {
  title: string;
  enabled: boolean;
  onToggle: () => void;
  withEmail: Array<{ name: string; detail: string; email: string }>;
  noEmail: Array<{ name: string; detail: string }>;
}) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="rounded border-zinc-300 dark:border-zinc-600"
        />
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
          {withEmail.length} will receive · {noEmail.length} skipped (no email)
        </span>
      </div>
      {enabled && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {withEmail.map((r) => (
            <div
              key={r.email}
              className="flex items-center justify-between px-3 py-1.5"
            >
              <div>
                <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                  {r.name}
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-2">
                  {r.detail}
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                {r.email}
              </span>
            </div>
          ))}
          {noEmail.map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between px-3 py-1.5 opacity-50"
            >
              <div>
                <span className="text-xs text-zinc-600 dark:text-zinc-300 italic">
                  {r.name}
                </span>
                <span className="text-[10px] text-zinc-400 ml-2">
                  {r.detail}
                </span>
              </div>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                skip
              </span>
            </div>
          ))}
          {withEmail.length === 0 && noEmail.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500 italic dark:text-zinc-400">
              No recipients in this group.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
