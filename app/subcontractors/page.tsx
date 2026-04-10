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
        <Link
          href="/subcontractors/import"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-500 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Import CSV
        </Link>
      </div>

      <div className="mb-5">
        <Suspense fallback={<div className="h-10" />}>
          <SubcontractorFilters trades={trades} />
        </Suspense>
      </div>

      {subs.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No subcontractors found.</p>
      ) : (
        <div className="border border-zinc-200 rounded-md overflow-hidden dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Company</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Trades</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Primary Contact</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Tags</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Tier</th>
                <th className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((sub) => {
                const contact = sub.contacts[0] ?? null;
                return (
                  <tr key={sub.id} className="hover:bg-zinc-50 border-b border-zinc-100 last:border-0 dark:hover:bg-zinc-800 dark:border-zinc-800">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {sub.isPreferred && (
                          <span title="Preferred (internal only)" className="text-amber-600 text-sm leading-none">★</span>
                        )}
                        <Link
                          href={`/subcontractors/${sub.id}`}
                          className="font-medium hover:underline"
                        >
                          {sub.company}
                        </Link>
                      </div>
                      {sub.office && (
                        <span className="block text-xs text-zinc-400 dark:text-zinc-500">{sub.office}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {sub.subTrades.length === 0 ? (
                          <span className="text-zinc-400 dark:text-zinc-500">—</span>
                        ) : (
                          sub.subTrades.map((st) => (
                            <span
                              key={st.id}
                              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                              {st.trade.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                      {contact ? (
                        <>
                          <span>{contact.name}</span>
                          {contact.email && (
                            <span className="block text-xs text-zinc-400 dark:text-zinc-500">{contact.email}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {sub.isUnion && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            Union
                          </span>
                        )}
                        {sub.isMWBE && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                            MWBE
                          </span>
                        )}
                        {sub.doNotUse && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            DNU
                          </span>
                        )}
                        {!sub.isUnion && !sub.isMWBE && !sub.doNotUse && (
                          <span className="text-zinc-400 dark:text-zinc-500">—</span>
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
