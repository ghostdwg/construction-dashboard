import Link from "next/link";
import {
  loadMorningStrip,
  type JobSummary,
  type BidDueSoonSummary,
  type SubmittalDueSoonSummary,
} from "@/lib/services/portfolio/morningStrip";

// ──────────────────────────────────────────────────────────────────────────────
//  Morning Strip V0 — read-only summary strip above the Pursuits / Active
//  Projects launcher. Every number here is backed by an existing model field
//  and every row links to a real, already-existing page. Nothing here is
//  invented tracking, and completed-job info is phrased as an execution
//  fact ("job completed"), never as a claim that AI output is correct.
// ──────────────────────────────────────────────────────────────────────────────

const JOB_TYPE_LABELS: Record<string, string> = {
  spec_analysis: "Spec Analysis",
  drawing_analysis: "Drawing Analysis",
  meeting_transcription: "Meeting Transcription",
  brief_refresh: "Brief Refresh",
  submittal_generation: "Submittal Generation",
};

function jobLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType] ?? jobType;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const ACCENT = {
  red: { color: "#ff968f", solid: "var(--red)" },
  amber: { color: "#ffcc72", solid: "var(--amber)" },
  blue: { color: "#b8ceff", solid: "var(--blue)" },
} as const;

function TileShell({
  label,
  count,
  accent,
  children,
}: {
  label: string;
  count: number;
  accent: keyof typeof ACCENT;
  children?: React.ReactNode;
}) {
  const { color, solid } = ACCENT[accent];
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius)] border px-4 py-4 flex-1 min-w-[220px]"
      style={{
        borderColor: "var(--line)",
        background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))",
        boxShadow: "var(--shadow)",
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: solid }} />
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.09em]" style={{ color: "var(--text-dim)" }}>
          {label}
        </p>
        <p className="text-[26px] font-[800] tracking-[-0.04em] leading-none" style={{ color }}>
          {count}
        </p>
      </div>
      {children}
    </div>
  );
}

function JobRows({ items, total }: { items: JobSummary[]; total: number }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {items.map((job) => (
        <Link
          key={job.id}
          href={`/bids/${job.bidId}`}
          className="block text-[11px] leading-tight hover:text-emerald-400 transition-colors"
          style={{ color: "var(--text-soft)" }}
        >
          {job.bidProjectName}
          <span style={{ color: "var(--text-dim)" }}> · {jobLabel(job.jobType)}</span>
        </Link>
      ))}
      {total > items.length && (
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
          +{total - items.length} more
        </p>
      )}
    </div>
  );
}

function BidRows({ items, total }: { items: BidDueSoonSummary[]; total: number }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {items.map((bid) => (
        <Link
          key={bid.id}
          href={`/bids/${bid.id}`}
          className="block text-[11px] leading-tight hover:text-emerald-400 transition-colors"
          style={{ color: "var(--text-soft)" }}
        >
          {bid.projectName}
          <span style={{ color: "var(--text-dim)" }}> · due {fmtDate(bid.dueDate)}</span>
        </Link>
      ))}
      {total > items.length && (
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
          +{total - items.length} more
        </p>
      )}
    </div>
  );
}

function SubmittalRows({ items, total }: { items: SubmittalDueSoonSummary[]; total: number }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/bids/${item.bidId}?tab=submittals`}
          className="block text-[11px] leading-tight hover:text-emerald-400 transition-colors"
          style={{ color: "var(--text-soft)" }}
        >
          {item.bidProjectName}
          <span style={{ color: "var(--text-dim)" }}> · {item.title} due {fmtDate(item.submitByDate)}</span>
        </Link>
      ))}
      {total > items.length && (
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
          +{total - items.length} more
        </p>
      )}
    </div>
  );
}

export default async function MorningStrip() {
  const data = await loadMorningStrip();
  const { failedJobs, completedJobs, bidsDueSoon, submittalsDueSoon, windowDays, isQuiet } = data;

  return (
    <div className="px-6 pt-6 pb-2">
      <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-3" style={{ color: "var(--text-dim)" }}>
        Morning Strip
      </p>

      {isQuiet ? (
        <div
          className="rounded-[var(--radius)] border px-4 py-5"
          style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.02)" }}
        >
          <p className="text-sm font-[600]" style={{ color: "var(--text)" }}>
            Nothing needs you right now.
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
            No failed jobs in the last 24h, no bids due within {windowDays} days, no open submittals due within {windowDays} days.
          </p>
          {completedJobs.total > 0 && (
            <p className="text-[11px] mt-2" style={{ color: "var(--text-soft)" }}>
              {completedJobs.total} job{completedJobs.total === 1 ? "" : "s"} completed in the last 24h.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {failedJobs.total > 0 && (
            <TileShell label="Overnight · Failed Jobs" count={failedJobs.total} accent="red">
              <JobRows items={failedJobs.items} total={failedJobs.total} />
            </TileShell>
          )}
          {bidsDueSoon.total > 0 && (
            <TileShell label={`Today · Bids Due (${windowDays}d)`} count={bidsDueSoon.total} accent="amber">
              <BidRows items={bidsDueSoon.items} total={bidsDueSoon.total} />
            </TileShell>
          )}
          {submittalsDueSoon.total > 0 && (
            <TileShell label={`Today · Submittals Due (${windowDays}d)`} count={submittalsDueSoon.total} accent="blue">
              <SubmittalRows items={submittalsDueSoon.items} total={submittalsDueSoon.total} />
            </TileShell>
          )}
        </div>
      )}

      {!isQuiet && completedJobs.total > 0 && (
        <p className="text-[11px] mt-3" style={{ color: "var(--text-dim)" }}>
          Also: {completedJobs.total} job{completedJobs.total === 1 ? "" : "s"} completed in the last 24h.
        </p>
      )}
    </div>
  );
}
