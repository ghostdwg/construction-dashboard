import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

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

type Insights = { strengths?: string[]; risks?: string[]; angle?: string };
function parseInsights(raw: string | null): Insights | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Insights; } catch { return null; }
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await prisma.marketLead.findUnique({
    where: { id },
    include: {
      sourceDoc: { select: { id: true, title: true, documentDate: true, docUrl: true } },
    },
  });
  if (!lead) notFound();

  const insights = parseInsights(lead.aiInsights);
  const statusColor =
    lead.status === "PROMOTED" ? "var(--signal)"
    : lead.status === "ARCHIVED" || lead.status === "DISMISSED" ? "var(--text-dim)"
    : "#ffcc72";

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-5">
      <div>
        <Link
          href="/market-intelligence"
          className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100"
        >← Back to Market Intelligence</Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-[700]" style={{ color: "var(--text)" }}>{lead.title}</h1>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.07em]">
          <span
            className="px-2 py-1 rounded-full"
            style={{ color: statusColor, border: `1px solid ${statusColor}`, background: "rgba(255,255,255,0.02)" }}
          >{lead.status}</span>
          <span className="px-2 py-1 rounded-full opacity-80" style={{ border: "1px solid var(--line)" }}>
            confidence {lead.confidence}
          </span>
          {lead.aiScore != null && (
            <span className="px-2 py-1 rounded-full opacity-80" style={{ border: "1px solid var(--line)" }}>
              score {lead.aiScore}
            </span>
          )}
          {lead.leadType && (
            <span className="px-2 py-1 rounded-full opacity-80" style={{ border: "1px solid var(--line)" }}>
              {lead.leadType}
            </span>
          )}
        </div>
      </header>

      <Section title="At a glance">
        <Grid>
          <Field label="Project type" value={lead.projectType} />
          <Field label="Location"     value={lead.location} />
          <Field label="Jurisdiction" value={lead.jurisdiction} />
          <Field label="Est. value"   value={fmtMoney(lead.estimatedValue)} />
          <Field label="Detected"     value={fmtDateTime(lead.detectedAt)} />
          <Field label="Source"       value={lead.source ?? "—"} />
        </Grid>
      </Section>

      {lead.aiSummary && (
        <Section title="AI summary">
          <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
            {lead.aiSummary}
          </p>
        </Section>
      )}

      {insights && (insights.strengths?.length || insights.risks?.length || insights.angle) ? (
        <Section title="AI insights">
          {insights.angle && (
            <p className="text-sm mb-3" style={{ color: "var(--text)" }}>
              <span className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60 mr-2">angle</span>
              {insights.angle}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {insights.strengths?.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60 mb-1">Strengths</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {insights.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            ) : null}
            {insights.risks?.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60 mb-1">Risks</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {insights.risks.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title="Source">
        {lead.sourceDoc ? (
          <div className="flex flex-col gap-1">
            <Link
              href={`/market-intelligence/docs/${lead.sourceDoc.id}`}
              className="text-sm hover:underline"
              style={{ color: "var(--signal)" }}
            >
              ↗ {lead.sourceDoc.title || "(untitled document)"}
              {lead.sourceDoc.documentDate && ` · ${fmtDate(lead.sourceDoc.documentDate)}`}
            </Link>
            {lead.sourceDoc.docUrl && (
              <a
                href={lead.sourceDoc.docUrl}
                target="_blank" rel="noreferrer"
                className="text-[11px] opacity-70 hover:opacity-100 truncate"
                style={{ color: "var(--text-dim)" }}
              >{lead.sourceDoc.docUrl}</a>
            )}
          </div>
        ) : lead.sourceUrl ? (
          <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="text-sm hover:underline" style={{ color: "var(--signal)" }}>
            ↗ {lead.sourceUrl}
          </a>
        ) : (
          <p className="text-sm opacity-60">No source attached.</p>
        )}
      </Section>

      {lead.rawText && (
        <Section title="Raw extract">
          <pre className="text-xs whitespace-pre-wrap leading-relaxed p-3 rounded"
               style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)", color: "var(--text-dim)" }}>
            {lead.rawText.slice(0, 8000)}
            {lead.rawText.length > 8000 && "\n\n… (truncated)"}
          </pre>
        </Section>
      )}

      {lead.notes && (
        <Section title="Notes">
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{lead.notes}</p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60 mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">{label}</span>
      <span className="text-sm" style={{ color: "var(--text)" }}>{value ?? "—"}</span>
    </div>
  );
}
