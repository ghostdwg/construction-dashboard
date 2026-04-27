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
  PRODUCT_DATA: "Product Data",
  SHOP_DRAWING: "Shop Drawing",
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

export default async function SubmittalsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type: typeFilter } = await searchParams;
  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const typeWhere = typeFilter ? { type: typeFilter } : {};

  const [items, overdueCount, underReviewCount, pendingProcoreCount, typeCounts] = await Promise.all([
    prisma.submittalItem.findMany({
      where: { status: { notIn: ["APPROVED", "APPROVED_AS_NOTED"] }, ...typeWhere },
      include: {
        bid: { select: { id: true, projectName: true, location: true } },
        specSection: { select: { csiNumber: true, csiCanonicalTitle: true, csiTitle: true } },
      },
      orderBy: [{ submitByDate: "asc" }, { requiredBy: "asc" }, { createdAt: "asc" }],
      take: 150,
    }),
    prisma.submittalItem.count({
      where: {
        status: { notIn: ["APPROVED", "APPROVED_AS_NOTED", "REJECTED"] },
        submitByDate: { lt: now },
        ...typeWhere,
      },
    }),
    prisma.submittalItem.count({ where: { status: "UNDER_REVIEW", ...typeWhere } }),
    prisma.submittalItem.count({
      where: { status: "PENDING", ...typeWhere },
    }),
    prisma.submittalItem.groupBy({
      by: ["type"],
      where: { status: { notIn: ["APPROVED", "APPROVED_AS_NOTED"] } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
  ]);

  // per-project breakdown for summary strip
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

  const activeTypeLabel = typeFilter ? (TYPE_LABEL[typeFilter] ?? typeFilter) : null;

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
            {activeTypeLabel && (
              <span className="ml-3 text-[20px] font-[500] tracking-[-0.02em]" style={{ color: "var(--text-dim)" }}>
                — {activeTypeLabel}
              </span>
            )}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            Open register across all active projects · sorted by submit-by date
          </p>
        </div>
        {activeTypeLabel && (
          <Link
            href="/submittals"
            className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors whitespace-nowrap"
            style={{ border: "1px solid var(--line)", color: "var(--text-dim)" }}
          >
            ✕ Clear filter
          </Link>
        )}
      </div>

      {/* ── Metric cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 p-6 pb-4">
        <MetricCard accent="signal" label="Total Open"       value={items.length}       sub="pending approval" />
        <MetricCard accent="red"    label="Overdue"          value={overdueCount}        sub="past submit-by date" />
        <MetricCard accent="blue"   label="Under Review"     value={underReviewCount}    sub="with A/E or owner" />
        <MetricCard accent="amber"  label="Pending Push"     value={pendingProcoreCount}    sub="not yet sent to Procore" />
      </div>

      {/* ── Summary strip ───────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-6 py-2.5 border-y border-[var(--line)] overflow-x-auto"
        style={{ background: "rgba(255,255,255,0.012)" }}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] shrink-0" style={{ color: "var(--text-dim)" }}>
          Projects
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {projectList.map((p) => (
            <Link
              key={p.id}
              href={`/bids/${p.id}?tab=submittals`}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md border transition-colors hover:border-[var(--line-strong)]"
              style={{ border: "1px solid var(--line)", background: "rgba(255,255,255,0.02)" }}
            >
              <span className="text-[11px] font-[600] whitespace-nowrap" style={{ color: "var(--text)" }}>{p.name}</span>
              <span className="font-mono text-[10px] whitespace-nowrap" style={{ color: p.overdue > 0 ? "#ff968f" : "var(--text-dim)" }}>
                {p.count}{p.overdue > 0 ? ` · ${p.overdue} ▲` : ""}
              </span>
            </Link>
          ))}
        </div>

      </div>

      {/* ── Type filter strip ───────────────────────────────────────────── */}
      {typeCounts.length > 0 && (
        <div
          className="flex items-center gap-2 px-6 py-2 border-b border-[var(--line)] overflow-x-auto"
          style={{ background: "rgba(255,255,255,0.006)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] shrink-0 mr-1" style={{ color: "var(--text-dim)" }}>
            Type
          </span>
          <Link
            href="/submittals"
            className="font-mono text-[9px] uppercase tracking-[0.07em] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors"
            style={{
              color: !typeFilter ? "var(--text)" : "var(--text-dim)",
              background: !typeFilter ? "rgba(255,255,255,0.07)" : "transparent",
              border: `1px solid ${!typeFilter ? "rgba(255,255,255,0.14)" : "transparent"}`,
            }}
          >
            All
          </Link>
          {typeCounts.map(({ type, _count }) => {
            const isActive = typeFilter === type;
            const href = isActive ? "/submittals" : `/submittals?type=${type}`;
            return (
              <Link
                key={type}
                href={href}
                className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.07em] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors"
                style={{
                  color: isActive ? "var(--text)" : "var(--text-dim)",
                  background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
                  border: `1px solid ${isActive ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <span>{TYPE_LABEL[type] ?? type}</span>
                <span style={{ color: isActive ? "var(--text-soft)" : "rgba(255,255,255,0.22)" }}>{_count.id}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="px-6 py-6">
        <div
          className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
          style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--line)]"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <p className="text-sm font-[700] tracking-[-0.02em]">
              Open Submittals
              {activeTypeLabel && (
                <span className="ml-2 font-mono text-[10px] font-[400] tracking-[0.04em]" style={{ color: "var(--text-dim)" }}>
                  · {activeTypeLabel}
                </span>
              )}
            </p>
            <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{items.length} items</span>
          </div>

          {items.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-[500]" style={{ color: "var(--signal-soft)" }}>All clear</p>
              <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
                {activeTypeLabel
                  ? `No open ${activeTypeLabel} submittals across active projects.`
                  : "No open submittals across active projects."}
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Project", "Submittal", "Type", "Status", "Submit By", "On Site By", ""].map((h, i) => (
                    <th
                      key={i}
                      className="px-5 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)]"
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
                      <td className="px-5 py-3.5" style={{ width: "18%" }}>
                        <Link
                          href={`/bids/${item.bid.id}?tab=submittals`}
                          className="text-[12px] font-[600] transition-colors hover:text-emerald-400 block"
                          style={{ color: "var(--text)" }}
                        >
                          {item.bid.projectName}
                        </Link>
                        {item.bid.location && (
                          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{item.bid.location}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5" style={{ width: "34%" }}>
                        <p className="text-[12px] font-[500] leading-tight" style={{ color: "var(--text)" }}>
                          {item.title}
                        </p>
                        {item.submittalNumber && (
                          <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                            #{item.submittalNumber}
                          </p>
                        )}
                        {item.specSection?.csiNumber && (
                          <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                            {item.specSection.csiNumber}
                            {(item.specSection.csiCanonicalTitle ?? item.specSection.csiTitle)
                              ? ` — ${item.specSection.csiCanonicalTitle ?? item.specSection.csiTitle}`
                              : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5" style={{ width: "9%" }}>
                        <Link
                          href={typeFilter === item.type ? "/submittals" : `/submittals?type=${item.type}`}
                          className="font-mono text-[10px] transition-colors hover:text-white"
                          style={{ color: typeFilter === item.type ? "var(--text-soft)" : "var(--text-dim)" }}
                        >
                          {TYPE_LABEL[item.type] ?? item.type}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5" style={{ width: "12%" }}>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
                          style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
                        >
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5" style={{ width: "11%" }}>
                        <span
                          className="font-mono text-[11px]"
                          style={{ color: submitOverdue ? "#ff968f" : "var(--text-soft)" }}
                        >
                          {fmtDate(item.submitByDate)}
                          {submitOverdue && <span className="ml-1 text-[9px]">▲</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3.5" style={{ width: "11%" }}>
                        <span
                          className="font-mono text-[11px]"
                          style={{ color: onSiteOverdue ? "#ffcc72" : "var(--text-dim)" }}
                        >
                          {fmtDate(item.requiredOnSiteDate ?? item.requiredBy)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right" style={{ width: "5%" }}>
                        <Link
                          href={`/bids/${item.bid.id}?tab=submittals`}
                          className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors whitespace-nowrap"
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
    </div>
  );
}
