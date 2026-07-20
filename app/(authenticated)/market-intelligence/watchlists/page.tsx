// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/watchlists — Phase MI-10 watchlist index
//
//  Server component. Lists operator watchlists; click into a list opens its
//  item view at /market-intelligence/watchlists/[id].
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NotActiveV1Banner } from "../NotActiveV1Banner";

interface PageProps {
  searchParams: Promise<{
    visibility?: string;
    includeArchived?: string;
  }>;
}

export default async function WatchlistsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const where: Record<string, unknown> = {};
  if (sp.visibility) where.visibility = sp.visibility;
  if (sp.includeArchived !== "true") where.archivedAt = null;

  const lists = await prisma.watchlist.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { items: true } },
    },
  });

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Watchlists</h1>
        <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
          Operator-curated lists of developers, parcels, corridors, jurisdictions, brokers, franchises,
          utilities, and project types.
        </p>
      </header>

      <NotActiveV1Banner reason="The create/add-item API exists (POST /api/market-intelligence/workspace/watchlists), but no page in the product calls it — there is no in-product way to create a watchlist or add an item to one yet." />

      <nav style={{ display: "flex", gap: 12, marginBottom: 16, fontSize: 12 }}>
        <Link href="/market-intelligence/watchlists" style={{ color: "var(--text-soft)" }}>All</Link>
        <Link href="/market-intelligence/watchlists?visibility=PRIVATE" style={{ color: "var(--text-soft)" }}>Private</Link>
        <Link href="/market-intelligence/watchlists?visibility=TEAM" style={{ color: "var(--text-soft)" }}>Team</Link>
        <Link href="/market-intelligence/watchlists?visibility=ORG" style={{ color: "var(--text-soft)" }}>Org</Link>
        <Link href="/market-intelligence/watchlists?includeArchived=true" style={{ color: "var(--text-dim)" }}>+ archived</Link>
      </nav>

      {lists.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No watchlists yet. Create one via the API.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", color: "var(--text-dim)", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Name</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Subject kind</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Visibility</th>
              <th style={{ textAlign: "right", padding: "8px 6px" }}>Items</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {lists.map((wl) => (
              <tr key={wl.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "8px 6px" }}>
                  <Link href={`/market-intelligence/watchlists/${wl.id}`} style={{ color: "var(--signal-soft)", textDecoration: "none" }}>
                    {wl.name}
                  </Link>
                  {wl.archivedAt && <span style={{ marginLeft: 8, color: "var(--text-dim)", fontSize: 11 }}>archived</span>}
                </td>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{wl.subjectKind}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{wl.visibility}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{wl._count.items}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>{new Date(wl.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
