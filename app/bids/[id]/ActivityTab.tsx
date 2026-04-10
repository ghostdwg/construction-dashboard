"use client";

import { useEffect, useState } from "react";

type OutreachLog = {
  id: number;
  channel: string | null;
  status: string;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  subcontractor: { company: string } | null;
  contact: { name: string; email: string | null } | null;
  question: { tradeName: string | null; questionText: string } | null;
};

const STATUS_LABELS: Record<string, string> = {
  exported: "Exported",
  sent: "Sent",
  responded: "Responded",
  declined: "Declined",
  needs_follow_up: "Needs Follow-up",
  queued: "Queued",
};

const CHANNEL_LABELS: Record<string, string> = {
  export: "Recipient Export",
  question: "Question",
};

function activityDate(log: OutreachLog): string {
  const d = log.respondedAt ?? log.sentAt ?? log.createdAt;
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function activityDescription(log: OutreachLog): string {
  const channel = CHANNEL_LABELS[log.channel ?? ""] ?? log.channel ?? "Action";
  const status = STATUS_LABELS[log.status] ?? log.status;
  return `${channel} — ${status}`;
}

export default function ActivityTab({ bidId }: { bidId: number }) {
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/outreach`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLogs(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [bidId]);

  if (loading) return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (logs.length === 0)
    return (
      <p className="text-sm text-zinc-400 dark:text-zinc-500">
        No outreach activity recorded for this bid yet.
      </p>
    );

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-zinc-200 dark:bg-zinc-700" />

      <ol className="space-y-6 pl-6">
        {logs.map((log) => (
          <li key={log.id} className="relative">
            {/* Dot */}
            <span className="absolute -left-6 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-zinc-400 ring-1 ring-zinc-200" />

            <div>
              <p className="text-xs text-zinc-400 mb-0.5 dark:text-zinc-500">{activityDate(log)}</p>
              <p className="text-sm font-medium">{activityDescription(log)}</p>
              {log.subcontractor && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {log.subcontractor.company}
                  {log.contact ? ` · ${log.contact.name}` : ""}
                </p>
              )}
              {log.question && (
                <p className="text-xs text-zinc-400 mt-0.5 italic line-clamp-1 dark:text-zinc-500">
                  {log.question.tradeName ? `[${log.question.tradeName}] ` : ""}
                  {log.question.questionText}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
