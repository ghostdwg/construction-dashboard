// /market-intelligence/corridors — Phase MI-10 corridor heat index

import Link from "next/link";
import { prisma } from "@/lib/prisma";

interface PageProps {
  searchParams: Promise<{ classification?: string; corridor?: string }>;
}

export default async function CorridorsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (sp.corridor) {
    const corridor = await prisma.corridorHeat.findUnique({ where: { corridorKey: sp.corridor } });
    if (!corridor) {
      return (
        <main style={{ padding: 32 }}>
          <p style={{ color: "var(--text-dim)" }}>Corridor not found.</p>
          <Link href="/market-intelligence/corridors">← All corridors</Link>
        </main>
      );
    }
    const memberIds = corridor.memberParcelIds.split(",").filter(Boolean);
    return (
      <main style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
        <Link href="/market-intelligence/corridors" style={{ color: "var(--text-dim)", fontSize: 12, textDecoration: "none" }}>← All corridors</Link>
        <header style={{ margin: "12px 0 16px" }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{corridor.corridorLabel}</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "6px 0 0" }}>
            {corridor.corridorKey} · {corridor.classification}
          </p>
        </header>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <Metric label="Heat" value={corridor.heatScore.toFixed(2)} />
          <Metric label="Mean pressure" value={corridor.meanPressure.toFixed(2)} />
          <Metric label="Acceleration" value={corridor.acceleration.toFixed(2)} />
          <Metric label="Active members" value={String(corridor.activeMembers)} />
        </section>
        <section>
          <h3 style={{ fontSize: 13, color: "var(--signal-soft)", marginBottom: 8 }}>
            Member parcels ({memberIds.length}{corridor.memberSetTruncated ? "+" : ""})
          </h3>
          <ul style={{ columns: 3, fontSize: 12, color: "var(--text-soft)", listStyle: "none", padding: 0 }}>
            {memberIds.slice(0, 60).map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  const where: Record<string, unknown> = {};
  if (sp.classification) where.classification = sp.classification;

  const rows = await prisma.corridorHeat.findMany({
    where,
    orderBy: [{ heatScore: "desc" }, { acceleration: "desc" }],
    take: 200,
  });

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Corridors</h1>
        <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
          Heat scores across active corridors. Click a corridor to view member parcels.
        </p>
      </header>
      <nav style={{ display: "flex", gap: 12, marginBottom: 16, fontSize: 12 }}>
        <Link href="/market-intelligence/corridors" style={{ color: "var(--text-soft)" }}>All</Link>
        {["IGNITING", "HOT", "WARM", "STEADY", "COOLING"].map((c) => (
          <Link key={c} href={`/market-intelligence/corridors?classification=${c}`} style={{ color: "var(--text-soft)" }}>{c}</Link>
        ))}
      </nav>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", color: "var(--text-dim)", fontSize: 11 }}>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Corridor</th>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Classification</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Heat</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Mean pressure</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Accel</th>
            <th style={{ textAlign: "right", padding: "8px 6px" }}>Active</th>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Computed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <td style={{ padding: "8px 6px" }}>
                <Link href={`/market-intelligence/corridors?corridor=${encodeURIComponent(r.corridorKey)}`} style={{ color: "var(--signal-soft)", textDecoration: "none" }}>
                  {r.corridorLabel}
                </Link>
              </td>
              <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{r.classification}</td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.heatScore.toFixed(2)}</td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.meanPressure.toFixed(2)}</td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.acceleration.toFixed(2)}</td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.activeMembers}</td>
              <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>{new Date(r.computedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", padding: "12px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
      <div style={{ fontSize: 22, color: "var(--signal-soft)", marginTop: 4 }}>{value}</div>
    </div>
  );
}
