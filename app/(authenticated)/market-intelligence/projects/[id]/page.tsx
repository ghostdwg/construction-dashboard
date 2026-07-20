// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/projects/[id] — project profile (Phase MI-6 PR3)
//
//  Server component. The intelligence-trust surface for project aggregates.
//  Every section answers "Why does the system believe this is one project?".
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  ConfidenceChip,
  LifecycleChip,
  ProbabilityChip,
  ReviewStatusChip,
} from "../chips";
import { ProbabilitySparkline } from "../ProbabilitySparkline";
import ProjectActions from "../ProjectActions";
import SignalDetach from "../SignalDetach";
import PromoteToPursuit from "../../PromoteToPursuit";
import PromotionSummary from "../../PromotionSummary";
import { previewPromotion } from "@/lib/services/pursuitPromotion";
import { resolvePromotionActor } from "@/lib/services/pursuitPromotion/actor";

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
function fmtScorePct(score: number | null | undefined): string {
  if (score == null) return "—";
  return `${(score * 100).toFixed(0)}%`;
}

export default async function ProjectProfilePage({ params }: PageProps) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      mergedInto: { select: { id: true, workingTitle: true } },
      absorbedProjects: { select: { id: true, workingTitle: true } },
    },
  });
  if (!project) notFound();

  // Server-resolved so the promotion control paints in the correct state.
  const promotionActor = await resolvePromotionActor();
  const promotion = promotionActor
    ? await previewPromotion(promotionActor, "PROJECT", project.id)
    : null;

  const [signals, entities, parcels, snapshots, timeline] = await Promise.all([
    prisma.projectSignal.findMany({
      where: { projectId: id },
      orderBy: { attachedAt: "desc" },
      take: 200,
    }),
    prisma.projectEntity.findMany({
      where: { projectId: id, removed: false },
      orderBy: { firstSeenAt: "asc" },
    }),
    prisma.projectParcel.findMany({
      where: { projectId: id },
      orderBy: { attachedAt: "asc" },
    }),
    prisma.projectProbabilitySnapshot.findMany({
      where: { projectId: id },
      orderBy: { computedAt: "asc" },
      take: 100,
    }),
    prisma.projectTimelineEvent.findMany({
      where: { projectId: id },
      orderBy: { occurredAt: "asc" },
      take: 300,
    }),
  ]);

  // Resolve entity canonical names
  const entityIds = [...new Set(entities.map((e) => e.entityId))];
  const entityRecords =
    entityIds.length > 0
      ? await prisma.entity.findMany({
          where: { id: { in: entityIds } },
          select: { id: true, canonicalName: true, entityType: true },
        })
      : [];
  const entityById = new Map(entityRecords.map((e) => [e.id, e]));

  // Latest probability snapshot for the "explanation" panel
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const latestFactors = parseJson<Record<string, number | string>>(latestSnapshot?.factorsJson);

  // Active (non-detached) signals for evidence count
  const activeSignals = signals.filter((s) => s.detachedAt === null);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/market-intelligence/projects"
          className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100"
        >
          ← Back to projects
        </Link>
        <div className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-40">id: {project.id}</div>
      </div>

      {/* Header */}
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-[700]" style={{ color: "var(--text)" }}>
          {project.workingTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <LifecycleChip state={project.lifecycleState} />
          <ReviewStatusChip status={project.reviewStatus} />
          <ConfidenceChip confidence={project.confidence} />
          <ProbabilityChip probability={project.emergenceProbability} />
        </div>
        {project.mergedInto && (
          <div
            className="text-[11px] font-mono opacity-80 px-2 py-1 rounded-md inline-flex items-center gap-2"
            style={{ background: "rgba(126,167,255,0.06)", border: "1px solid rgba(126,167,255,0.2)" }}
          >
            Merged into{" "}
            <Link href={`/market-intelligence/projects/${project.mergedInto.id}`} className="underline">
              {project.mergedInto.workingTitle}
            </Link>
          </div>
        )}
        {project.absorbedProjects.length > 0 && (
          <div className="text-[11px] font-mono opacity-80">
            Absorbed {project.absorbedProjects.length} project(s):{" "}
            {project.absorbedProjects.map((p) => (
              <Link
                key={p.id}
                href={`/market-intelligence/projects/${p.id}`}
                className="underline mr-2"
              >
                {p.workingTitle}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* Actions */}
      <Section title="Actions">
        <ProjectActions
          projectId={project.id}
          workingTitle={project.workingTitle}
          reviewStatus={project.reviewStatus}
          lifecycleState={project.lifecycleState}
        />
      </Section>

      {promotion && (
        <Section title="Pursuit">
          <PromoteToPursuit
            sourceKind="PROJECT"
            sourceId={project.id}
            initialEligible={promotion.eligible}
            initialReason={promotion.reason}
            initialBidId={promotion.existingBidId}
            promotedOutOfScope={promotion.promotedOutOfScope}
          />
          {promotion.existingBidId != null && (
            <div className="mt-3">
              <PromotionSummary
                sourceKind="PROJECT"
                sourceId={project.id}
                bidId={promotion.existingBidId}
              />
            </div>
          )}
        </Section>
      )}

      {/* Why does the system believe this? — explainability panel */}
      <Section title="Why does the system believe this is one project?">
        <Grid>
          <Field label="Working title" value={project.workingTitle} />
          <Field label="Jurisdiction" value={project.jurisdiction ?? "—"} />
          <Field label="First signal observed" value={fmtDate(project.firstSignalAt)} />
          <Field label="Last signal observed" value={fmtDate(project.lastSignalAt)} />
          <Field label="Active signals" value={String(activeSignals.length)} />
          <Field label="Detached signals" value={String(signals.length - activeSignals.length)} />
          <Field label="Active entity attachments" value={String(entities.length)} />
          <Field label="Parcels attached" value={String(parcels.length)} />
          <Field label="Created via" value={project.source ?? "—"} />
          <Field label="Emergence probability" value={project.emergenceProbability == null ? "—" : fmtScorePct(project.emergenceProbability)} />
        </Grid>
        {latestFactors && (
          <div className="mt-3 p-3 rounded-md" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}>
            <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 mb-2">
              Latest probability factor breakdown
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] opacity-90">
              {Object.entries(latestFactors).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span className="opacity-70">{k}</span>
                  <span>{typeof v === "number" ? v.toFixed(3) : String(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Probability sparkline */}
      {snapshots.length > 0 && (
        <Section title={`Probability trend (${snapshots.length} snapshots)`}>
          <div className="flex items-center gap-3" style={{ color: "var(--signal-soft)" }}>
            <ProbabilitySparkline
              points={snapshots.map((s) => ({ computedAt: s.computedAt, probability: s.probability }))}
              width={360}
              height={48}
            />
            <div className="font-mono text-[10px] opacity-70">
              {fmtDate(snapshots[0].computedAt)} → {fmtDate(snapshots[snapshots.length - 1].computedAt)}
            </div>
          </div>
        </Section>
      )}

      {/* Project attributes */}
      <Section title="Inferred attributes">
        <Grid>
          <Field label="Project type" value={project.projectType ?? "—"} />
          <Field label="Estimated value" value={fmtMoney(project.estimatedValue)} />
          <Field label="Estimated sqft" value={project.estimatedSqft == null ? "—" : project.estimatedSqft.toLocaleString()} />
          <Field label="Estimated start" value={fmtDate(project.estimatedStart)} />
        </Grid>
        {project.notes && (
          <pre
            className="mt-2 p-2 rounded-md font-mono text-[11px] whitespace-pre-wrap"
            style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)" }}
          >
            {project.notes}
          </pre>
        )}
      </Section>

      {/* Entities */}
      <Section title={`Related entities (${entities.length})`}>
        {entities.length === 0 ? (
          <Empty>No entities attached yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {entities.map((pe) => {
              const e = entityById.get(pe.entityId);
              return (
                <li
                  key={pe.id}
                  className="p-2 rounded-md flex items-center justify-between gap-3"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-0.5 rounded"
                      style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
                    >
                      {pe.role}
                    </span>
                    {e ? (
                      <Link
                        href={`/market-intelligence/entities/${e.id}`}
                        className="hover:underline"
                        style={{ color: "var(--text)" }}
                      >
                        {e.canonicalName}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>(entity {pe.entityId.slice(0, 8)})</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] opacity-70 flex items-center gap-3">
                    <span>{pe.confidence}</span>
                    <span>seen: {fmtDate(pe.firstSeenAt)} → {fmtDate(pe.lastSeenAt)}</span>
                    <span>via: {pe.attachReason}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Parcels */}
      <Section title={`Parcels (${parcels.length})`}>
        {parcels.length === 0 ? (
          <Empty>No parcels attached.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {parcels.map((p) => (
              <li
                key={p.id}
                className="p-2 rounded-md flex items-center justify-between gap-3 font-mono text-[11px]"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <span style={{ color: "var(--text)" }}>{p.parcelId}</span>
                <span className="opacity-70">
                  {p.parcelSource}
                  {p.address ? ` · ${p.address}` : ""}
                  {p.jurisdiction ? ` · ${p.jurisdiction}` : ""}
                  {p.areaSqft ? ` · ${p.areaSqft.toLocaleString()} sqft` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Attached signals — the core "evidence" view */}
      <Section title={`Attached signals (${activeSignals.length} active, ${signals.length - activeSignals.length} detached)`}>
        {signals.length === 0 ? (
          <Empty>No signals attached.</Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {signals.map((s) => {
              const factors = parseJson<Record<string, number>>(s.factorJson);
              const detached = s.detachedAt !== null;
              return (
                <li
                  key={s.id}
                  className="p-2.5 rounded-md flex flex-col gap-1"
                  style={{
                    background: detached ? "rgba(255,139,102,0.02)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${detached ? "rgba(255,139,102,0.18)" : "var(--line)"}`,
                    opacity: detached ? 0.7 : 1,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-0.5 rounded shrink-0"
                        style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
                      >
                        {s.signalKind}
                      </span>
                      <span className="font-mono text-[11px] truncate" style={{ color: "var(--text)" }}>
                        {sourcePointerLabel(s)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-0.5 rounded"
                        style={{
                          color: s.attachScore >= 0.8 ? "var(--signal-soft)" : s.attachScore >= 0.5 ? "#ffcc72" : "var(--text-dim)",
                          border: "1px solid var(--line)",
                        }}
                      >
                        score {fmtScorePct(s.attachScore)}
                      </span>
                      {!detached && <SignalDetach projectId={id} projectSignalId={s.id} />}
                    </div>
                  </div>
                  <div className="font-mono text-[10px] opacity-70 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>reason: {s.attachReason}</span>
                    <span>attached: {fmtDateTime(s.attachedAt)}</span>
                    {detached && <span style={{ color: "#ff8b66" }}>detached: {fmtDateTime(s.detachedAt)} ({s.detachedReason ?? "—"})</span>}
                  </div>
                  {factors && (
                    <details className="font-mono text-[10px] opacity-80">
                      <summary className="cursor-pointer opacity-70 hover:opacity-100">factor breakdown</summary>
                      <ul className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5 mt-1">
                        {Object.entries(factors).map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-2">
                            <span className="opacity-70">{k}</span>
                            <span>{typeof v === "number" ? v.toFixed(3) : String(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Timeline */}
      <Section title={`Timeline (${timeline.length} events)`}>
        {timeline.length === 0 ? (
          <Empty>No timeline events.</Empty>
        ) : (
          <ol className="flex flex-col gap-1">
            {timeline.map((t) => (
              <li
                key={t.id}
                className="p-2 rounded-md font-mono text-[11px] flex flex-col gap-0.5"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded shrink-0"
                    style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
                  >
                    {t.eventType}
                  </span>
                  <span className="opacity-50">{fmtDateTime(t.occurredAt)}</span>
                </div>
                <div style={{ color: "var(--text)" }}>{t.summary}</div>
                {t.actorEmail && <div className="opacity-50">by {t.actorEmail}</div>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function sourcePointerLabel(s: {
  sourceMarketSignalId: string | null;
  sourceRelationshipEdgeId: string | null;
  sourceMarketLeadId: string | null;
  sourceMarketSourceDocId: string | null;
  sourceExternalRef: string | null;
}): string {
  if (s.sourceMarketSignalId) return `MarketSignal:${s.sourceMarketSignalId.slice(0, 8)}…`;
  if (s.sourceRelationshipEdgeId) return `RelationshipEdge:${s.sourceRelationshipEdgeId.slice(0, 8)}…`;
  if (s.sourceMarketLeadId) return `MarketLead:${s.sourceMarketLeadId.slice(0, 8)}…`;
  if (s.sourceMarketSourceDocId) return `SourceDoc:${s.sourceMarketSourceDocId.slice(0, 8)}…`;
  if (s.sourceExternalRef) return `External:${s.sourceExternalRef}`;
  return "(manual)";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.07em] opacity-90" style={{ color: "var(--text-soft)" }}>
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-50">{label}</span>
      <span className="text-[13px]" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="opacity-50 text-[12px] py-2">{children}</div>;
}
