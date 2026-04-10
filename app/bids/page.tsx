import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewBidButton from "./NewBidButton";

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  draft: { bg: "bg-zinc-100", text: "text-zinc-600" },
  active: { bg: "bg-blue-100", text: "text-blue-700" },
  leveling: { bg: "bg-purple-100", text: "text-purple-700" },
  submitted: { bg: "bg-amber-100", text: "text-amber-700" },
  awarded: { bg: "bg-green-100", text: "text-green-700" },
  lost: { bg: "bg-red-100", text: "text-red-600" },
  cancelled: { bg: "bg-zinc-100", text: "text-zinc-400" },
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
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-zinc-700">
          <span className="font-semibold">{counts.active}</span>{" "}
          <span className="text-zinc-500">active</span>
        </span>
        <span className="text-zinc-700">
          <span className="font-semibold">{counts.submitted}</span>{" "}
          <span className="text-zinc-500">submitted</span>
        </span>
        <span className="text-zinc-700">
          <span className="font-semibold text-green-700">{counts.awarded}</span>{" "}
          <span className="text-zinc-500">won</span>
        </span>
        <span className="text-zinc-700">
          <span className="font-semibold text-red-600">{counts.lost}</span>{" "}
          <span className="text-zinc-500">lost</span>
        </span>
        {winRate != null && (
          <span className="ml-auto text-zinc-600">
            Win rate: <span className="font-semibold">{winRate}%</span>
          </span>
        )}
      </div>

      {bids.length === 0 ? (
        <p className="text-zinc-500 text-sm">No bids yet.</p>
      ) : (
        <div className="rounded-md border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Due Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Our Bid</th>
                <th className="px-4 py-2.5">Submitted</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {bids.map((bid) => {
                const badge = STATUS_BADGE[bid.status] ?? STATUS_BADGE.draft;
                return (
                  <tr key={bid.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/bids/${bid.id}`} className="font-medium text-zinc-800 hover:underline">
                        {bid.projectName}
                      </Link>
                      {bid.location && (
                        <div className="text-xs text-zinc-400">{bid.location}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {bid.dueDate ? new Date(bid.dueDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${badge.bg} ${badge.text}`}>
                        {bid.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-700">
                      {fmtDollar(bid.submission?.ourBidAmount ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {bid.submission?.submittedAt
                        ? new Date(bid.submission.submittedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/bids/${bid.id}/leveling`}
                        className="text-xs text-zinc-500 hover:underline"
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
