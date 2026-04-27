import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewBidButton from "./NewBidButton";

const STATUS_STATE: Record<string, { color: string; bg: string; border: string }> = {
  draft:     { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)"  },
  active:    { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  leveling:  { color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"   },
  submitted: { color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)"  },
  awarded:   { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  lost:      { color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"   },
  cancelled: { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.03)",  border: "rgba(255,255,255,0.08)" },
};

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString();
}

function quickJump(status: string, workflowType: string | null): { tab: string; label: string } | null {
  if (workflowType === "PROJECT") return { tab: "submittals", label: "SUBMITTALS" };
  if (status === "draft" || status === "active") return { tab: "subs",     label: "SUBS"     };
  if (status === "leveling")                     return { tab: "leveling", label: "LEVELING" };
  if (status === "awarded")                      return { tab: "handoff",  label: "HANDOFF"  };
  return null;
}

function MetricCard({
  label, value, sub, accent,
}: {
  label: string; value: number | string; sub: string;
  accent: "signal" | "amber" | "red" | "blue";
}) {
  const accentColor = { signal: "var(--signal)", amber: "var(--amber)", red: "var(--red)", blue: "var(--blue)" }[accent];
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

export default async function BidsPage() {
  const bids = await prisma.bid.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      submission: { select: { submittedAt: true, outcome: true, ourBidAmount: true, winningBidAmount: true } },
    },
  });

  const counts = {
    active:    bids.filter((b) => ["draft", "active", "leveling"].includes(b.status)).length,
    submitted: bids.filter((b) => b.status === "submitted").length,
    awarded:   bids.filter((b) => b.status === "awarded").length,
    lost:      bids.filter((b) => b.status === "lost").length,
  };
  const winRate = counts.awarded + counts.lost > 0
    ? Math.round((counts.awarded / (counts.awarded + counts.lost)) * 1000) / 10
    : null;

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // projects
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Projects
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            {bids.length} total · pursuit + construction workflows
          </p>
        </div>
        <NewBidButton />
      </div>

      {/* ── Metric cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 p-6 pb-0">
        <MetricCard accent="signal" label="In Pursuit"  value={counts.active}    sub="draft · active · leveling" />
        <MetricCard accent="blue"   label="Submitted"   value={counts.submitted} sub="awaiting decision" />
        <MetricCard accent="signal" label="Awarded"     value={counts.awarded}   sub="won projects" />
        <MetricCard accent="red"    label="Lost"        value={counts.lost}
          sub={winRate != null ? `${winRate}% win rate` : "no closed bids yet"} />
      </div>

      {/* ── Projects table ──────────────────────────────────────────────── */}
      <div className="p-6">
        <div
          className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
          style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
        >
          <div
            className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <div>
              <p className="text-sm font-[700] tracking-[-0.02em]">All Projects</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>{bids.length} total</p>
            </div>
          </div>

          {bids.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-dim)" }}>
              No projects yet.
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {[
                    { label: "Project",   cls: "" },
                    { label: "Due Date",  cls: "" },
                    { label: "Status",    cls: "" },
                    { label: "Our Bid",   cls: "text-right" },
                    { label: "Submitted", cls: "" },
                    { label: "",          cls: "" },
                  ].map(({ label, cls }, i) => (
                    <th
                      key={i}
                      className={`px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)] font-[500] ${cls}`}
                      style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bids.map((bid) => {
                  const state = STATUS_STATE[bid.status] ?? STATUS_STATE.draft;
                  const jump  = quickJump(bid.status, bid.workflowType ?? null);
                  return (
                    <tr
                      key={bid.id}
                      className="gwx-tr border-b border-[var(--line)] last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/bids/${bid.id}`}
                            className="text-[13px] font-[600] transition-colors hover:text-emerald-400"
                            style={{ color: "var(--text)" }}
                          >
                            {bid.projectName}
                          </Link>
                          {bid.workflowType === "PROJECT" && (
                            <span
                              className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
                              style={{ background: "var(--signal-dim)", color: "var(--signal-soft)", border: "1px solid rgba(0,255,100,0.22)" }}
                            >
                              Project
                            </span>
                          )}
                        </div>
                        {bid.location && (
                          <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--text-dim)" }}>
                            {bid.location}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                        {bid.dueDate ? new Date(bid.dueDate).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center px-2 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] whitespace-nowrap"
                          style={{ color: state.color, background: state.bg, border: `1px solid ${state.border}` }}
                        >
                          {bid.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-[600]" style={{ color: "var(--text)" }}>
                        {fmtDollar(bid.submission?.ourBidAmount ?? null)}
                      </td>
                      <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                        {bid.submission?.submittedAt
                          ? new Date(bid.submission.submittedAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {jump && (
                            <Link
                              href={`/bids/${bid.id}?tab=${jump.tab}`}
                              className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                              style={{ border: "1px solid rgba(0,255,100,0.28)", color: "var(--signal-soft)", background: "var(--signal-dim)" }}
                            >
                              {jump.label} →
                            </Link>
                          )}
                          <Link
                            href={`/bids/${bid.id}`}
                            className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors"
                            style={{ border: "1px solid var(--line)" }}
                          >
                            Open
                          </Link>
                        </div>
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
