import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function LevelingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) notFound();

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      bidTrades: {
        include: { trade: true },
        orderBy: { id: "asc" },
      },
      selections: {
        include: {
          subcontractor: {
            include: {
              contacts: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!bid) notFound();

  // Group selections by tradeId for quick lookup
  const selectionsByTrade = new Map<
    number,
    typeof bid.selections
  >();
  for (const sel of bid.selections) {
    const tradeId = sel.tradeId ?? -1;
    if (!selectionsByTrade.has(tradeId)) {
      selectionsByTrade.set(tradeId, []);
    }
    selectionsByTrade.get(tradeId)!.push(sel);
  }

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="mb-6">
        <Link href="/bids" className="text-sm text-zinc-500 hover:underline">
          ← Back to Bids
        </Link>
        <h1 className="text-2xl font-semibold mt-2">{bid.projectName}</h1>
        <div className="flex gap-4 mt-1 text-sm text-zinc-500">
          {bid.location && <span>{bid.location}</span>}
          {bid.dueDate && (
            <span>Due: {new Date(bid.dueDate).toLocaleDateString()}</span>
          )}
          <span className="capitalize">{bid.status}</span>
        </div>
      </div>

      {bid.bidTrades.length === 0 ? (
        <p className="text-sm text-zinc-500">No trades assigned to this bid.</p>
      ) : (
        <div className="flex flex-col gap-10">
          {bid.bidTrades.map(({ trade, scopeNotes }) => {
            const subs = selectionsByTrade.get(trade.id) ?? [];

            return (
              <div key={trade.id}>
                <div className="mb-3">
                  <h2 className="text-lg font-semibold">{trade.name}</h2>
                  <div className="flex gap-3 text-xs text-zinc-400 mt-0.5">
                    {trade.costCode && <span>Cost Code: {trade.costCode}</span>}
                    {trade.csiCode && <span>CSI: {trade.csiCode}</span>}
                  </div>
                  {scopeNotes && (
                    <p className="text-sm text-zinc-500 mt-1">{scopeNotes}</p>
                  )}
                </div>

                {subs.length === 0 ? (
                  <p className="text-sm text-zinc-400">No subcontractors invited for this trade.</p>
                ) : (
                  <table className="w-full border border-zinc-200 rounded-md text-sm">
                    <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2 border-b border-zinc-200">Company</th>
                        <th className="px-4 py-2 border-b border-zinc-200">Contact</th>
                        <th className="px-4 py-2 border-b border-zinc-200">Phone</th>
                        <th className="px-4 py-2 border-b border-zinc-200">Tags</th>
                        <th className="px-4 py-2 border-b border-zinc-200">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map((sel) => {
                        const sub = sel.subcontractor;
                        const contact = sub.contacts[0] ?? null;
                        return (
                          <tr key={sel.id} className="hover:bg-zinc-50">
                            <td className="px-4 py-2 border-b border-zinc-100 font-medium">
                              {sub.company}
                              {sub.office && (
                                <span className="block text-xs text-zinc-400 font-normal">
                                  {sub.office}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 border-b border-zinc-100 text-zinc-600">
                              {contact ? (
                                <>
                                  <span>{contact.name}</span>
                                  {contact.email && (
                                    <span className="block text-xs text-zinc-400">
                                      {contact.email}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-zinc-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 border-b border-zinc-100 text-zinc-500">
                              {contact?.phone ?? "—"}
                            </td>
                            <td className="px-4 py-2 border-b border-zinc-100">
                              <div className="flex gap-1 flex-wrap">
                                {sub.isUnion && (
                                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                                    Union
                                  </span>
                                )}
                                {sub.isMWBE && (
                                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                                    MWBE
                                  </span>
                                )}
                                {!sub.isUnion && !sub.isMWBE && (
                                  <span className="text-zinc-400">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 border-b border-zinc-100">
                              <span
                                className={`text-xs font-medium capitalize ${
                                  sub.status === "preferred"
                                    ? "text-green-700"
                                    : sub.status === "inactive"
                                    ? "text-zinc-400"
                                    : "text-zinc-600"
                                }`}
                              >
                                {sub.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
