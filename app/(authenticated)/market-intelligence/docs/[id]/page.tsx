import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AnalysisPanel } from "./AnalysisPanel";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

export default async function SourceDocViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await prisma.marketSourceDoc.findUnique({
    where: { id },
    include: {
      source: { select: { id: true, name: true, jurisdiction: true, sourceType: true } },
      signals: {
        orderBy: { aiRelevanceScore: "desc" },
        select: {
          id: true, headline: true, signalType: true, aiRelevanceScore: true,
          rawText: true, leadId: true, createdAt: true,
        },
      },
      leads: {
        orderBy: { detectedAt: "desc" },
        select: {
          id: true, title: true, status: true, leadType: true,
          aiScore: true, estimatedValue: true, location: true, projectType: true,
          detectedAt: true,
        },
      },
      analyses: {
        orderBy: { requestedAt: "desc" },
        take: 50,
        select: {
          id: true, engine: true, modelName: true, status: true,
          requestedAt: true, startedAt: true, completedAt: true,
          durationMs: true, costUsd: true, signalsCount: true, leadsCount: true,
          errorMessage: true,
        },
      },
    },
  });
  if (!doc) notFound();

  const initialAnalyses = doc.analyses.map((a) => ({
    ...a,
    requestedAt: a.requestedAt.toISOString(),
    startedAt:   a.startedAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
  }));

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 flex flex-col gap-5">
      <div className="flex items-end justify-between border-b border-[var(--line)] pb-4">
        <div className="min-w-0">
          <Link href="/market-intelligence"
            className="font-mono text-[10px] uppercase tracking-[0.08em] mb-2 inline-block hover:opacity-80"
            style={{ color: "var(--text-dim)" }}>
            ← Market Intelligence
          </Link>
          <h1 className="text-[26px] font-[800] tracking-[-0.04em] leading-none truncate" style={{ color: "var(--text)" }}>
            {doc.title || "Untitled document"}
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: "var(--text-soft)" }}>
            {doc.source.name} · {doc.source.jurisdiction} · doc date <strong>{fmtDate(doc.documentDate)}</strong>
          </p>
        </div>
        <div className="shrink-0">
          {doc.docUrlFull && (
            <a href={doc.docUrlFull} target="_blank" rel="noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-2 rounded"
              style={{ background: "var(--signal)", color: "#000", fontWeight: 700 }}>
              View original PDF ↗
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Signals"        value={doc.signals.length} />
        <Stat label="Candidates"     value={doc.leads.length} />
        <Stat label="Chars scanned"  value={doc.charCount.toLocaleString()} />
        <Stat label="Scan cost"      value={`$${doc.costUsd.toFixed(4)}`} />
      </div>

      <p className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
        Scanned {fmtDateTime(doc.scannedAt)}
        {doc.error && <span style={{ color: "var(--red)" }}> · ERROR: {doc.error}</span>}
      </p>

      {/* Emerging projects from this doc */}
      <Section title="Emerging projects detected in this document">
        {doc.leads.length === 0 ? (
          <Empty text="No emerging projects were detected in this document." />
        ) : (
          <div className="flex flex-col">
            {doc.leads.map((l) => (
              <Link key={l.id} href={`/market-intelligence/${l.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-[var(--line)] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-[600] truncate" style={{ color: "var(--text)" }}>{l.title}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                    {l.projectType ?? "—"} · {l.location ?? "—"} · detected {fmtDate(l.detectedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-[10px]" style={{ color: "var(--text)" }}>{fmtMoney(l.estimatedValue ?? null)}</span>
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-soft)" }}>score {l.aiScore ?? "—"}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--text-dim)" }}>{l.status}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* On-demand engine analyses */}
      <Section title="Engine analyses">
        <AnalysisPanel docId={doc.id} initial={initialAnalyses} />
      </Section>

      {/* Signals from this doc */}
      <Section title="All signals from this document">
        {doc.signals.length === 0 ? (
          <Empty text="No signals were extracted from this document." />
        ) : (
          <div className="flex flex-col">
            {doc.signals.map((s) => (
              <div key={s.id} className="px-3 py-2.5 border-b border-[var(--line)] last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-[600] flex-1 min-w-0" style={{ color: "var(--text)" }}>{s.headline}</p>
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-soft)" }}>score {s.aiRelevanceScore ?? "—"}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--text-dim)" }}>{s.signalType}</span>
                </div>
                {s.rawText && (
                  <p className="text-[12px] mt-1" style={{ color: "var(--text-soft)" }}>{s.rawText}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Raw text */}
      <Section title="Full extracted text">
        {doc.rawText ? (
          <details>
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.07em] py-2" style={{ color: "var(--text-dim)" }}>
              {doc.rawText.length.toLocaleString()} chars · click to expand
            </summary>
            <pre className="text-[12px] whitespace-pre-wrap mt-2 px-3 py-3 rounded font-mono"
              style={{ background: "rgba(255,255,255,0.02)", color: "var(--text-soft)", maxHeight: 600, overflow: "auto" }}>
              {doc.rawText}
            </pre>
          </details>
        ) : (
          <Empty text="Raw text was not persisted for this document." />
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] px-4 py-3"
      style={{ background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))" }}>
      <p className="font-mono text-[10px] uppercase tracking-[0.09em] mb-1" style={{ color: "var(--text-dim)" }}>{label}</p>
      <p className="text-[22px] font-[700] tracking-[-0.04em]" style={{ color: "var(--text)" }}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))" }}>
      <div className="px-4 py-3 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-sm font-[700]" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--text-dim)" }}>{text}</div>
  );
}
