import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";

// ── Job type display metadata ─────────────────────────────────────────────────
const JOB_META: Record<string, { label: string; owner: string }> = {
  spec_analysis:         { label: "Spec Analysis",          owner: "sidecar"    },
  drawing_analysis:      { label: "Drawing Analysis",       owner: "sidecar"    },
  meeting_transcription: { label: "Meeting Transcription",  owner: "assemblyai" },
};

// ── State chip styles ─────────────────────────────────────────────────────────
type JobStatus = "complete" | "running" | "queued" | "failed" | "cancelled";
const JOB_CHIP: Record<JobStatus, { label: string; color: string; bg: string; border: string; dot?: true }> = {
  complete:  { label: "COMPLETE",  color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",  border: "rgba(126,167,255,0.2)"   },
  running:   { label: "RUNNING",   color: "var(--signal-soft)", bg: "var(--signal-dim)",      border: "rgba(0,255,100,0.22)",   dot: true },
  queued:    { label: "QUEUED",    color: "#ffcc72",            bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)"    },
  failed:    { label: "BLOCKED",   color: "#ff968f",            bg: "var(--red-dim)",         border: "rgba(232,69,60,0.22)"    },
  cancelled: { label: "CANCELLED", color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)"   },
};

// ── Priority queue level styles ───────────────────────────────────────────────
type QueueLevel = "blocked" | "review" | "live";
const QUEUE_CHIP: Record<QueueLevel, { label: string; color: string; bg: string; border: string }> = {
  blocked: { label: "BLOCKED", color: "#ff968f",            bg: "var(--red-dim)",    border: "rgba(232,69,60,0.22)"  },
  review:  { label: "REVIEW",  color: "#ffcc72",            bg: "var(--amber-dim)",  border: "rgba(245,166,35,0.2)"  },
  live:    { label: "LIVE",    color: "var(--signal-soft)", bg: "var(--signal-dim)", border: "rgba(0,255,100,0.22)"  },
};

type QueueItem = {
  id: string;
  label: string;
  meta: string;
  level: QueueLevel;
  href: string;
  provenance: string;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StateChip({ status }: { status: string }) {
  const chip = JOB_CHIP[status as JobStatus] ?? JOB_CHIP.queued;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] whitespace-nowrap"
      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
    >
      {chip.dot && (
        <span className="gwx-live-dot" style={{ width: 6, height: 6 }} />
      )}
      {chip.label}
    </span>
  );
}

function QueueChip({ level }: { level: QueueLevel }) {
  const chip = QUEUE_CHIP[level];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] whitespace-nowrap"
      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
    >
      {chip.label}
    </span>
  );
}

function MetricCard({
  label, value, sub, accent,
}: {
  label: string; value: string | number; sub: string;
  accent: "signal" | "amber" | "red" | "blue";
}) {
  const accentColor = {
    signal: "var(--signal)", amber: "var(--amber)", red: "var(--red)", blue: "var(--blue)",
  }[accent];
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--line)] px-4 py-4"
      style={{ background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))", boxShadow: "var(--shadow)" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: accentColor }} />
      <p className="font-mono text-[10px] uppercase tracking-[0.09em] mb-2" style={{ color: "var(--text-dim)" }}>{label}</p>
      <p className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>{value}</p>
      <p className="text-xs mt-2" style={{ color: "var(--text-soft)" }}>{sub}</p>
    </div>
  );
}

function PanelHead({ title, sub, right }: { title: string; sub: string; right?: string }) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-[var(--line)]"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div>
        <p className="text-sm font-[700] tracking-[-0.02em]">{title}</p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>{sub}</p>
      </div>
      {right && (
        <span className="font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
          {right}
        </span>
      )}
    </div>
  );
}

function RailCard({ children, featured = false }: { children: React.ReactNode; featured?: boolean }) {
  return (
    <div
      className="border rounded-[var(--radius)] overflow-hidden"
      style={{
        borderColor: featured ? "rgba(0,255,100,0.18)" : "var(--line)",
        background: featured
          ? "linear-gradient(180deg,rgba(0,255,100,0.045),rgba(18,22,29,0.98) 28%),linear-gradient(180deg,rgba(18,22,29,0.98),rgba(13,16,22,1))"
          : "linear-gradient(180deg,rgba(18,22,29,0.98),rgba(13,16,22,1))",
      }}
    >
      {children}
    </div>
  );
}

// ── Ledger table headers ──────────────────────────────────────────────────────
function TableHead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((col, i) => (
          <th
            key={i}
            className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)] font-[500]"
            style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
          >
            {col}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const STATUS_SORT: Record<string, number> = {
  running: 0, failed: 1, queued: 2, complete: 3, cancelled: 4,
};
const QUEUE_SORT: Record<QueueLevel, number> = { blocked: 0, review: 1, live: 2 };

export default async function HomePage() {
  const now       = new Date();
  const since12h  = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const since24h  = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since48h  = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    recentJobs,
    staleBriefs,
    overdueSubmittals,
    criticalQuestions,
    overdueActionItems,
    pendingAddendums,
    pendingGapFindings,
    tokenSpend,
    totalSubmittalsOpen,
    totalOpenActionItems,
    providerKey,
    activeBrief,
    calSubmittals,
    calActionItems,
    calMeetings,
    procurementBlocked,
    procurementAtRisk,
  ] = await Promise.all([
    // Background jobs: active + last 48h completed
    prisma.backgroundJob.findMany({
      where: {
        OR: [
          { status: { in: ["queued", "running"] } },
          { createdAt: { gte: since48h } },
        ],
      },
      include: { bid: { select: { id: true, projectName: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),

    // Stale intelligence briefs
    prisma.bidIntelligenceBrief.findMany({
      where: { isStale: true },
      include: { bid: { select: { id: true, projectName: true } } },
      take: 5,
    }),

    // Submittals past submit-by date and still open
    prisma.submittalItem.findMany({
      where: {
        status: { in: ["PENDING", "REQUESTED"] },
        submitByDate: { not: null, lt: now },
      },
      include: { bid: { select: { id: true, projectName: true } } },
      orderBy: { submitByDate: "asc" },
      take: 5,
    }),

    // Open critical / high questions
    prisma.generatedQuestion.findMany({
      where: {
        status: { in: ["OPEN", "SENT"] },
        priority: { in: ["CRITICAL", "HIGH"] },
      },
      include: { bid: { select: { id: true, projectName: true } } },
      take: 5,
    }),

    // Overdue or high-priority meeting action items
    prisma.meetingActionItem.findMany({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS"] },
        OR: [
          { priority: { in: ["CRITICAL", "HIGH"] } },
          { dueDate: { not: null, lt: now } },
        ],
      },
      include: {
        bid: { select: { id: true, projectName: true } },
        meeting: { select: { title: true } },
      },
      take: 5,
    }),

    // Addendums with AI delta ready (candidates for review)
    prisma.addendumUpload.findMany({
      where: { deltaJson: { not: null } },
      include: { bid: { select: { id: true, projectName: true } } },
      orderBy: { deltaGeneratedAt: "desc" },
      take: 4,
    }),

    // High/critical scope gap findings pending review
    prisma.aiGapFinding.findMany({
      where: {
        status: "pending_review",
        severity: { in: ["high", "critical"] },
      },
      include: { bid: { select: { id: true, projectName: true } } },
      take: 4,
    }),

    // Token spend last 12h
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: since12h } },
      _sum: { costUsd: true },
    }),

    // Cross-project open submittal count
    prisma.submittalItem.count({
      where: { status: { in: ["PENDING", "REQUESTED", "RECEIVED", "UNDER_REVIEW"] } },
    }),

    // Cross-project open action item count
    prisma.meetingActionItem.count({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),

    // AI provider configured — checks DB first, falls back to ANTHROPIC_API_KEY env var
    getSetting("ANTHROPIC_API_KEY"),

    // Active project intelligence brief for Glint rail
    prisma.bidIntelligenceBrief.findFirst({
      where: {
        bid: { OR: [{ workflowType: "PROJECT" }, { status: "awarded" }] },
        status: "ready",
        isStale: false,
      },
      orderBy: { generatedAt: "desc" },
      include: { bid: { select: { id: true, projectName: true, location: true } } },
    }),

    // 7-day strip — submittals due by end of week
    prisma.submittalItem.findMany({
      where: { status: { notIn: ["APPROVED", "APPROVED_AS_NOTED"] }, submitByDate: { lte: weekEnd } },
      select: { submitByDate: true },
    }),

    // 7-day strip — action items due by end of week
    prisma.meetingActionItem.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { not: null, lte: weekEnd } },
      select: { dueDate: true },
    }),

    // 7-day strip — meetings this week
    prisma.meeting.findMany({
      where: { meetingDate: { gte: weekStart, lte: weekEnd } },
      select: { meetingDate: true },
    }),

    // Procurement — blocked packages (submitByDate passed, items still open)
    prisma.submittalPackage.count({ where: { riskStatus: "BLOCKED" } }),

    // Procurement — at-risk packages
    prisma.submittalPackage.count({ where: { riskStatus: "AT_RISK" } }),
  ]);

  // ── Sidecar health (non-blocking, short timeout) ──────────────────────────
  const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
  const sidecarOnline = await fetch(`${SIDECAR_URL}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(1500),
  }).then(r => r.ok).catch(() => false);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const sortedJobs = [...recentJobs].sort(
    (a, b) => (STATUS_SORT[a.status] ?? 5) - (STATUS_SORT[b.status] ?? 5),
  );

  const runningJobs    = recentJobs.filter(j => ["queued", "running"].includes(j.status));
  const failedJobs     = recentJobs.filter(j => j.status === "failed");
  const completedNight = recentJobs.filter(
    j => j.status === "complete" && j.completedAt && j.completedAt >= since24h,
  );
  const reviewRequired = failedJobs.length + staleBriefs.length + pendingGapFindings.length;
  const blockedCount   = failedJobs.length + overdueSubmittals.length;
  const tokenTotal     = tokenSpend._sum.costUsd ?? 0;

  const lastSyncJob = [...recentJobs]
    .filter(j => j.completedAt)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
  const lastSyncStr = lastSyncJob?.completedAt
    ? lastSyncJob.completedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "—";
  const nowStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  // ── 7-day calendar buckets ────────────────────────────────────────────────
  const calDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 86_400_000);
    return {
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: d.getDate(),
      submittals: 0,
      actionItems: 0,
      meetings: 0,
      isToday: i === 0,
    };
  });
  const calOverdue = { submittals: 0, actionItems: 0 };

  for (const s of calSubmittals) {
    if (!s.submitByDate) continue;
    const d = new Date(s.submitByDate); d.setHours(0, 0, 0, 0);
    const idx = Math.round((d.getTime() - weekStart.getTime()) / 86_400_000);
    if (idx < 0) calOverdue.submittals++; else if (idx < 7) calDays[idx].submittals++;
  }
  for (const ai of calActionItems) {
    if (!ai.dueDate) continue;
    const d = new Date(ai.dueDate); d.setHours(0, 0, 0, 0);
    const idx = Math.round((d.getTime() - weekStart.getTime()) / 86_400_000);
    if (idx < 0) calOverdue.actionItems++; else if (idx < 7) calDays[idx].actionItems++;
  }
  for (const m of calMeetings) {
    if (!m.meetingDate) continue;
    const d = new Date(m.meetingDate); d.setHours(0, 0, 0, 0);
    const idx = Math.round((d.getTime() - weekStart.getTime()) / 86_400_000);
    if (idx >= 0 && idx < 7) calDays[idx].meetings++;
  }

  const todaySubmittals  = calDays[0].submittals;
  const todayActionItems = calDays[0].actionItems;
  const todayMeetings    = calDays[0].meetings;
  const briefingDate     = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const briefingTime     = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  // ── Build priority queue ───────────────────────────────────────────────────
  const queue: QueueItem[] = [];

  for (const job of failedJobs.slice(0, 3)) {
    const meta = JOB_META[job.jobType];
    queue.push({
      id: `job-${job.id}`,
      label: `${meta?.label ?? job.jobType} failed`,
      meta: `${(job.bid?.projectName ?? "unknown").toLowerCase()} // ${job.errorMessage?.slice(0, 55) ?? "job failed — retry required"}`,
      level: "blocked",
      href: job.bidId ? `/bids/${job.bidId}` : "/",
      provenance: "automation",
    });
  }

  for (const brief of staleBriefs.slice(0, 2)) {
    queue.push({
      id: `brief-${brief.id}`,
      label: "Intelligence brief stale",
      meta: `${brief.bid.projectName.toLowerCase()} // regeneration required`,
      level: "review",
      href: `/bids/${brief.bid.id}`,
      provenance: "glint",
    });
  }

  for (const sub of overdueSubmittals.slice(0, 3)) {
    queue.push({
      id: `sub-${sub.id}`,
      label: `Submittal past due`,
      meta: `${sub.bid.projectName.toLowerCase()} // ${sub.title.slice(0, 45)}`,
      level: "blocked",
      href: `/bids/${sub.bid.id}`,
      provenance: "automation",
    });
  }

  for (const q of criticalQuestions.slice(0, 2)) {
    queue.push({
      id: `q-${q.id}`,
      label: `${q.priority.toLowerCase()} question open`,
      meta: `${(q.bid?.projectName ?? "—").toLowerCase()} // ${q.questionText.slice(0, 50)}`,
      level: q.priority === "CRITICAL" ? "blocked" : "review",
      href: q.bidId ? `/bids/${q.bidId}` : "/",
      provenance: "glint",
    });
  }

  for (const ai of overdueActionItems.slice(0, 2)) {
    queue.push({
      id: `ai-${ai.id}`,
      label: "Action item overdue",
      meta: `${ai.bid.projectName.toLowerCase()} // ${ai.description.slice(0, 50)}`,
      level: ai.priority === "CRITICAL" ? "blocked" : "review",
      href: `/bids/${ai.bid.id}`,
      provenance: ai.assignedToName ?? "meeting",
    });
  }

  for (const add of pendingAddendums.slice(0, 2)) {
    queue.push({
      id: `add-${add.id}`,
      label: `Addendum #${add.addendumNumber} delta ready`,
      meta: `${add.bid.projectName.toLowerCase()} // ai delta analysis complete`,
      level: "review",
      href: `/bids/${add.bid.id}`,
      provenance: "automation",
    });
  }

  for (const gap of pendingGapFindings.slice(0, 2)) {
    queue.push({
      id: `gap-${gap.id}`,
      label: `Scope gap — ${gap.severity ?? "unknown"} severity`,
      meta: `${(gap.bid?.projectName ?? "—").toLowerCase()} // ${gap.title?.slice(0, 45) ?? gap.tradeName ?? "pending review"}`,
      level: gap.severity === "critical" ? "blocked" : "review",
      href: gap.bidId ? `/bids/${gap.bidId}` : "/",
      provenance: "glint",
    });
  }

  queue.sort((a, b) => QUEUE_SORT[a.level] - QUEUE_SORT[b.level]);

  // ── Parse risk flags from active brief ────────────────────────────────────
  type RiskFlag = { flag: string; severity: string };
  let riskItems: RiskFlag[] = [];
  if (activeBrief?.riskFlags) {
    try {
      const parsed = JSON.parse(activeBrief.riskFlags);
      if (Array.isArray(parsed)) {
        riskItems = parsed.map((r) =>
          typeof r === "string"
            ? { flag: r, severity: "medium" }
            : { flag: r.flag ?? r.description ?? String(r), severity: (r.severity ?? "medium").toLowerCase() }
        );
      }
    } catch { /* ignore */ }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex items-start min-h-full">

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">

        {/* Posture rail */}
        <div
          className="flex items-center gap-3 px-6 h-[38px] border-b border-[var(--line)]"
          style={{ background: "rgba(255,255,255,0.012)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
            system
          </span>
          <div className="w-px h-3" style={{ background: "var(--line)" }} />

          {runningJobs.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--signal-soft)" }}>
              <span className="gwx-live-dot" style={{ width: 6, height: 6 }} />
              {runningJobs.length} job{runningJobs.length !== 1 ? "s" : ""} running
            </span>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
              no active jobs
            </span>
          )}

          <div className="w-px h-3" style={{ background: "var(--line)" }} />
          <span className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: providerKey ? "var(--signal-soft)" : "#ff968f" }}>
            {providerKey ? "• glint online" : "• glint degraded"}
          </span>

          <div className="w-px h-3" style={{ background: "var(--line)" }} />
          <span className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: sidecarOnline ? "var(--signal-soft)" : "var(--text-dim)" }}>
            {sidecarOnline ? "• sidecar online" : "• sidecar offline"}
          </span>

          {failedJobs.length > 0 && (
            <>
              <div className="w-px h-3" style={{ background: "var(--line)" }} />
              <span className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "#ff968f" }}>
                {failedJobs.length} blocked
              </span>
            </>
          )}

          <div className="ml-auto font-mono text-[9px] tracking-[0.06em]" style={{ color: "var(--text-dim)" }}>
            {nowStr}
          </div>
        </div>

        {/* Page header */}
        <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
          <div>
            <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
              groundworx // overnight operations
            </p>
            <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
              Operations
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
              Morning review · durable jobs + operator-ready outputs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded border border-[var(--line)] transition-colors"
            >
              Settings
            </Link>
            <Link
              href="/bids"
              className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors"
              style={{
                border: "1px solid rgba(0,255,100,0.32)",
                background: "var(--signal)",
                color: "#061009",
                fontWeight: 700,
              }}
            >
              All Projects →
            </Link>
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-4 gap-3 p-6 pb-0">
          <MetricCard
            accent="signal"
            label="Jobs Complete Overnight"
            value={completedNight.length}
            sub={runningJobs.length > 0 ? `${runningJobs.length} still running` : "all jobs settled"}
          />
          <MetricCard
            accent="amber"
            label="Review Required"
            value={reviewRequired}
            sub={reviewRequired > 0 ? "failed jobs · stale briefs · gap flags" : "nothing pending review"}
          />
          <MetricCard
            accent="red"
            label="Blocked Items"
            value={blockedCount}
            sub={blockedCount > 0 ? "failed jobs · overdue submittals" : "no blockers detected"}
          />
          <MetricCard
            accent="blue"
            label="Token Spend 12H"
            value={tokenTotal > 0 ? `$${tokenTotal.toFixed(2)}` : "—"}
            sub={tokenTotal > 0 ? "ai usage · last 12 hours" : "no usage recorded"}
          />
        </div>

        {/* ── 7-day calendar strip ──────────────────────────────── */}
        <div className="px-6 pt-5 pb-1">
          <div
            className="grid overflow-hidden rounded-[var(--radius)] border border-[var(--line)]"
            style={{
              gridTemplateColumns: "90px repeat(7, 1fr)",
              background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))",
              boxShadow: "var(--shadow)",
            }}
          >
            {/* Overdue */}
            <div className="px-3 py-3 border-r border-[var(--line)]" style={{ background: "rgba(232,69,60,0.04)" }}>
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] mb-2" style={{ color: "#ff968f" }}>Overdue</p>
              <div className="flex flex-col gap-1">
                {calOverdue.submittals > 0 && (
                  <Link href="/submittals" className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ff968f" }} />
                    <span className="font-mono text-[10px]" style={{ color: "#ff968f" }}>{calOverdue.submittals} sub</span>
                  </Link>
                )}
                {calOverdue.actionItems > 0 && (
                  <Link href="/meetings" className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ffcc72" }} />
                    <span className="font-mono text-[10px]" style={{ color: "#ffcc72" }}>{calOverdue.actionItems} task</span>
                  </Link>
                )}
                {procurementBlocked > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ff968f" }} />
                    <span className="font-mono text-[10px]" style={{ color: "#ff968f" }}>{procurementBlocked} pkg</span>
                  </div>
                )}
                {calOverdue.submittals === 0 && calOverdue.actionItems === 0 && procurementBlocked === 0 && (
                  <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.18)" }}>—</span>
                )}
              </div>
            </div>

            {/* Day columns */}
            {calDays.map((day, i) => (
              <div
                key={i}
                className="px-3 py-3 border-r border-[var(--line)] last:border-r-0"
                style={{ background: day.isToday ? "rgba(0,255,100,0.03)" : "transparent" }}
              >
                <div className="flex items-baseline gap-1.5 mb-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: day.isToday ? "var(--signal-soft)" : "var(--text-dim)" }}>
                    {day.label}
                  </p>
                  <p className="font-mono text-[11px] font-[700]" style={{ color: day.isToday ? "var(--signal-soft)" : "var(--text-soft)" }}>
                    {day.dayNum}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  {day.submittals > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ff968f" }} />
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{day.submittals} sub</span>
                    </div>
                  )}
                  {day.actionItems > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ffcc72" }} />
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{day.actionItems} task</span>
                    </div>
                  )}
                  {day.meetings > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--blue)" }} />
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{day.meetings} mtg</span>
                    </div>
                  )}
                  {day.submittals === 0 && day.actionItems === 0 && day.meetings === 0 && (
                    <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.1)" }}>—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Work grid */}
        <div
          className="p-6 grid gap-3"
          style={{ gridTemplateColumns: "minmax(0,1.35fr) minmax(260px,0.75fr)" }}
        >
          {/* Overnight Run Ledger */}
          <div
            className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <PanelHead
              title="Overnight Run Ledger"
              sub="Durable jobs, morning review, and operator-visible outcomes"
              right={`last sync // ${lastSyncStr}`}
            />
            {sortedJobs.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>No jobs in the last 48 hours.</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Jobs appear here as automation runs.</p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <TableHead cols={["Job", "State", "Artifact / Error", "Owner"]} />
                <tbody>
                  {sortedJobs.map(job => {
                    const meta = JOB_META[job.jobType] ?? {
                      label: job.jobType.replace(/_/g, " "),
                      owner: job.triggerSource === "user" ? "manual" : "automation",
                    };
                    const artifact = job.status === "failed"
                      ? (job.errorMessage?.slice(0, 42) ?? "error")
                      : (job.resultSummary?.slice(0, 42) ?? job.artifactType ?? "—");
                    return (
                      <tr key={job.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                        <td className="px-4 py-3">
                          <span className="block text-[13px] font-[600]" style={{ color: "var(--text)" }}>
                            {meta.label}
                          </span>
                          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                            {job.bid?.projectName?.toLowerCase() ?? job.inputSummary ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3"><StateChip status={job.status} /></td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>{artifact}</td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {job.triggerSource === "user" ? "manual" : meta.owner}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Priority Queue */}
          <div
            className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <PanelHead
              title="Priority Queue"
              sub="What needs a human first"
              right={queue.length > 0 ? `${queue.length} item${queue.length !== 1 ? "s" : ""}` : undefined}
            />
            {queue.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm" style={{ color: "var(--signal-soft)" }}>Queue clear.</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>No blockers or review items detected.</p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <TableHead cols={["Item", "Level"]} />
                <tbody>
                  {queue.map(item => (
                    <tr key={item.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                      <td className="px-4 py-3">
                        <Link
                          href={item.href}
                          className="block text-[13px] font-[600] transition-colors hover:text-emerald-400"
                          style={{ color: "var(--text)" }}
                        >
                          {item.label}
                        </Link>
                        <div className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                          {item.meta}
                        </div>
                        <div className="font-mono text-[9px] mt-0.5 uppercase tracking-[0.06em]" style={{ color: "var(--text-dim)" }}>
                          via {item.provenance}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <QueueChip level={item.level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Right intelligence rail ────────────────────────────────────────── */}
      <aside
        className="w-[340px] shrink-0 border-l border-[var(--line)] overflow-y-auto sticky top-0"
        style={{
          height: "calc(100vh - 62px)",
          background: "linear-gradient(180deg,rgba(10,13,18,0.96),rgba(7,9,13,0.98))",
        }}
      >
        <div className="p-4 flex flex-col gap-3">

          {/* Morning Briefing */}
          <RailCard>
            <div className="px-4 pt-4 pb-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] mb-0.5" style={{ color: "var(--text-dim)" }}>
                    morning briefing
                  </p>
                  <p className="text-[13px] font-[700] tracking-[-0.02em]" style={{ color: "var(--text)" }}>
                    {briefingDate}
                  </p>
                </div>
                <span className="font-mono text-[9px] mt-0.5" style={{ color: "var(--text-dim)" }}>{briefingTime}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {(calOverdue.submittals > 0 || calOverdue.actionItems > 0) && (
                  <div
                    className="px-3 py-2 rounded-md"
                    style={{ background: "rgba(232,69,60,0.07)", border: "1px solid rgba(232,69,60,0.18)" }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.07em] mb-1" style={{ color: "#ff968f" }}>Overdue</p>
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-soft)" }}>
                      {[
                        calOverdue.submittals > 0 ? `${calOverdue.submittals} submittal${calOverdue.submittals !== 1 ? "s" : ""} past due` : null,
                        calOverdue.actionItems > 0 ? `${calOverdue.actionItems} action item${calOverdue.actionItems !== 1 ? "s" : ""} overdue` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}
                {(procurementBlocked > 0 || procurementAtRisk > 0) && (
                  <div
                    className="px-3 py-2 rounded-md"
                    style={{
                      background: procurementBlocked > 0 ? "rgba(232,69,60,0.07)" : "rgba(245,166,35,0.07)",
                      border: `1px solid ${procurementBlocked > 0 ? "rgba(232,69,60,0.18)" : "rgba(245,166,35,0.2)"}`,
                    }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.07em] mb-1" style={{ color: procurementBlocked > 0 ? "#ff968f" : "#ffcc72" }}>
                      Procurement
                    </p>
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-soft)" }}>
                      {[
                        procurementBlocked > 0 ? `${procurementBlocked} package${procurementBlocked !== 1 ? "s" : ""} blocked` : null,
                        procurementAtRisk > 0 ? `${procurementAtRisk} at risk` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--text-dim)" }}>Today</p>
                  {todaySubmittals === 0 && todayActionItems === 0 && todayMeetings === 0 ? (
                    <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>Nothing due today.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {todaySubmittals > 0 && (
                        <Link href="/submittals" className="flex items-center gap-2 group">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ff968f" }} />
                          <span className="text-[11px] group-hover:text-white transition-colors" style={{ color: "var(--text-soft)" }}>
                            {todaySubmittals} submittal{todaySubmittals !== 1 ? "s" : ""} due
                          </span>
                        </Link>
                      )}
                      {todayActionItems > 0 && (
                        <Link href="/meetings" className="flex items-center gap-2 group">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ffcc72" }} />
                          <span className="text-[11px] group-hover:text-white transition-colors" style={{ color: "var(--text-soft)" }}>
                            {todayActionItems} action item{todayActionItems !== 1 ? "s" : ""} due
                          </span>
                        </Link>
                      )}
                      {todayMeetings > 0 && (
                        <Link href="/meetings" className="flex items-center gap-2 group">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--blue)" }} />
                          <span className="text-[11px] group-hover:text-white transition-colors" style={{ color: "var(--text-soft)" }}>
                            {todayMeetings} meeting{todayMeetings !== 1 ? "s" : ""} today
                          </span>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                {calDays.slice(1).some(d => d.submittals > 0 || d.actionItems > 0 || d.meetings > 0) && (
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--text-dim)" }}>This week</p>
                    <div className="flex flex-col gap-0.5">
                      {calDays.slice(1).filter(d => d.submittals > 0 || d.actionItems > 0 || d.meetings > 0).map((d, i) => (
                        <p key={i} className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {d.label} {d.dayNum} —{" "}
                          {[
                            d.submittals > 0 ? `${d.submittals} sub` : null,
                            d.actionItems > 0 ? `${d.actionItems} task` : null,
                            d.meetings > 0 ? `${d.meetings} mtg` : null,
                          ].filter(Boolean).join(", ")}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </RailCard>

          {/* Glint recommendation */}
          <RailCard featured={!!activeBrief}>
            <div className="px-4 pt-4 pb-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] mb-3" style={{ color: "var(--text-dim)" }}>
                glint recommendation
              </p>
              {activeBrief ? (
                <>
                  <h3 className="text-[15px] font-[700] tracking-[-0.02em] mb-2" style={{ color: "var(--text)" }}>
                    {riskItems.length > 0 ? "Risk flags require attention" : "Active project briefing current"}
                  </h3>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--text-soft)" }}>
                    {activeBrief.bid.projectName}
                    {activeBrief.bid.location ? ` · ${activeBrief.bid.location.toLowerCase()}` : ""} —{" "}
                    {riskItems.length > 0
                      ? `${riskItems.length} risk flag${riskItems.length !== 1 ? "s" : ""} identified in the current intelligence brief.`
                      : "Intelligence brief is current. Review for submittal readiness and superintendent handoff."}
                  </p>
                  <div className="flex flex-col gap-1.5 mb-3">
                    {riskItems.slice(0, 3).map((r, i) => {
                      const sevColor = r.severity === "critical" ? "#ff968f" : r.severity === "high" ? "#ffcc72" : "var(--text-dim)";
                      return (
                        <div
                          key={i}
                          className="px-3 py-2 rounded-md border border-[var(--line)]"
                          style={{ background: "rgba(255,255,255,0.015)" }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[8px] uppercase tracking-[0.07em]" style={{ color: sevColor }}>
                              {r.severity}
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-soft)" }}>{r.flag}</p>
                        </div>
                      );
                    })}
                  </div>
                  <Link
                    href={`/bids/${activeBrief.bid.id}`}
                    className="block font-mono text-[9px] uppercase tracking-[0.07em] pb-4 transition-colors hover:opacity-80"
                    style={{ color: "var(--signal-soft)" }}
                  >
                    Open project →
                  </Link>
                </>
              ) : (
                <div className="pb-4">
                  <h3 className="text-[14px] font-[700] tracking-[-0.02em] mb-1.5" style={{ color: "var(--text)" }}>
                    No active briefing
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                    Award or promote a project and generate an intelligence brief to surface Glint recommendations here.
                  </p>
                </div>
              )}
            </div>
          </RailCard>

          {/* System posture */}
          <RailCard>
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] mb-0.5" style={{ color: "var(--text-dim)" }}>
                system posture
              </p>
              <p className="text-[13px] font-[700] tracking-[-0.02em]">Operational Status</p>
            </div>
            <div className="px-4">
              {([
                { label: "AI Provider",      value: providerKey ? "connected" : "not configured — go to /settings",      signal: !!providerKey                              },
                { label: "Sidecar",          value: sidecarOnline ? "online" : "offline — run npm run dev:sidecar",        signal: sidecarOnline,  href: "/settings"             },
                { label: "Active Jobs",      value: runningJobs.length > 0 ? `${runningJobs.length} running` : "idle",     signal: runningJobs.length > 0                     },
                { label: "Open Submittals",  value: `${totalSubmittalsOpen} across all projects`,                          signal: false,  href: "/submittals"                },
                { label: "Action Items",     value: totalOpenActionItems > 0 ? `${totalOpenActionItems} open` : "clear",   signal: totalOpenActionItems === 0, href: "/meetings" },
                { label: "Queue",            value: queue.length > 0 ? `${queue.length} pending` : "clear",               signal: queue.length === 0                         },
                { label: "Token Budget 12H", value: tokenTotal > 0 ? `$${tokenTotal.toFixed(2)}` : "no usage",            signal: false                                      },
              ] as { label: string; value: string; signal: boolean; href?: string }[]).map(({ label, value, signal, href }, i, arr) => {
                const rowInner = (
                  <div
                    className="flex items-center justify-between gap-3 py-3"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none" }}
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
                      {label}
                    </span>
                    <span
                      className="text-[12px] font-[600] text-right"
                      style={{ color: signal ? "var(--signal-soft)" : "var(--text)" }}
                    >
                      {value}
                    </span>
                  </div>
                );
                return href ? (
                  <Link key={label} href={href} className="block hover:bg-white/[0.02] -mx-4 px-4 transition-colors">
                    {rowInner}
                  </Link>
                ) : (
                  <div key={label}>{rowInner}</div>
                );
              })}
            </div>
          </RailCard>

          {/* Quick actions */}
          <RailCard>
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
                quick nav
              </p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-1.5">
              {([
                { label: "All Projects", href: "/bids"        },
                { label: "Submittals",   href: "/submittals"  },
                { label: "Meetings",     href: "/meetings"    },
                { label: "Settings",     href: "/settings"    },
              ] as const).map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-2.5 rounded-md text-center border border-[var(--line)] transition-colors"
                >
                  {label}
                </Link>
              ))}
            </div>
          </RailCard>

        </div>
      </aside>
    </div>
  );
}
