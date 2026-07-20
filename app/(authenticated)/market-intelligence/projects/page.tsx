// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/projects — project list page (Phase MI-6 PR3)
//
//  Server component. Filters via query params. Default excludes REJECTED
//  and MERGED projects (operator can pass ?reviewStatus=MERGED to see
//  tombstoned ones).
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ConfidenceChip, LifecycleChip, ProbabilityChip, ReviewStatusChip } from "./chips";
import { LIFECYCLE_STATES, PROJECT_REVIEW_STATES } from "@/lib/services/projectAggregation";

interface PageProps {
  searchParams: Promise<{
    lifecycle?: string;
    reviewStatus?: string;
    confidence?: string;
    jurisdiction?: string;
    probability?: string; // "high" (>=0.7), "med" (0.4-0.7), "low" (<0.4)
    search?: string;
  }>;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default async function ProjectsListPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const where: Record<string, unknown> = {};
  if (sp.lifecycle) where.lifecycleState = sp.lifecycle;
  if (sp.reviewStatus) where.reviewStatus = sp.reviewStatus;
  else where.reviewStatus = { notIn: ["REJECTED", "MERGED"] };
  if (sp.confidence) where.confidence = sp.confidence;
  if (sp.jurisdiction) where.jurisdiction = sp.jurisdiction;
  if (sp.probability === "high") where.emergenceProbability = { gte: 0.7 };
  else if (sp.probability === "med") where.emergenceProbability = { gte: 0.4, lt: 0.7 };
  else if (sp.probability === "low") where.emergenceProbability = { lt: 0.4 };
  if (sp.search) {
    where.OR = [
      { workingTitle: { contains: sp.search } },
      { jurisdiction: { contains: sp.search } },
    ];
  }

  const [projects, totalActive, totalPending, totalReview] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: [{ lastSignalAt: "desc" }],
      take: 200,
    }),
    prisma.project.count({ where: { reviewStatus: { notIn: ["REJECTED", "MERGED"] } } }),
    prisma.project.count({ where: { reviewStatus: "PENDING_REVIEW" } }),
    prisma.project.count({ where: { lifecycleState: "STALLED" } }),
  ]);

  const projectIds = projects.map((p) => p.id);
  const [signalCounts, entityCounts] = await Promise.all([
    prisma.projectSignal.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, detachedAt: null },
      _count: { _all: true },
    }),
    prisma.projectEntity.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, removed: false },
      _count: { _all: true },
    }),
  ]);
  const signalByProject = new Map(signalCounts.map((s) => [s.projectId, s._count._all]));
  const entityByProject = new Map(entityCounts.map((s) => [s.projectId, s._count._all]));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col gap-5">
      <div>
        <Link
          href="/market-intelligence"
          className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100"
        >
          ← Back to Market Intelligence
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-[700]" style={{ color: "var(--text)" }}>
          Projects
        </h1>
        <p className="text-[12px] opacity-70" style={{ color: "var(--text-soft)" }}>
          Construction-emergence aggregates: many weak signals accumulating over time into one
          evolving intelligence object. Each row links to a profile that explains how the system
          knows what it knows.
        </p>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.07em]">
          <span style={{ color: "var(--text-soft)" }}>{totalActive} active</span>
          <span style={{ color: "#ffcc72" }}>{totalPending} pending review</span>
          <span style={{ color: "#ff8b66" }}>{totalReview} stalled</span>
          <Link href="/market-intelligence/projects/review" className="underline opacity-90 hover:opacity-100">
            review queue →
          </Link>
        </div>
      </header>

      {/* Filters */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 p-3 rounded-md"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
      >
        <FilterInput label="Search" name="search" defaultValue={sp.search ?? ""} placeholder="title or jurisdiction..." />
        <FilterSelect label="Lifecycle" name="lifecycle" defaultValue={sp.lifecycle ?? ""} options={["", ...LIFECYCLE_STATES]} />
        <FilterSelect label="Review" name="reviewStatus" defaultValue={sp.reviewStatus ?? ""} options={["", ...PROJECT_REVIEW_STATES]} />
        <FilterSelect label="Confidence" name="confidence" defaultValue={sp.confidence ?? ""} options={["", "VERIFIED", "HIGH", "MEDIUM", "LOW", "NONE"]} />
        <FilterSelect label="Probability" name="probability" defaultValue={sp.probability ?? ""} options={["", "high", "med", "low"]} />
        <FilterInput label="Jurisdiction" name="jurisdiction" defaultValue={sp.jurisdiction ?? ""} />
        <button
          type="submit"
          className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.07em] rounded-md"
          style={{ background: "var(--signal-dim)", color: "var(--signal-soft)", border: "1px solid rgba(45,123,255,0.22)" }}
        >
          Filter
        </button>
      </form>

      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
        {projects.length} result{projects.length === 1 ? "" : "s"} (capped at 200)
      </div>

      <ul className="flex flex-col gap-2">
        {projects.length === 0 && (
          <li className="opacity-60 text-[12px] py-4">No projects match these filters.</li>
        )}
        {projects.map((p) => {
          const sn = signalByProject.get(p.id) ?? 0;
          const en = entityByProject.get(p.id) ?? 0;
          return (
            <li
              key={p.id}
              className="p-3 rounded-md flex flex-col gap-2"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/market-intelligence/projects/${p.id}`}
                  className="font-[600] hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {p.workingTitle}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <LifecycleChip state={p.lifecycleState} />
                  <ReviewStatusChip status={p.reviewStatus} />
                  <ConfidenceChip confidence={p.confidence} />
                  <ProbabilityChip probability={p.emergenceProbability} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.07em] opacity-70">
                <span>jurisdiction: {p.jurisdiction ?? "—"}</span>
                <span>last signal: {fmtDate(p.lastSignalAt)}</span>
                <span>{sn} signals · {en} entities</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterInput({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[180px]">
      <span className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-70">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      />
    </label>
  );
}

function FilterSelect({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: readonly string[] | string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.07em] opacity-70">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "" ? "(any)" : o}
          </option>
        ))}
      </select>
    </label>
  );
}
