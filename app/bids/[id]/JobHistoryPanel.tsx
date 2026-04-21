"use client";

// GWX-007 — Morning summary panel for durable background jobs.
// Reads from /api/bids/[id]/jobs — durable DB state only, no sidecar dependency.

import { useEffect, useState } from "react";

type JobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";
type TriggerSource = "user" | "automation" | "webhook";

interface JobRecord {
  id: string;
  jobType: string;
  status: JobStatus;
  triggerSource: string;
  inputSummary: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  externalJobId: string | null;
}

// ── Display helpers ──────────────────────────────────────────────────────────

const JOB_TYPE_LABELS: Record<string, string> = {
  spec_analysis: "Spec Analysis",
  drawing_analysis: "Drawing Analysis",
  meeting_transcription: "Meeting Transcription",
};

const TRIGGER_LABELS: Record<string, string> = {
  user: "User",
  automation: "Automation",
  webhook: "Webhook",
};

const STATUS_STYLES: Record<JobStatus, { badge: string; label: string }> = {
  complete: {
    badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    label: "Complete",
  },
  failed: {
    badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    label: "Failed",
  },
  running: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    label: "Running",
  },
  queued: {
    badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    label: "Queued",
  },
  cancelled: {
    badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    label: "Cancelled",
  },
};

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (isToday) return `Today ${formatTime(iso)}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + formatTime(iso);
}

// ── Row ──────────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: JobRecord }) {
  const style = STATUS_STYLES[job.status] ?? STATUS_STYLES.queued;
  const duration = formatDuration(job.startedAt, job.completedAt);
  const typeLabel = JOB_TYPE_LABELS[job.jobType] ?? job.jobType;
  const triggerLabel = TRIGGER_LABELS[job.triggerSource] ?? job.triggerSource;
  const summary = job.status === "failed" ? job.errorMessage : job.resultSummary;

  return (
    <div className="flex flex-col gap-1 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
          {style.label}
        </span>
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{typeLabel}</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">·</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{triggerLabel}</span>
        {duration && (
          <>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">·</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{duration}</span>
          </>
        )}
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
          {formatDate(job.createdAt)}
        </span>
      </div>
      {summary && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate pl-0.5">{summary}</p>
      )}
      {job.inputSummary && !summary && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate pl-0.5">{job.inputSummary}</p>
      )}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function JobHistoryPanel({ bidId }: { bidId: number }) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/jobs`)
      .then((r) => r.json())
      .then((data) => {
        setJobs(data.jobs ?? []);
        // Auto-open if there are recent failures or automation-triggered jobs
        const hasAttentionItem = (data.jobs ?? []).some(
          (j: JobRecord) => j.status === "failed" || j.triggerSource === "automation"
        );
        if (hasAttentionItem) setOpen(true);
      })
      .finally(() => setLoading(false));
  }, [bidId]);

  if (!loading && jobs.length === 0) return null;

  const failCount = jobs.filter((j) => j.status === "failed").length;
  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "running").length;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Background Jobs
          </span>
          {activeCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {activeCount} active
            </span>
          )}
          {failCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {failCount} failed
            </span>
          )}
          {!loading && activeCount === 0 && failCount === 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{jobs.length} recent</span>
          )}
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {loading ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 py-2">Loading…</p>
          ) : (
            jobs.map((job) => <JobRow key={job.id} job={job} />)
          )}
        </div>
      )}
    </div>
  );
}
