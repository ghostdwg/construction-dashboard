"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, AlertTriangle, Clock } from "lucide-react";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type ActionStatus = "OPEN" | "IN_PROGRESS";

type ActionItem = {
  id: number;
  meetingId: number;
  meetingTitle: string;
  meetingType: string;
  meetingDate: string;
  description: string;
  assignedToName: string | null;
  dueDate: string | null;
  priority: Priority;
  status: ActionStatus;
  notes: string | null;
};

const PRIORITY_DOT: Record<Priority, string> = {
  CRITICAL: "bg-red-500",
  HIGH:     "bg-orange-400",
  MEDIUM:   "bg-amber-400",
  LOW:      "bg-zinc-300 dark:bg-zinc-600",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  CRITICAL: "Critical",
  HIGH:     "High",
  MEDIUM:   "Medium",
  LOW:      "Low",
};

const MEETING_TYPE_SHORT: Record<string, string> = {
  OAC:            "OAC",
  SUBCONTRACTOR:  "Sub",
  PRECONSTRUCTION:"Pre-Con",
  SAFETY:         "Safety",
  KICKOFF:        "Kickoff",
  GENERAL:        "Meeting",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(dueDateIso: string | null): boolean {
  if (!dueDateIso) return false;
  return new Date(dueDateIso) < new Date();
}

export default function MeetingActionsPanel({ bidId }: { bidId: number }) {
  const router = useRouter();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closing, setClosing] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/action-items`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setItems(data.actionItems);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load meeting action items");
    } finally {
      setLoading(false);
    }
  }, [bidId]);

  useEffect(() => { load(); }, [load]);

  async function markDone(item: ActionItem) {
    setClosing((s) => new Set(s).add(item.id));
    setActionError(null);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/meetings/${item.meetingId}/action-items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CLOSED" }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setItems((prev) => prev.filter((a) => a.id !== item.id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to mark action item done");
    } finally {
      setClosing((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }

  // Don't render the panel at all when there are no open items (and not loading)
  if (!loading && !loadError && items.length === 0) return null;

  const criticalOrHigh = items.filter(
    (a) => a.priority === "CRITICAL" || a.priority === "HIGH"
  );
  const overdue = items.filter((a) => isOverdue(a.dueDate));

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Open Action Items
          </h2>
          <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {loading ? "…" : items.length}
          </span>
          {!loading && overdue.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="h-3 w-3" />
              {overdue.length} overdue
            </span>
          )}
          {!loading && criticalOrHigh.length > 0 && overdue.length === 0 && (
            <span className="rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
              {criticalOrHigh.length} high priority
            </span>
          )}
        </div>
        <button
          onClick={() => router.replace(`/bids/${bidId}?tab=meetings`)}
          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          View in Meetings →
        </button>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-md bg-zinc-100 animate-pulse dark:bg-zinc-800" />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3 dark:border-red-900/60 dark:bg-red-900/20">
          <div className="min-w-0">
            <p className="text-sm text-red-700 dark:text-red-300">
              Failed to load meeting action items.
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 truncate">
              {loadError}
            </p>
          </div>
          <button
            onClick={load}
            className="shrink-0 rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-900/20"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          {items.map((item) => {
            const overdueDue = isOverdue(item.dueDate);
            const isCritical = item.priority === "CRITICAL";
            const busy = closing.has(item.id);
            return (
              <div
                key={item.id}
                className={`flex items-start gap-3 px-4 py-3 bg-white dark:bg-zinc-900 ${
                  isCritical ? "border-l-2 border-red-400" : ""
                }`}
              >
                {/* Priority dot */}
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[item.priority]}`}
                  title={PRIORITY_LABEL[item.priority]}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-snug">
                    {item.description}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.assignedToName && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        → {item.assignedToName}
                      </span>
                    )}
                    {item.dueDate && (
                      <span
                        className={`flex items-center gap-0.5 text-xs ${
                          overdueDue
                            ? "text-red-600 dark:text-red-400 font-medium"
                            : "text-zinc-400 dark:text-zinc-500"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {overdueDue ? "Overdue · " : ""}
                        {fmtDate(item.dueDate)}
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {MEETING_TYPE_SHORT[item.meetingType] ?? "Meeting"} ·{" "}
                      {fmtDate(item.meetingDate)}
                    </span>
                    {item.status === "IN_PROGRESS" && (
                      <span className="text-xs rounded-full px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        In Progress
                      </span>
                    )}
                  </div>
                </div>

                {/* Mark done */}
                <button
                  onClick={() => markDone(item)}
                  disabled={busy}
                  title="Mark as closed"
                  className="shrink-0 mt-0.5 text-xs px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40 transition-colors"
                >
                  {busy ? "…" : "Done"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
