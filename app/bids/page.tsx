import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewBidButton from "./NewBidButton";

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  draft: { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-600 dark:text-zinc-300" },
  active: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  leveling: { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  submitted: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  awarded: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300" },
  lost: { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-600 dark:text-red-300" },
  cancelled: { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-400 dark:text-zinc-500" },
};

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString();
}

export default async function BidsPage() {
  const bids = await prisma.bid.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      submission: {
        select: {
          submittedAt: true,
          outcome: true,
          ourBidAmount: true,
          winningBidAmount: true,
        },
      },
    },
  });

  // Summary counts
  const counts = {
    active: bids.filter((b) => ["draft", "active", "leveling"].includes(b.status)).length,
    submitted: bids.filter((b) => b.status === "submitted").length,
    awarded: bids.filter((b) => b.status === "awarded").length,
    lost: bids.filter((b) => b.status === "lost").length,
  };
  const winRate = counts.awarded + counts.lost > 0
    ? Math.round((counts.awarded / (counts.awarded + counts.lost)) * 1000) / 10
    : null;

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Bids</h1>
        <NewBidButton />
      </div>

      {/* Summary banner */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <span className="text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold">{counts.active}</span>{" "}
          <span className="text-zinc-500 dark:text-zinc-400">active</span>
        </span>
        <span className="text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold">{counts.submitted}</span>{" "}
          <span className="text-zinc-500 dark:text-zinc-400">submitted</span>
        </span>
        <span className="text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold text-green-700">{counts.awarded}</span>{" "}
          <span className="text-zinc-500 dark:text-zinc-400">won</span>
        </span>
        <span className="text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold text-red-600">{counts.lost}</span>{" "}
          <span className="text-zinc-500 dark:text-zinc-400">lost</span>
        </span>
        {winRate != null && (
          <span className="ml-auto text-zinc-600 dark:text-zinc-300">
            Win rate: <span className="font-semibold">{winRate}%</span>
          </span>
        )}
      </div>

      {bids.length === 0 ? (
        <p className="text-zinc-500 text-sm dark:text-zinc-400">No bids yet.</p>
      ) : (
        <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Due Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Our Bid</th>
                <th className="px-4 py-2.5">Submitted</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {bids.map((bid) => {
                const badge = STATUS_BADGE[bid.status] ?? STATUS_BADGE.draft;
                return (
                  <tr key={bid.id}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/bids/${bid.id}`} className="font-medium text-zinc-800 hover:underline dark:text-zinc-100">
                          {bid.projectName}
                        </Link>
                        {bid.workflowType === "PROJECT" && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 uppercase tracking-wide">
                            Project
                          </span>
                        )}
                      </div>
                      {bid.location && (
                        <div className="text-xs text-zinc-400 dark:text-zinc-500">{bid.location}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {bid.dueDate ? new Date(bid.dueDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${badge.bg} ${badge.text}`}>
                        {bid.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-700 dark:text-zinc-200">
                      {fmtDollar(bid.submission?.ourBidAmount ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {bid.submission?.submittedAt
                        ? new Date(bid.submission.submittedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/bids/${bid.id}?tab=leveling`}
                        className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                      >
                        Level →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
