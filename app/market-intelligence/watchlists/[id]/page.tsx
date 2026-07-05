// /market-intelligence/watchlists/[id] — Phase MI-10 watchlist detail

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NotActiveV1Banner } from "../../NotActiveV1Banner";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WatchlistDetailPage({ params }: PageProps) {
  const { id } = await params;
  const wl = await prisma.watchlist.findUnique({
    where: { id },
    include: {
      items: {
        where: { detachedAt: null },
        orderBy: [{ priority: "asc" }, { addedAt: "desc" }],
      },
    },
  });

  if (!wl) {
    return (
      <main style={{ padding: 32 }}>
        <p style={{ color: "var(--text-dim)" }}>Watchlist not found.</p>
        <Link href="/market-intelligence/watchlists">← Back to watchlists</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <Link href="/market-intelligence/watchlists" style={{ color: "var(--text-dim)", fontSize: 12, textDecoration: "none" }}>← Watchlists</Link>
      <NotActiveV1Banner reason="There is no in-product way to add or remove items on this list yet — the underlying API is real, but nothing in the UI calls it." />
      <header style={{ margin: "12px 0 24px" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{wl.name}</h1>
        <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
          {wl.subjectKind} · {wl.visibility} · {wl.items.length} items
        </p>
        {wl.description && <p style={{ marginTop: 8 }}>{wl.description}</p>}
        {wl.tagsCsv && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
            tags: {wl.tagsCsv}
          </div>
        )}
      </header>

      {wl.items.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No items in this watchlist.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", color: "var(--text-dim)", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Subject</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Kind</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Context</th>
              <th style={{ textAlign: "right", padding: "8px 6px" }}>Priority</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Reason</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Added</th>
            </tr>
          </thead>
          <tbody>
            {wl.items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "8px 6px" }}>
                  {item.projectId ? (
                    <Link href={`/market-intelligence/projects/${item.projectId}`} style={{ color: "var(--signal-soft)", textDecoration: "none" }}>
                      {item.displayLabel ?? item.subjectId.slice(0, 12)}
                    </Link>
                  ) : (
                    <span>{item.displayLabel ?? item.subjectId.slice(0, 12)}</span>
                  )}
                </td>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{item.subjectKind}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>{item.displayContext ?? "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{item.priority}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>{item.attachReason}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>{new Date(item.addedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
