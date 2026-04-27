"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type ActiveProject = {
  id: number;
  projectName: string;
  location: string | null;
  workflowType: string | null;
  status: string;
  dueDate: string | null;
  subCount: number;
  respondedCount: number;
  levelingUploadCount: number;
  openSubmittals: number;
  hasBrief: boolean;
} | null;

type SidebarCounts = {
  projects: number;
  activeJobs: number;
  newSignals: number;
  openActionItems: number;
};

const STATUS_PHASE: Record<string, string> = {
  draft:     "intake",
  active:    "pursuit",
  leveling:  "leveling",
  submitted: "submitted",
  awarded:   "handoff",
  lost:      "closed",
  cancelled: "closed",
};

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatDueDate(dueDate: string | null) {
  if (!dueDate) return "not set";
  return dueDateFormatter.format(new Date(dueDate));
}

function formatResponses(subCount: number, respondedCount: number) {
  if (subCount === 0) return "none invited";
  return `${respondedCount}/${subCount}`;
}

function formatUploads(count: number) {
  if (count === 0) return "none";
  return count === 1 ? "1 upload" : `${count} uploads`;
}

export default function AppSidebar({
  counts,
  activeProject,
}: {
  counts: SidebarCounts;
  activeProject: ActiveProject;
}) {
  const pathname = usePathname();

  function isActive(prefix: string, exact = false) {
    if (exact) return pathname === prefix;
    return pathname.startsWith(prefix);
  }

  return (
    <aside
      className="flex flex-col w-[240px] shrink-0 border-r border-[var(--line)] py-[18px] overflow-y-auto"
      style={{ background: "linear-gradient(180deg,rgba(12,14,19,0.92),rgba(9,11,15,0.96))" }}
    >
      {/* ── command ───────────────────────────────────────────────────── */}
      <SectionLabel label="command" />
      <SidebarItem
        href="/"
        label="Operations"
        sub="overnight jobs + reviews"
        meta={counts.activeJobs > 0 ? String(counts.activeJobs) : "—"}
        active={isActive("/", true)}
      />
      <SidebarItem
        href="/market-intelligence"
        label="Market Intelligence"
        sub="signals + pipeline scan"
        meta={counts.newSignals > 0 ? String(counts.newSignals) : "—"}
        active={isActive("/market-intelligence")}
      />
      <SidebarItem
        href="/bids"
        label="Projects"
        sub="job setup + execution"
        meta={String(counts.projects)}
        active={isActive("/bids")}
      />

      {/* ── execution ─────────────────────────────────────────────────── */}
      <SectionLabel label="execution" />
      <SidebarItem
        href="/tasks"
        label="Tasks"
        sub="action items + manual tasks"
        meta={counts.openActionItems > 0 ? String(counts.openActionItems) : "—"}
        active={isActive("/tasks")}
      />

      {/* ── system ────────────────────────────────────────────────────── */}
      <SectionLabel label="system" />
      <SidebarItem
        href="/settings"
        label="Settings"
        sub="providers + integrations"
        meta="ok"
        active={isActive("/settings")}
      />

      {/* ── Active project card ───────────────────────────────────────── */}
      {activeProject && (
        <Link
          href={`/bids/${activeProject.id}`}
          className="mx-3 mt-5 rounded-[var(--radius)] border border-[var(--line)] p-3.5 flex flex-col gap-3 transition-colors hover:border-[var(--line-strong)]"
          style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))" }}
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
            active project
          </p>
          <div>
            <p className="text-[16px] font-[700] tracking-[-0.03em] leading-tight" style={{ color: "var(--text)" }}>
              {activeProject.projectName}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-soft)" }}>
              {activeProject.workflowType === "PROJECT" ? "project mode" : "bid mode"}
              {` // ${STATUS_PHASE[activeProject.status] ?? activeProject.status}`}
              {activeProject.location ? ` // ${activeProject.location.toLowerCase()}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <MiniStat label="due" value={formatDueDate(activeProject.dueDate)} />
            <MiniStat
              label="responses"
              value={formatResponses(activeProject.subCount, activeProject.respondedCount)}
              accent={activeProject.respondedCount > 0}
            />
            <MiniStat
              label="leveling"
              value={formatUploads(activeProject.levelingUploadCount)}
              accent={activeProject.levelingUploadCount > 0}
            />
            <MiniStat
              label="briefing"
              value={activeProject.hasBrief ? "ready" : "pending"}
              accent={activeProject.hasBrief}
            />
            <MiniStat
              className="col-span-2"
              label="submittals"
              value={activeProject.openSubmittals > 0 ? `${activeProject.openSubmittals} open` : "none open"}
              accent={activeProject.openSubmittals === 0}
            />
          </div>
        </Link>
      )}
    </aside>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p
      className="font-mono text-[9px] uppercase tracking-[0.11em] px-4 pt-4 pb-1.5"
      style={{ color: "var(--text-dim)" }}
    >
      {label}
    </p>
  );
}

function SidebarItem({
  href, label, sub, meta, active, dim = false,
}: {
  href: string;
  label: string;
  sub: string;
  meta: string;
  active: boolean;
  dim?: boolean;
}) {
  return (
    <Link
      href={href}
      className="relative flex items-center justify-between gap-3 mx-2 mb-1 px-3 py-[11px] rounded-[7px] border transition-colors"
      style={
        active
          ? {
              background: "rgba(255,255,255,0.03)",
              borderColor: "transparent",
              color: "var(--text)",
              boxShadow: "inset 2px 0 0 var(--signal)",
            }
          : {
              borderColor: "transparent",
              color: dim ? "var(--text-dim)" : "var(--text-soft)",
              background: "transparent",
            }
      }
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-[600] tracking-[-0.01em] truncate">{label}</span>
        <span
          className="text-[10px] truncate"
          style={{ color: "var(--text-dim)" }}
        >
          {sub}
        </span>
      </div>
      <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--text-dim)" }}>
        {meta}
      </span>
    </Link>
  );
}

function MiniStat({
  label, value, accent = false, className = "",
}: {
  label: string;
  value: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`px-2.5 py-2 rounded-md border border-[var(--line)] ${className}`.trim()}
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <span
        className="block font-mono text-[8px] uppercase tracking-[0.08em] mb-1"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </span>
      <span
        className="text-[12px] font-[600]"
        style={{ color: accent ? "var(--signal-soft)" : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}
