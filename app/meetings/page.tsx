import Link from "next/link";
import { prisma } from "@/lib/prisma";

// ── Chip maps ────────────────────────────────────────────────────────────────

const PRIORITY_CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: "CRITICAL", color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"  },
  HIGH:     { label: "HIGH",     color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"  },
  MEDIUM:   { label: "MEDIUM",   color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)" },
  LOW:      { label: "LOW",      color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)" },
};

const _STATUS_CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  OPEN:        { label: "OPEN",        color: "var(--text-soft)",  bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)"  },
  IN_PROGRESS: { label: "IN PROGRESS", color: "#ffcc72",           bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"   },
  CLOSED:      { label: "CLOSED",      color: "var(--signal-soft)",bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  DEFERRED:    { label: "DEFERRED",    color: "var(--text-dim)",   bg: "rgba(255,255,255,0.03)",  border: "rgba(255,255,255,0.08)" },
};

const PRIORITY_SORT: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function isOverdue(d: Date | null | undefined): boolean {
  if (!d) return false;
  return new Date(d) < new Date();
}

function MetricCard({ label, value, sub, accent }: {
  label: string; value: number | string; sub: string;
  accent: "signal" | "amber" | "red" | "blue";
}) {
  const color = { signal: "var(--signal)", amber: "var(--amber)", red: "var(--red)", blue: "var(--blue)" }[accent];
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--line)] px-4 py-4"
      style={{ background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))", boxShadow: "var(--shadow)" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: color }} />
      <p className="font-mono text-[10px] uppercase tracking-[0.09em] mb-2" style={{ color: "var(--text-dim)" }}>{label}</p>
      <p className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>{value}</p>
      <p className="text-xs mt-2" style={{ color: "var(--text-soft)" }}>{sub}</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function MeetingsPage() {
  // eslint-disable-next-line react-hooks/purity
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [items, overdueCount, criticalHighCount, closedThisWeek] = await Promise.all([
    prisma.meetingActionItem.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      include: {
        bid:     { select: { id: true, projectName: true, location: true } },
        meeting: { select: { id: true, title: true, meetingDate: true } },
      },
      orderBy: [{ dueDate: "asc" }],
      take: 150,
    }),
    prisma.meetingActionItem.count({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() } },
    }),
    prisma.meetingActionItem.count({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, priority: { in: ["CRITICAL", "HIGH"] } },
    }),
    prisma.meetingActionItem.count({
      where: { status: "CLOSED", closedAt: { gte: weekAgo } },
    }),
  ]);

  // Sort: overdue → priority → due date
  const sorted = [...items].sort((a, b) => {
    const aOver = isOverdue(a.dueDate) ? 0 : 1;
    const bOver = isOverdue(b.dueDate) ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    const pDiff = (PRIORITY_SORT[a.priority] ?? 3) - (PRIORITY_SORT[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    return 0;
  });

  // per-project breakdown
  const byProject: Record<number, { name: string; count: number; overdue: number; critical: number }> = {};
  for (const item of items) {
    const pid = item.bid.id;
    if (!byProject[pid]) byProject[pid] = { name: item.bid.projectName, count: 0, overdue: 0, critical: 0 };
    byProject[pid].count++;
    if (isOverdue(item.dueDate)) byProject[pid].overdue++;
    if (item.priority === "CRITICAL") byProject[pid].critical++;
  }
  const projectList = Object.entries(byProject)
    .map(([id, v]) => ({ id: Number(id), ...v }))
    .sort((a, b) => b.critical - a.critical || b.overdue - a.overdue || b.count - a.count);

  // assignee breakdown
  const byAssignee: Record<string, number> = {};
  for (const item of items) {
    const name = item.assignedToName ?? "Unassigned";
    byAssignee[name] = (byAssignee[name] ?? 0) + 1;
  }
  const assigneeList = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // meetings
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Action Items
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            Open commitments across all active projects · sorted by priority + due date
          </p>
        </div>
      </div>

      {/* ── Metric cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 p-6 pb-0">
        <MetricCard accent="signal" label="Total Open"      value={items.length}        sub="open + in progress" />
        <MetricCard accent="red"    label="Overdue"         value={overdueCount}         sub="past due date" />
        <MetricCard accent="amber"  label="Critical / High" value={criticalHighCount}    sub="priority action required" />
        <MetricCard accent="signal" label="Closed 7 Days"   value={closedThisWeek}       sub="resolved this week" />
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-5 p-6">

        {/* ── Main table ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div
            className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div
              className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <p className="text-sm font-[700] tracking-[-0.02em]">Open Action Items</p>
              <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{items.length} items</span>
            </div>

            {sorted.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-[500]" style={{ color: "var(--signal-soft)" }}>All clear</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>No open action items across active projects.</p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Project", "Action Item", "Assigned To", "Meeting", "Due Date", "Priority", ""].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)]"
                        style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => {
                    const pChip = PRIORITY_CHIP[item.priority] ?? PRIORITY_CHIP.MEDIUM;
                    const overdue = isOverdue(item.dueDate);
                    return (
                      <tr key={item.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/bids/${item.bid.id}?tab=meetings`}
                            className="text-[12px] font-[600] transition-colors hover:text-emerald-400 block truncate max-w-[140px]"
                            style={{ color: "var(--text)" }}
                          >
                            {item.bid.projectName}
                          </Link>
                          {item.bid.location && (
                            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{item.bid.location}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="text-[12px] leading-snug" style={{ color: "var(--text)" }}>
                            {item.description}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text-soft)" }}>
                          {item.assignedToName ?? <span style={{ color: "var(--text-dim)" }}>—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {item.meeting ? (
                            <div>
                              <p className="text-[11px] leading-tight truncate max-w-[120px]" style={{ color: "var(--text-soft)" }}>
                                {item.meeting.title}
                              </p>
                              <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                                {fmtDate(item.meeting.meetingDate)}
                              </p>
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-dim)" }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="font-mono text-[11px]"
                            style={{ color: overdue ? "#ff968f" : "var(--text-soft)" }}
                          >
                            {fmtDate(item.dueDate)}
                            {overdue && <span className="ml-1 text-[9px]">▲</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
                            style={{ color: pChip.color, background: pChip.bg, border: `1px solid ${pChip.border}` }}
                          >
                            {pChip.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/bids/${item.bid.id}?tab=meetings`}
                            className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors"
                            style={{ border: "1px solid var(--line)" }}
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <div
          className="w-[260px] shrink-0 flex flex-col gap-4"
          style={{ position: "sticky", top: 0, height: "calc(100vh - 62px)", overflowY: "auto" }}
        >
          {/* By project */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">By Project</p>
            </div>
            {projectList.length === 0 ? (
              <p className="px-4 py-4 text-[11px]" style={{ color: "var(--text-dim)" }}>No open items.</p>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {projectList.map((p) => (
                  <Link
                    key={p.id}
                    href={`/bids/${p.id}?tab=meetings`}
                    className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-[600] truncate" style={{ color: "var(--text)" }}>{p.name}</p>
                      <p className="font-mono text-[10px] mt-0.5" style={{ color: p.overdue > 0 ? "#ff968f" : "var(--text-dim)" }}>
                        {p.critical > 0 ? `${p.critical} critical` : p.overdue > 0 ? `${p.overdue} overdue` : "on track"}
                      </p>
                    </div>
                    <span className="font-mono text-[13px] ml-2 shrink-0" style={{ color: p.overdue > 0 ? "#ff968f" : "var(--text-soft)" }}>
                      {p.count}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* By assignee */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">By Assignee</p>
            </div>
            {assigneeList.length === 0 ? (
              <p className="px-4 py-4 text-[11px]" style={{ color: "var(--text-dim)" }}>No assignments yet.</p>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {assigneeList.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[12px] truncate" style={{ color: "var(--text-soft)" }}>{name}</span>
                    <span className="font-mono text-[12px] ml-2 shrink-0" style={{ color: "var(--text)" }}>{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
