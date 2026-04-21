"use client";

// GWX-007 — GroundworX overnight jobs surface.
// Reads from /api/bids/[id]/jobs — durable DB state only, no sidecar dependency.
// Auto-opens when any job is failed or automation-triggered (morning review signal).

import { useEffect, useState } from "react";

type JobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

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
  spec_analysis:        "SPEC ANALYSIS",
  drawing_analysis:     "DRAWING ANALYSIS",
  meeting_transcription:"MEETING TRANSCRIPTION",
};

const TRIGGER_LABELS: Record<string, string> = {
  user:       "USER",
  automation: "AUTO",
  webhook:    "WEBHOOK",
};

// Left border accent colors per status — signal green is STATE only
const STATUS_META: Record<JobStatus, { border: string; chip: string; label: string }> = {
  complete: {
    border: "border-l-emerald-500",
    chip:   "text-emerald-700 dark:text-emerald-400",
    label:  "COMPLETE",
  },
  failed: {
    border: "border-l-red-500",
    chip:   "text-red-600 dark:text-red-400",
    label:  "FAILED",
  },
  running: {
    border: "border-l-blue-500",
    chip:   "text-blue-600 dark:text-blue-400",
    label:  "RUNNING",
  },
  queued: {
    border: "border-l-zinc-400",
    chip:   "text-zinc-500 dark:text-zinc-400",
    label:  "QUEUED",
  },
  cancelled: {
    border: "border-l-zinc-300",
    chip:   "text-zinc-400 dark:text-zinc-500",
    label:  "CANCELLED",
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

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

// ── Job row ──────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: JobRecord }) {
  const meta = STATUS_META[job.status] ?? STATUS_META.queued;
  const duration = formatDuration(job.startedAt, job.completedAt);
  const typeLabel = JOB_TYPE_LABELS[job.jobType] ?? job.jobType.toUpperCase();
  const triggerLabel = TRIGGER_LABELS[job.triggerSource] ?? job.triggerSource.toUpperCase();
  const detail = job.status === "failed" ? job.errorMessage : job.resultSummary;

  return (
    <div className={`border-l-2 pl-3 py-2 ${meta.border}`}>
      {/* Primary row */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-[10px] font-mono font-medium ${meta.chip}`}>
          {meta.label}
        </span>
        <span className="text-[11px] font-mono text-zinc-700 dark:text-zinc-200">
          {typeLabel}
        </span>
        <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
          {triggerLabel}
        </span>
        {duration && (
          <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
            {duration}
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
          {formatTimestamp(job.createdAt)}
        </span>
      </div>
      {/* Detail row */}
      {detail && (
        <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
          {detail}
        </p>
      )}
      {job.inputSummary && !detail && (
        <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
          {job.inputSummary}
        </p>
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
        const list: JobRecord[] = data.jobs ?? [];
        setJobs(list);
        // Auto-open on failures or automation-triggered runs (morning review signal)
        if (list.some((j) => j.status === "failed" || j.triggerSource === "automation")) {
          setOpen(true);
        }
      })
      .finally(() => setLoading(false));
  }, [bidId]);

  if (!loading && jobs.length === 0) return null;

  const failCount   = jobs.filter((j) => j.status === "failed").length;
  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "running").length;

  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-700">
      {/* Panel header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors rounded"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500 select-none">
            Background Jobs
          </span>
          {activeCount > 0 && (
            <span className="text-[9px] font-mono uppercase text-blue-600 dark:text-blue-400">
              {activeCount} active
            </span>
          )}
          {failCount > 0 && (
            <span className="text-[9px] font-mono uppercase text-red-600 dark:text-red-400">
              {failCount} failed
            </span>
          )}
          {!loading && activeCount === 0 && failCount === 0 && (
            <span className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500">
              {jobs.length}
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500 select-none">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-1 border-t border-zinc-100 dark:border-zinc-800 pt-2">
          {loading ? (
            <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 py-1">
              Loading…
            </p>
          ) : (
            jobs.map((job) => <JobRow key={job.id} job={job} />)
          )}
        </div>
      )}
    </div>
  );
}
