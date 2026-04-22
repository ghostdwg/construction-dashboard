import Link from "next/link";
import { prisma } from "@/lib/prisma";

// ── Chip maps ────────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  PENDING:            { label: "PENDING",       color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)"  },
  REQUESTED:          { label: "REQUESTED",     color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"   },
  RECEIVED:           { label: "RECEIVED",      color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)"  },
  UNDER_REVIEW:       { label: "UNDER REVIEW",  color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)"  },
  APPROVED:           { label: "APPROVED",      color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  APPROVED_AS_NOTED:  { label: "NOTED",         color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  REJECTED:           { label: "REJECTED",      color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"   },
  RESUBMIT:           { label: "RESUBMIT",      color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"   },
};

const TYPE_LABEL: Record<string, string> = {
  PRODUCT_DATA: "Product",
  SHOP_DRAWING: "Shop Dwg",
  SAMPLE:       "Sample",
  MOCKUP:       "Mockup",
  WARRANTY:     "Warranty",
  O_AND_M:      "O&M",
  LEED:         "LEED",
  CERT:         "Cert",
  OTHER:        "Other",
};

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

export default async function SubmittalsPage() {
  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [items, overdueCount, underReviewCount, approvedThisWeek] = await Promise.all([
    prisma.submittalItem.findMany({
      where: { status: { notIn: ["APPROVED", "APPROVED_AS_NOTED"] } },
      include: {
        bid: { select: { id: true, projectName: true, location: true } },
      },
      orderBy: [{ submitByDate: "asc" }, { requiredBy: "asc" }, { createdAt: "asc" }],
      take: 150,
    }),
    prisma.submittalItem.count({
      where: {
        status: { notIn: ["APPROVED", "APPROVED_AS_NOTED", "REJECTED"] },
        submitByDate: { lt: now },
      },
    }),
    prisma.submittalItem.count({ where: { status: "UNDER_REVIEW" } }),
    prisma.submittalItem.count({
      where: {
        status: { in: ["APPROVED", "APPROVED_AS_NOTED"] },
        approvedAt: { gte: weekAgo },
      },
    }),
  ]);

  // per-project breakdown for right rail
  const byProject: Record<number, { name: string; location: string | null; count: number; overdue: number }> = {};
  for (const item of items) {
    const pid = item.bid.id;
    if (!byProject[pid]) byProject[pid] = { name: item.bid.projectName, location: item.bid.location, count: 0, overdue: 0 };
    byProject[pid].count++;
    if (isOverdue(item.submitByDate ?? item.requiredBy)) byProject[pid].overdue++;
  }
  const projectList = Object.entries(byProject)
    .map(([id, v]) => ({ id: Number(id), ...v }))
    .sort((a, b) => b.overdue - a.overdue || b.count - a.count);

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // submittals
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Submittals
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            Open register across all active projects · sorted by submit-by date
          </p>
        </div>
      </div>

      {/* ── Metric cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 p-6 pb-0">
        <MetricCard accent="signal" label="Total Open"       value={items.length}       sub="pending approval" />
        <MetricCard accent="red"    label="Overdue"          value={overdueCount}        sub="past submit-by date" />
        <MetricCard accent="blue"   label="Under Review"     value={underReviewCount}    sub="with A/E or owner" />
        <MetricCard accent="signal" label="Approved 7 Days"  value={approvedThisWeek}    sub="closed this week" />
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
              <p className="text-sm font-[700] tracking-[-0.02em]">Open Submittals</p>
              <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{items.length} items</span>
            </div>

            {items.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-[500]" style={{ color: "var(--signal-soft)" }}>All clear</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>No open submittals across active projects.</p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Project", "Submittal", "Type", "Status", "Submit By", "On Site By", ""].map((h, i) => (
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
                  {items.map((item) => {
                    const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.PENDING;
                    const submitOverdue = isOverdue(item.submitByDate);
                    const onSiteOverdue = isOverdue(item.requiredOnSiteDate);
                    return (
                      <tr key={item.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/bids/${item.bid.id}?tab=submittals`}
                            className="text-[12px] font-[600] transition-colors hover:text-emerald-400 block truncate max-w-[160px]"
                            style={{ color: "var(--text)" }}
                          >
                            {item.bid.projectName}
                          </Link>
                          {item.bid.location && (
                            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{item.bid.location}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[12px] font-[500] leading-tight" style={{ color: "var(--text)" }}>
                            {item.title}
                          </p>
                          {item.submittalNumber && (
                            <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                              #{item.submittalNumber}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                            {TYPE_LABEL[item.type] ?? item.type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
                            style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
                          >
                            {chip.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="font-mono text-[11px]"
                            style={{ color: submitOverdue ? "#ff968f" : "var(--text-soft)" }}
                          >
                            {fmtDate(item.submitByDate)}
                            {submitOverdue && <span className="ml-1 text-[9px]">▲</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="font-mono text-[11px]"
                            style={{ color: onSiteOverdue ? "#ffcc72" : "var(--text-dim)" }}
                          >
                            {fmtDate(item.requiredOnSiteDate ?? item.requiredBy)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/bids/${item.bid.id}?tab=submittals`}
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
          {/* By-project breakdown */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">By Project</p>
            </div>
            {projectList.length === 0 ? (
              <p className="px-4 py-4 text-[11px]" style={{ color: "var(--text-dim)" }}>No open submittals.</p>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {projectList.map((p) => (
                  <Link
                    key={p.id}
                    href={`/bids/${p.id}?tab=submittals`}
                    className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-[600] truncate" style={{ color: "var(--text)" }}>{p.name}</p>
                      {p.overdue > 0 && (
                        <p className="font-mono text-[10px] mt-0.5" style={{ color: "#ff968f" }}>
                          {p.overdue} overdue
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-[13px] ml-2 shrink-0" style={{ color: p.overdue > 0 ? "#ff968f" : "var(--text-soft)" }}>
                      {p.count}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Status distribution */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">Status Mix</p>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {(["PENDING","REQUESTED","RECEIVED","UNDER_REVIEW","RESUBMIT","REJECTED"] as const).map((s) => {
                const chip = STATUS_CHIP[s];
                const cnt = items.filter((i) => i.status === s).length;
                if (cnt === 0) return null;
                return (
                  <div key={s} className="flex items-center justify-between">
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
                      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
                    >
                      {chip.label}
                    </span>
                    <span className="font-mono text-[12px]" style={{ color: "var(--text)" }}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
