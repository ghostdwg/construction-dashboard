// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/entities/[id]  — entity profile (Phase MI-4)
//
//  Server component. The intelligence-trust surface: every section answers
//  the question "Why does the system believe this?".
//
//  Sections:
//    Header              canonical name + type + status + confidence chips
//    Provenance          where this entity came from + resolver attribution
//    Aliases             alternate names + their source + remove button
//    Counterparty hist   top recurring partners (THE watchlist test #4 surface)
//    Relationships       full list with per-row provenance / source / legacy edge
//    Related signals     EntityRelationship rows with signalId pointing at sigs
//    Related leads       EntityRelationship rows with leadId pointing at leads
//    Legacy edges        RelationshipEdge rows where this entity appears
//    Actions             Verify · Reject · Merge · Add alias
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConfidenceChip, EntityTypeChip, ReviewStatusChip } from "../chips";
import EntityActions from "../EntityActions";
import AliasDelete from "../AliasDelete";

interface PageProps {
  params: Promise<{ id: string }>;
}

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
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

export default async function EntityProfilePage({ params }: PageProps) {
  const { id } = await params;
  const entity = await prisma.entity.findUnique({
    where: { id },
    include: { aliases: { orderBy: { createdAt: "asc" } } },
  });
  if (!entity) notFound();

  const [outgoing, incoming, legacyEdges] = await Promise.all([
    prisma.entityRelationship.findMany({
      where: { fromEntityId: id },
      include: { toEntity: { select: { id: true, canonicalName: true, entityType: true } } },
      orderBy: [{ projectYear: "desc" }, { lastObservedAt: "desc" }],
      take: 200,
    }),
    prisma.entityRelationship.findMany({
      where: { toEntityId: id },
      include: { fromEntity: { select: { id: true, canonicalName: true, entityType: true } } },
      orderBy: [{ projectYear: "desc" }, { lastObservedAt: "desc" }],
      take: 200,
    }),
    prisma.relationshipEdge.findMany({
      where: { OR: [{ fromEntityId: id }, { toEntityId: id }] },
      orderBy: [{ projectYear: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]);

  // Counterparty histogram
  const partners = new Map<
    string,
    { id: string; canonicalName: string; entityType: string; count: number; relationshipTypes: Set<string> }
  >();
  for (const r of outgoing) {
    const e = r.toEntity;
    if (!e) continue;
    const cur = partners.get(e.id) ?? { ...e, count: 0, relationshipTypes: new Set<string>() };
    cur.count += 1;
    cur.relationshipTypes.add(r.relationshipType);
    partners.set(e.id, cur);
  }
  for (const r of incoming) {
    const e = r.fromEntity;
    if (!e) continue;
    const cur = partners.get(e.id) ?? { ...e, count: 0, relationshipTypes: new Set<string>() };
    cur.count += 1;
    cur.relationshipTypes.add(r.relationshipType);
    partners.set(e.id, cur);
  }
  const topPartners = [...partners.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  // Linked signals / leads via relationship pointers
  const relsWithSignal = [...outgoing, ...incoming].filter((r) => r.signalId);
  const relsWithLead = [...outgoing, ...incoming].filter((r) => r.leadId);
  const signalIds = [...new Set(relsWithSignal.map((r) => r.signalId!))];
  const leadIds = [...new Set(relsWithLead.map((r) => r.leadId!))];
  const [signals, leads] = await Promise.all([
    signalIds.length > 0
      ? prisma.marketSignal.findMany({
          where: { id: { in: signalIds } },
          select: { id: true, headline: true, signalType: true, sourceDate: true },
          orderBy: { sourceDate: "desc" },
        })
      : Promise.resolve([] as Array<{ id: string; headline: string; signalType: string; sourceDate: Date | null }>),
    leadIds.length > 0
      ? prisma.marketLead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, title: true, status: true, leadType: true, detectedAt: true },
          orderBy: { detectedAt: "desc" },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; status: string; leadType: string; detectedAt: Date }>),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/market-intelligence/entities"
          className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100"
        >
          ← Back to entities
        </Link>
        <div className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-40">
          id: {entity.id}
        </div>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-[700]" style={{ color: "var(--text)" }}>
          {entity.canonicalName}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <EntityTypeChip entityType={entity.entityType} />
          <ReviewStatusChip status={entity.reviewStatus} />
          <ConfidenceChip confidence={entity.confidence} />
        </div>
      </header>

      {/* Actions */}
      <Section title="Actions">
        <EntityActions
          entityId={entity.id}
          canonicalName={entity.canonicalName}
          reviewStatus={entity.reviewStatus}
        />
      </Section>

      {/* Provenance — the explainability core */}
      <Section title="Provenance · why we know this entity">
        <Grid>
          <Field label="Normalized name" value={entity.normalizedName} mono />
          <Field label="Created via" value={entity.source ?? "—"} mono />
          <Field label="Created at" value={fmtDateTime(entity.createdAt)} />
          <Field label="Last updated" value={fmtDateTime(entity.updatedAt)} />
        </Grid>
        {entity.notes && (
          <div className="mt-2 p-2 rounded-md font-mono text-[11px] whitespace-pre-wrap" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)" }}>
            {entity.notes}
          </div>
        )}
      </Section>

      {/* Aliases */}
      <Section title={`Aliases (${entity.aliases.length})`}>
        {entity.aliases.length === 0 ? (
          <div className="opacity-50 text-[12px]">No aliases recorded yet. Operator can add via &quot;Add alias&quot; above.</div>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {entity.aliases.map((a) => (
              <li
                key={a.id}
                className="px-2 py-1 rounded-md flex items-center gap-2"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}
              >
                <span style={{ color: "var(--text)" }}>{a.alias}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-50">{a.normalizedAlias}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-50" title="source">
                  · {a.source ?? "?"}
                </span>
                <AliasDelete entityId={entity.id} aliasId={a.id} aliasLabel={a.alias} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Counterparty histogram — the relationship-intelligence surface */}
      <Section title={`Recurring counterparties (top ${topPartners.length})`}>
        {topPartners.length === 0 ? (
          <div className="opacity-50 text-[12px]">No recurring partners yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {topPartners.map((p) => (
              <li
                key={p.id}
                className="p-2 rounded-md flex items-center justify-between gap-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <Link
                  href={`/market-intelligence/entities/${p.id}`}
                  className="hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {p.canonicalName}
                </Link>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">
                  <EntityTypeChip entityType={p.entityType} />
                  <span>{[...p.relationshipTypes].join(" · ")}</span>
                  <span style={{ color: "var(--signal-soft)" }}>×{p.count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Outgoing relationships */}
      <Section title={`Outgoing relationships (${outgoing.length})`}>
        {outgoing.length === 0 ? (
          <div className="opacity-50 text-[12px]">None.</div>
        ) : (
          <RelationshipList rows={outgoing.map((r) => ({
            relId: r.id,
            otherEntityId: r.toEntity?.id ?? null,
            otherCanonicalName: r.toEntity?.canonicalName ?? "(unknown)",
            otherEntityType: r.toEntity?.entityType ?? "Unknown",
            relationshipType: r.relationshipType,
            projectName: r.projectName,
            projectYear: r.projectYear,
            projectValue: r.projectValue,
            source: r.source,
            sourceUrl: r.sourceUrl,
            confidence: r.confidence,
            reviewStatus: r.reviewStatus,
            firstObservedAt: r.firstObservedAt,
            lastObservedAt: r.lastObservedAt,
            legacyEdgeId: r.legacyEdgeId,
          }))} />
        )}
      </Section>

      {/* Incoming relationships */}
      <Section title={`Incoming relationships (${incoming.length})`}>
        {incoming.length === 0 ? (
          <div className="opacity-50 text-[12px]">None.</div>
        ) : (
          <RelationshipList rows={incoming.map((r) => ({
            relId: r.id,
            otherEntityId: r.fromEntity?.id ?? null,
            otherCanonicalName: r.fromEntity?.canonicalName ?? "(unknown)",
            otherEntityType: r.fromEntity?.entityType ?? "Unknown",
            relationshipType: r.relationshipType,
            projectName: r.projectName,
            projectYear: r.projectYear,
            projectValue: r.projectValue,
            source: r.source,
            sourceUrl: r.sourceUrl,
            confidence: r.confidence,
            reviewStatus: r.reviewStatus,
            firstObservedAt: r.firstObservedAt,
            lastObservedAt: r.lastObservedAt,
            legacyEdgeId: r.legacyEdgeId,
          }))} reverseArrow />
        )}
      </Section>

      {/* Linked signals */}
      {signals.length > 0 && (
        <Section title={`Linked signals (${signals.length})`}>
          <ul className="flex flex-col gap-1">
            {signals.map((s) => (
              <li
                key={s.id}
                className="p-2 rounded-md flex items-center justify-between gap-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <span style={{ color: "var(--text)" }}>{s.headline}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70">
                  {s.signalType} · {fmtDate(s.sourceDate)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Linked leads */}
      {leads.length > 0 && (
        <Section title={`Linked leads (${leads.length})`}>
          <ul className="flex flex-col gap-1">
            {leads.map((l) => (
              <li
                key={l.id}
                className="p-2 rounded-md flex items-center justify-between gap-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <Link
                  href={`/market-intelligence/${l.id}`}
                  className="hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {l.title}
                </Link>
                <span className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70">
                  {l.status} · {l.leadType} · {fmtDate(l.detectedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Legacy RelationshipEdge surfacing — provenance to historical free-text */}
      {legacyEdges.length > 0 && (
        <Section title={`Legacy RelationshipEdge rows (${legacyEdges.length})`}>
          <div className="opacity-60 text-[11px] mb-2">
            Historical free-text records that the resolver attached to this entity.
            Each preserves the original fromName / toName so the original signal lineage is never lost.
          </div>
          <ul className="flex flex-col gap-1">
            {legacyEdges.map((e) => (
              <li
                key={e.id}
                className="p-2 rounded-md font-mono text-[11px] flex items-center justify-between gap-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <span style={{ color: "var(--text-soft)" }}>
                  {e.fromName} <span className="opacity-50">[{e.fromType}]</span>{" "}
                  → {e.toName} <span className="opacity-50">[{e.toType}]</span>
                </span>
                <span className="opacity-70">
                  {e.relationshipType}
                  {e.projectName ? ` · ${e.projectName}` : ""}
                  {e.projectYear ? ` · ${e.projectYear}` : ""}
                  {e.resolverVersion ? ` · resolver ${e.resolverVersion}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-50">{label}</span>
      <span className={mono ? "font-mono text-[12px]" : "text-[13px]"} style={{ color: "var(--text)" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

interface RelRow {
  relId: string;
  otherEntityId: string | null;
  otherCanonicalName: string;
  otherEntityType: string;
  relationshipType: string;
  projectName: string | null;
  projectYear: number | null;
  projectValue: number | null;
  source: string | null;
  sourceUrl: string | null;
  confidence: string;
  reviewStatus: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  legacyEdgeId: string | null;
}

function RelationshipList({ rows, reverseArrow }: { rows: RelRow[]; reverseArrow?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li
          key={r.relId}
          className="p-2.5 rounded-md flex flex-col gap-1"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-0.5 rounded"
                style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
              >
                {r.relationshipType}
              </span>
              {r.otherEntityId ? (
                <Link
                  href={`/market-intelligence/entities/${r.otherEntityId}`}
                  className="hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {reverseArrow ? "← " : "→ "}
                  {r.otherCanonicalName}
                </Link>
              ) : (
                <span style={{ color: "var(--text-dim)" }}>
                  {reverseArrow ? "← " : "→ "}
                  {r.otherCanonicalName}
                </span>
              )}
              <EntityTypeChip entityType={r.otherEntityType} />
            </div>
            <div className="flex items-center gap-1.5">
              <ConfidenceChip confidence={r.confidence} />
              <ReviewStatusChip status={r.reviewStatus} />
            </div>
          </div>
          <div className="font-mono text-[10px] opacity-70 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {r.projectName && <span>project: {r.projectName}</span>}
            {r.projectYear && <span>year: {r.projectYear}</span>}
            {r.projectValue != null && <span>value: {fmtMoney(r.projectValue)}</span>}
            {r.source && <span>source: {r.source}</span>}
            {r.legacyEdgeId && <span title="Original RelationshipEdge">legacy: {r.legacyEdgeId.slice(0, 8)}…</span>}
            <span>seen: {fmtDate(r.firstObservedAt)} → {fmtDate(r.lastObservedAt)}</span>
            {r.sourceUrl && (
              <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="underline opacity-90 hover:opacity-100">
                source url ↗
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
