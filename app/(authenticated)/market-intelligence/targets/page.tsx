// /market-intelligence/targets — Phase MI-10 targeting patterns index

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NotActiveV1Banner } from "../NotActiveV1Banner";

interface PageProps {
  searchParams: Promise<{ kind?: string; active?: string }>;
}

export default async function TargetsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const where: Record<string, unknown> = {};
  if (sp.kind) where.patternKind = sp.kind;
  if (sp.active === "false") where.active = false;
  else where.active = true;

  const patterns = await prisma.targetingPattern.findMany({
    where,
    orderBy: [{ priority: "asc" }, { lastMatchedAt: "desc" }],
    take: 200,
  });

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Targeting patterns</h1>
        <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
          Operator-curated recurrence patterns. Matches fire AlertEvents with full explainability.
        </p>
      </header>

      <NotActiveV1Banner reason="There is no create/register path anywhere in the app or API today — this page can only ever display TargetingPattern rows inserted directly via Prisma." />

      <nav style={{ display: "flex", gap: 12, marginBottom: 16, fontSize: 12, flexWrap: "wrap" }}>
        <Link href="/market-intelligence/targets" style={{ color: "var(--text-soft)" }}>All active</Link>
        <Link href="/market-intelligence/targets?active=false" style={{ color: "var(--text-soft)" }}>Inactive</Link>
        {[
          "DEVELOPER_ENTERS_CORRIDOR",
          "BROKER_PRECEDES_INDUSTRIAL",
          "RECURRING_GC_DEVELOPER",
          "ENTITY_CLUSTER_PRE_PROJECT",
          "FRANCHISE_ROLLOUT",
          "UTILITY_CHAIN",
          "ZONING_CADENCE",
        ].map((k) => (
          <Link key={k} href={`/market-intelligence/targets?kind=${k}`} style={{ color: "var(--text-dim)" }}>{k}</Link>
        ))}
      </nav>

      {patterns.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No targeting patterns registered. Register via the API.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", color: "var(--text-dim)", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Name</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Kind</th>
              <th style={{ textAlign: "right", padding: "8px 6px" }}>Priority</th>
              <th style={{ textAlign: "right", padding: "8px 6px" }}>Matches</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Last matched</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{p.name}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{p.patternKind}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{p.priority}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{p.matchCount}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>
                  {p.lastMatchedAt ? new Date(p.lastMatchedAt).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "8px 6px", color: p.active ? "var(--signal-soft)" : "var(--text-dim)" }}>
                  {p.active ? "yes" : "no"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
