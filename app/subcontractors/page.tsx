import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import SubcontractorFilters from "./SubcontractorFilters";
import { TierBadge } from "./[id]/SubIntelligencePanel";

type SearchParams = Promise<{ search?: string; tradeId?: string; status?: string; tier?: string }>;

export default async function SubcontractorsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { search = "", tradeId, status, tier } = await searchParams;

  const [subs, trades] = await Promise.all([
    prisma.subcontractor.findMany({
      where: {
        ...(search ? { company: { contains: search } } : {}),
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(tradeId
          ? { subTrades: { some: { tradeId: parseInt(tradeId, 10) } } }
          : {}),
      },
      include: {
        subTrades: { include: { trade: true } },
        contacts: { where: { isPrimary: true }, take: 1 },
      },
      orderBy: { company: "asc" },
    }),
    prisma.trade.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Subcontractors</h1>
      </div>

      <div className="mb-5">
        <Suspense fallback={<div className="h-10" />}>
          <SubcontractorFilters trades={trades} />
        </Suspense>
      </div>

      {subs.length === 0 ? (
        <p className="text-sm text-zinc-500">No subcontractors found.</p>
      ) : (
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 border-b border-zinc-200">Company</th>
                <th className="px-4 py-3 border-b border-zinc-200">Trades</th>
                <th className="px-4 py-3 border-b border-zinc-200">Primary Contact</th>
                <th className="px-4 py-3 border-b border-zinc-200">Tags</th>
                <th className="px-4 py-3 border-b border-zinc-200">Tier</th>
                <th className="px-4 py-3 border-b border-zinc-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((sub) => {
                const contact = sub.contacts[0] ?? null;
                return (
                  <tr key={sub.id} className="hover:bg-zinc-50 border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/subcontractors/${sub.id}`}
                        className="font-medium hover:underline"
                      >
                        {sub.company}
                      </Link>
                      {sub.office && (
                        <span className="block text-xs text-zinc-400">{sub.office}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {sub.subTrades.length === 0 ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          sub.subTrades.map((st) => (
                            <span
                              key={st.id}
                              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                            >
                              {st.trade.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {contact ? (
                        <>
                          <span>{contact.name}</span>
                          {contact.email && (
                            <span className="block text-xs text-zinc-400">{contact.email}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
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
                        {sub.doNotUse && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                            DNU
                          </span>
                        )}
                        {!sub.isUnion && !sub.isMWBE && !sub.doNotUse && (
                          <span className="text-zinc-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TierBadge tier={sub.tier} />
                    </td>
                    <td className="px-4 py-3">
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
        </div>
      )}
    </div>
  );
}
