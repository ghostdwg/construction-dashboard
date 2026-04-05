import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import AddContactForm from "./AddContactForm";
import SubIntelligencePanel from "./SubIntelligencePanel";

export default async function SubcontractorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const subId = parseInt(id, 10);

  if (isNaN(subId)) notFound();

  const sub = await prisma.subcontractor.findUnique({
    where: { id: subId },
    include: {
      subTrades: { include: { trade: true }, orderBy: { id: "asc" } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
    },
  });

  if (!sub) notFound();

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="mb-6">
        <Link href="/subcontractors" className="text-sm text-zinc-500 hover:underline">
          ← Subcontractors
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-semibold">{sub.company}</h1>
            {sub.office && (
              <p className="text-sm text-zinc-500 mt-0.5">{sub.office}</p>
            )}
          </div>
          <span
            className={`mt-1 rounded-full px-3 py-1 text-xs font-medium capitalize ${
              sub.status === "preferred"
                ? "bg-green-100 text-green-700"
                : sub.status === "inactive"
                ? "bg-zinc-100 text-zinc-400"
                : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {sub.status}
          </span>
        </div>
        <div className="flex gap-2 mt-2">
          {sub.isUnion && (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
              Union
            </span>
          )}
          {sub.isMWBE && (
            <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
              MWBE
            </span>
          )}
        </div>
        {sub.notes && (
          <p className="text-sm text-zinc-500 mt-3 border-l-2 border-zinc-200 pl-3">
            {sub.notes}
          </p>
        )}
      </div>

      {/* Intelligence */}
      <SubIntelligencePanel
        subId={sub.id}
        initialTier={sub.tier}
        initialProjectTypes={sub.projectTypes}
        initialRegion={sub.region ?? null}
        initialInternalNotes={sub.internalNotes ?? null}
        initialDoNotUse={sub.doNotUse}
        initialDoNotUseReason={sub.doNotUseReason ?? null}
      />

      {/* Trades */}
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-3">Trades</h2>
        {sub.subTrades.length === 0 ? (
          <p className="text-sm text-zinc-400">No trades assigned.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sub.subTrades.map((st) => (
              <span
                key={st.id}
                className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
              >
                {st.trade.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Contacts */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Contacts</h2>
          <AddContactForm subId={sub.id} />
        </div>

        {sub.contacts.length === 0 ? (
          <p className="text-sm text-zinc-400">No contacts yet.</p>
        ) : (
          <div className="border border-zinc-200 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 border-b border-zinc-200">Name</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Title</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Email</th>
                  <th className="px-4 py-3 border-b border-zinc-200">Phone</th>
                </tr>
              </thead>
              <tbody>
                {sub.contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-medium">
                      {c.name}
                      {c.isPrimary && (
                        <span className="ml-2 text-xs text-zinc-400 font-normal">
                          primary
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{c.title ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-500">
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="hover:underline text-zinc-700"
                        >
                          {c.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{c.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
