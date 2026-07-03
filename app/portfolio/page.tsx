import Link from "next/link";
import { prisma } from "@/lib/prisma";

const STATUS_STATE: Record<string, { color: string; bg: string; border: string }> = {
  draft:     { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)"  },
  active:    { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  leveling:  { color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"   },
  submitted: { color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)"  },
  awarded:   { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  lost:      { color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"   },
  cancelled: { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.03)",  border: "rgba(255,255,255,0.08)" },
};

// Mirrors the pipeline order encoded in app/bids/page.tsx's quickJump().
const OPEN_ORDER = ["draft", "active", "leveling", "submitted", "awarded"];
const CLOSED_STATUSES = ["lost", "cancelled"];

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString();
}

async function loadBids() {
  return prisma.bid.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      submission: { select: { submittedAt: true, ourBidAmount: true } },
    },
  });
}

type BidRow = Awaited<ReturnType<typeof loadBids>>[number];

function sortByPipeline(bids: BidRow[], order: string[]): BidRow[] {
  return [...bids].sort((a, b) => {
    const ai = order.indexOf(a.status);
    const bi = order.indexOf(b.status);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}

function BidRowLine({ bid }: { bid: BidRow }) {
  const state = STATUS_STATE[bid.status] ?? STATUS_STATE.draft;
  return (
    <tr className="gwx-tr border-b border-[var(--line)] last:border-b-0">
      <td className="px-4 py-3">
        <Link
          href={`/bids/${bid.id}`}
          className="text-[13px] font-[600] transition-colors hover:text-emerald-400"
          style={{ color: "var(--text)" }}
        >
          {bid.projectName}
        </Link>
        {bid.location && (
          <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--text-dim)" }}>
            {bid.location}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center px-2 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] whitespace-nowrap"
          style={{ color: state.color, background: state.bg, border: `1px solid ${state.border}` }}
        >
          {bid.status}
        </span>
      </td>
      <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
        {bid.dueDate ? new Date(bid.dueDate).toLocaleDateString() : "—"}
      </td>
      <td className="px-4 py-3 text-right text-[13px] font-[600]" style={{ color: "var(--text)" }}>
        {fmtDollar(bid.submission?.ourBidAmount ?? null)}
      </td>
    </tr>
  );
}

function GroupTable({ title, bids }: { title: string; bids: BidRow[] }) {
  const open = sortByPipeline(
    bids.filter((b) => !CLOSED_STATUSES.includes(b.status)),
    OPEN_ORDER
  );
  const closed = sortByPipeline(
    bids.filter((b) => CLOSED_STATUSES.includes(b.status)),
    CLOSED_STATUSES
  );

  return (
    <div className="p-6 pt-0">
      <div
        className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
        style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <div>
            <p className="text-sm font-[700] tracking-[-0.02em]">{title}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>{bids.length} total</p>
          </div>
        </div>

        {bids.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-dim)" }}>
            None yet.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Project", "Status", "Due Date", "Our Bid"].map((label) => (
                  <th
                    key={label}
                    className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)] font-[500]"
                    style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {open.map((bid) => (
                <BidRowLine key={bid.id} bid={bid} />
              ))}
              {closed.length > 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-2 font-mono text-[9px] uppercase tracking-[0.09em]"
                    style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                  >
                    Closed
                  </td>
                </tr>
              )}
              {closed.map((bid) => (
                <BidRowLine key={bid.id} bid={bid} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default async function PortfolioPage() {
  const bids = await loadBids();
  const pursuits = bids.filter((b) => b.workflowType === "BID");
  const projects = bids.filter((b) => b.workflowType === "PROJECT");

  return (
    <div>
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // portfolio
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Portfolio
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            {bids.length} total · grouped by workflow
          </p>
        </div>
      </div>

      <GroupTable title="Pursuits" bids={pursuits} />
      <GroupTable title="Active Projects" bids={projects} />
    </div>
  );
}
