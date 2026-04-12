"use client";

// Module H8 — Award Notification section on the Handoff tab
//
// Shows either a CTA to send notifications (if none sent yet) or a delivery
// status table (if already sent). The "Send Award Notifications" button opens
// the AwardNotificationModal.
//
// Only renders when the bid is in "awarded" status (parent gates this).

import { useEffect, useState } from "react";
import AwardNotificationModal from "./AwardNotificationModal";

type NotificationLog = {
  id: number;
  type: "sub" | "team";
  name: string;
  email: string;
  deliveryStatus: string | null;
  sentAt: string | null;
};

type NotificationStatus = {
  logs: NotificationLog[];
  sentAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  QUEUED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  SENT: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  OPENED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  BOUNCED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function AwardNotificationSection({
  bidId,
}: {
  bidId: number;
}) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/bids/${bidId}/notifications/award/status`
        );
        if (!res.ok) return;
        const data = (await res.json()) as NotificationStatus;
        if (cancelled) return;
        setStatus(data);
      } catch {
        // silently degrade — section just shows CTA
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bidId, reloadTick]);

  if (loading) return null;

  const hasSent = (status?.logs.length ?? 0) > 0;

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Award Notifications
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {hasSent
                ? `Sent ${status!.logs.length} notification(s) on ${new Date(status!.sentAt!).toLocaleDateString()}.`
                : "Notify awarded subs and your project team about this award."}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {hasSent ? "Send Again" : "Send Award Notifications"}
          </button>
        </div>

        {hasSent && status && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2">Recipient</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {status.logs.map((log) => {
                const badge =
                  STATUS_BADGE[log.deliveryStatus ?? "QUEUED"] ??
                  STATUS_BADGE.QUEUED;
                return (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-zinc-800 dark:text-zinc-100">
                      {log.name}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          log.type === "sub"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}
                      >
                        {log.type === "sub" ? "Sub" : "Team"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                      {log.email}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge}`}
                      >
                        {log.deliveryStatus ?? "QUEUED"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {log.sentAt
                        ? new Date(log.sentAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!hasSent && (
          <div className="px-5 py-4 text-sm text-zinc-500 dark:text-zinc-400">
            No notifications sent yet. Click the button above to preview
            recipients and send.
          </div>
        )}
      </section>

      {modalOpen && (
        <AwardNotificationModal
          bidId={bidId}
          onClose={() => setModalOpen(false)}
          onSent={() => setReloadTick((t) => t + 1)}
        />
      )}
    </>
  );
}
