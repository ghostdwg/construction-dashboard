// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/projects/review — operator review queue (Phase MI-6 PR3)
//
//  Server component. Surfaces six review streams in one place:
//    1. PENDING_REVIEW projects (Pass-4 needs_review backfill outcomes)
//    2. LOW-confidence projects (probability < 0.25 OR confidence=LOW)
//    3. Collision findings from MI-6 PR2 detectors (run on demand)
//    4. STALLED projects (operator may want to abandon or revive)
//    5. Projects with detached signals (potential reattachment candidates)
//    6. Projects with > N signals + high score-spread (over-merged candidates)
//
//  Each project link → profile, where the actions live.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  detectProjectCollisions,
  type ProjectSnapshot,
  type ProjectParcelSnapshot,
} from "@/lib/services/projectBackfill";
import { ConfidenceChip, LifecycleChip, ProbabilityChip, ReviewStatusChip } from "../chips";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default async function ProjectReviewPage() {
  const [pending, lowConfidence, stalled, allProjects, allSignals, allParcels, allEntities] =
    await Promise.all([
      prisma.project.findMany({
        where: { reviewStatus: "PENDING_REVIEW" },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.project.findMany({
        where: {
          reviewStatus: { notIn: ["REJECTED", "MERGED"] },
          OR: [{ confidence: "LOW" }, { emergenceProbability: { lt: 0.25 } }],
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.project.findMany({
        where: { lifecycleState: "STALLED" },
        orderBy: { lastSignalAt: "desc" },
        take: 50,
      }),
      prisma.project.findMany({
        where: { reviewStatus: { notIn: ["REJECTED", "MERGED"] } },
      }),
      prisma.projectSignal.findMany({
        select: { projectId: true, attachScore: true, factorJson: true, detachedAt: true },
      }),
      prisma.projectParcel.findMany({
        select: { projectId: true, parcelId: true, parcelSource: true },
      }),
      prisma.projectEntity.findMany({
        where: { removed: false },
        select: { projectId: true, entityId: true, role: true },
      }),
    ]);

  // Build snapshots for collision detection
  const developersByProject = new Map<string, string[]>();
  for (const e of allEntities) {
    if (e.role !== "DEVELOPER" && e.role !== "OWNER") continue;
    const arr = developersByProject.get(e.projectId) ?? [];
    arr.push(e.entityId);
    developersByProject.set(e.projectId, arr);
  }
  const parcelsByProject = new Map<string, Array<{ parcelId: string; parcelSource: string }>>();
  for (const p of allParcels) {
    const arr = parcelsByProject.get(p.projectId) ?? [];
    arr.push({ parcelId: p.parcelId, parcelSource: p.parcelSource });
    parcelsByProject.set(p.projectId, arr);
  }
  const signalsByProject = new Map<string, { scores: number[]; jurisdictions: string[] }>();
  for (const s of allSignals) {
    if (s.detachedAt !== null) continue;
    const cur = signalsByProject.get(s.projectId) ?? { scores: [], jurisdictions: [] };
    cur.scores.push(s.attachScore);
    if (s.factorJson) {
      try {
        const f = JSON.parse(s.factorJson) as { jurisdiction?: string };
        if (typeof f.jurisdiction === "string") cur.jurisdictions.push(f.jurisdiction);
      } catch {
        // ignore
      }
    }
    signalsByProject.set(s.projectId, cur);
  }
  const detachedCountByProject = new Map<string, number>();
  for (const s of allSignals) {
    if (s.detachedAt === null) continue;
    detachedCountByProject.set(s.projectId, (detachedCountByProject.get(s.projectId) ?? 0) + 1);
  }

  const projectSnapshots: ProjectSnapshot[] = allProjects.map((p) => ({
    id: p.id,
    workingTitle: p.workingTitle,
    jurisdiction: p.jurisdiction,
    reviewStatus: p.reviewStatus,
    parcelIds: (parcelsByProject.get(p.id) ?? []).map((x) => x.parcelId),
    developerIds: developersByProject.get(p.id) ?? [],
    signalScores: signalsByProject.get(p.id)?.scores ?? [],
    signalJurisdictions:
      signalsByProject.get(p.id)?.jurisdictions ?? (p.jurisdiction ? [p.jurisdiction] : []),
  }));
  const parcelSnapshots: ProjectParcelSnapshot[] = allProjects.map((p) => ({
    id: p.id,
    workingTitle: p.workingTitle,
    reviewStatus: p.reviewStatus,
    parcels: parcelsByProject.get(p.id) ?? [],
  }));

  const collisions = detectProjectCollisions({ projects: projectSnapshots, parcelSnapshots });

  const projectsWithDetached = allProjects
    .filter((p) => (detachedCountByProject.get(p.id) ?? 0) > 0)
    .slice(0, 50);

  const projectById = new Map(allProjects.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/market-intelligence/projects"
          className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100"
        >
          ← Back to projects
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-[700]" style={{ color: "var(--text)" }}>
          Project review queue
        </h1>
        <p className="text-[12px] opacity-70" style={{ color: "var(--text-soft)" }}>
          Aggregates the resolver couldn&apos;t decide on, structural collisions, and stalled
          activity. Click any project to inspect and act.
        </p>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.07em]">
          <Badge label="Pending" count={pending.length} color="#ffcc72" />
          <Badge label="Low confidence" count={lowConfidence.length} color="#ff8b66" />
          <Badge label="Stalled" count={stalled.length} color="#ff8b66" />
          <Badge label="Collisions" count={collisions.length} color="#b8ceff" />
          <Badge label="Detached signals" count={projectsWithDetached.length} color="var(--text-soft)" />
        </div>
      </header>

      <SectionBlock title={`PENDING_REVIEW projects (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>Nothing pending. Backfill review band is clear.</Empty>
        ) : (
          <ProjectList projects={pending} />
        )}
      </SectionBlock>

      <SectionBlock title={`Low-confidence aggregates (${lowConfidence.length})`}>
        {lowConfidence.length === 0 ? (
          <Empty>No low-confidence aggregates outstanding.</Empty>
        ) : (
          <ProjectList projects={lowConfidence} />
        )}
      </SectionBlock>

      <SectionBlock title={`Stalled projects (${stalled.length})`}>
        {stalled.length === 0 ? (
          <Empty>No stalled projects.</Empty>
        ) : (
          <ProjectList projects={stalled} />
        )}
      </SectionBlock>

      <SectionBlock title={`Collision findings (${collisions.length})`}>
        {collisions.length === 0 ? (
          <Empty>No structural collisions detected.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {collisions.map((c, i) => (
              <li
                key={i}
                className="p-3 rounded-md flex flex-col gap-1"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.07em] px-2 py-0.5 rounded"
                    style={{ color: "#ffcc72", background: "var(--amber-dim)", border: "1px solid rgba(245,166,35,0.2)" }}
                  >
                    {c.kind.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-[10px] opacity-60">{c.projectIds.length} project(s)</span>
                </div>
                <div className="text-[12px]" style={{ color: "var(--text-soft)" }}>{c.description}</div>
                <div className="text-[11px] opacity-70">
                  <span className="font-mono opacity-70">Recommended:</span> {c.recommendedAction}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.projectIds.map((pid) => {
                    const p = projectById.get(pid);
                    return (
                      <Link
                        key={pid}
                        href={`/market-intelligence/projects/${pid}`}
                        className="font-mono text-[11px] px-2 py-0.5 rounded hover:underline"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", color: "var(--text)" }}
                      >
                        {p ? p.workingTitle : pid.slice(0, 8)}
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionBlock>

      <SectionBlock title={`Projects with detached signals (${projectsWithDetached.length})`}>
        {projectsWithDetached.length === 0 ? (
          <Empty>No detached signals on active projects.</Empty>
        ) : (
          <>
            <div className="opacity-60 text-[11px] mb-2">
              Detached signals are preserved as soft-deleted rows. Operator can reattach them
              to a different project via the source project&apos;s profile.
            </div>
            <ProjectList projects={projectsWithDetached} extraInfo={(p) => `${detachedCountByProject.get(p.id) ?? 0} detached`} />
          </>
        )}
      </SectionBlock>
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.07em] opacity-90" style={{ color: "var(--text-soft)" }}>
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="opacity-50 text-[12px] py-2">{children}</div>;
}

function Badge({ label, count, color }: { label: string; count: number; color: string }) {
  return <span style={{ color }}>{count} {label}</span>;
}

interface ProjectRow {
  id: string;
  workingTitle: string;
  jurisdiction: string | null;
  lifecycleState: string;
  reviewStatus: string;
  confidence: string;
  emergenceProbability: number | null;
  lastSignalAt: Date | null;
}

function ProjectList({
  projects,
  extraInfo,
}: {
  projects: ProjectRow[];
  extraInfo?: (p: ProjectRow) => string;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {projects.map((p) => (
        <li
          key={p.id}
          className="p-3 rounded-md flex items-center justify-between gap-4"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <Link
              href={`/market-intelligence/projects/${p.id}`}
              className="font-[600] hover:underline truncate"
              style={{ color: "var(--text)" }}
            >
              {p.workingTitle}
            </Link>
            <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-50">
              {p.jurisdiction ?? "—"} · last signal {fmtDate(p.lastSignalAt)}
              {extraInfo && <span> · {extraInfo(p)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <LifecycleChip state={p.lifecycleState} />
            <ReviewStatusChip status={p.reviewStatus} />
            <ConfidenceChip confidence={p.confidence} />
            <ProbabilityChip probability={p.emergenceProbability} />
          </div>
        </li>
      ))}
    </ul>
  );
}
