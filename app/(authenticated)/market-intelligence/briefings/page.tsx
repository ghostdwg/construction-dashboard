// /market-intelligence/briefings — Phase MI-10 briefing index

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NotActiveV1Banner } from "../NotActiveV1Banner";

interface PageProps {
  searchParams: Promise<{ kind?: string; status?: string; id?: string }>;
}

export default async function BriefingsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (sp.id) {
    const doc = await prisma.briefingDocument.findUnique({
      where: { id: sp.id },
      include: { sections: { orderBy: { position: "asc" } } },
    });
    if (!doc) {
      return (
        <main style={{ padding: 32 }}>
          <p style={{ color: "var(--text-dim)" }}>Briefing not found.</p>
          <Link href="/market-intelligence/briefings">← All briefings</Link>
        </main>
      );
    }
    return (
      <main style={{ padding: "24px 32px", maxWidth: 900, margin: "0 auto" }}>
        <Link href="/market-intelligence/briefings" style={{ color: "var(--text-dim)", fontSize: 12, textDecoration: "none" }}>← All briefings</Link>
        <NotActiveV1Banner reason="Briefing generation exists only as a backend API (POST /api/market-intelligence/workspace/briefings) — there is no in-product UI to trigger a new briefing yet." />
        <header style={{ margin: "12px 0 16px" }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{doc.briefingKind} · {doc.status}</span>
          <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>{doc.title}</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "8px 0 0" }}>
            Window: {doc.windowStart.toISOString().slice(0, 10)} → {doc.windowEnd.toISOString().slice(0, 10)}
          </p>
          {doc.summary && <p style={{ margin: "12px 0 0", color: "var(--text-soft)" }}>{doc.summary}</p>}
        </header>
        {doc.sections.map((sec) => (
          <section key={sec.id} style={{ marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            {sec.title && <h2 style={{ fontSize: 15, color: "var(--signal-soft)" }}>{sec.title}</h2>}
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: 0, color: "var(--text-soft)" }}>{sec.body}</pre>
          </section>
        ))}
      </main>
    );
  }

  const where: Record<string, unknown> = {};
  if (sp.kind) where.briefingKind = sp.kind;
  if (sp.status) where.status = sp.status;

  const docs = await prisma.briefingDocument.findMany({
    where,
    orderBy: { generatedAt: "desc" },
    take: 100,
  });

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Briefings</h1>
        <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
          Operator briefings — corridor summaries, weekly emergence reports, jurisdiction heat, developer
          movement, forecast changes.
        </p>
      </header>

      <NotActiveV1Banner reason="Briefing generation exists only as a backend API (POST /api/market-intelligence/workspace/briefings) — there is no in-product UI to trigger a new briefing yet." />

      {docs.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No briefings yet. Generate one via the API.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", color: "var(--text-dim)", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Title</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Kind</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Status</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Window</th>
              <th style={{ textAlign: "left", padding: "8px 6px" }}>Generated</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "8px 6px" }}>
                  <Link href={`/market-intelligence/briefings?id=${doc.id}`} style={{ color: "var(--signal-soft)", textDecoration: "none" }}>{doc.title}</Link>
                </td>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{doc.briefingKind}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-soft)" }}>{doc.status}</td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>
                  {doc.windowStart.toISOString().slice(0, 10)} → {doc.windowEnd.toISOString().slice(0, 10)}
                </td>
                <td style={{ padding: "8px 6px", color: "var(--text-dim)" }}>{doc.generatedAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
