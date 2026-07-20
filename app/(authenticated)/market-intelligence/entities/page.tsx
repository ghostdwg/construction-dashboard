// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/entities  — entity list page (Phase MI-4)
//
//  Server component. Reads filters from search params. Renders a sortable,
//  filterable list of canonical entities with confidence + status chips +
//  relationship counts.
//
//  Filters supported via query string:
//    ?type=Developer
//    ?status=PENDING_REVIEW
//    ?confidence=LOW
//    ?search=hubbell
//
//  Defaults exclude REJECTED entities. Operator can pass ?status=REJECTED to
//  see the tombstoned ones.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/services/entityResolver";
import { ConfidenceChip, EntityTypeChip, ReviewStatusChip } from "./chips";

interface PageProps {
  searchParams: Promise<{
    type?: string;
    status?: string;
    confidence?: string;
    search?: string;
  }>;
}

export default async function EntitiesListPage({ searchParams }: PageProps) {
  const { type, status, confidence, search } = await searchParams;

  const where: Record<string, unknown> = {};
  if (type) where.entityType = type;
  if (status) where.reviewStatus = status;
  else where.reviewStatus = { not: "REJECTED" };
  if (confidence) where.confidence = confidence;
  if (search) {
    const norm = normalizeEntityName(search);
    where.OR = [
      { canonicalName: { contains: search } },
      { normalizedName: { contains: norm } },
    ];
  }

  const [entities, totalActive, totalPending, totalLow] = await Promise.all([
    prisma.entity.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }),
    prisma.entity.count({ where: { reviewStatus: { not: "REJECTED" } } }),
    prisma.entity.count({ where: { reviewStatus: "PENDING_REVIEW" } }),
    prisma.entity.count({ where: { reviewStatus: "LOW_CONFIDENCE" } }),
  ]);

  // Relationship counts (single batched query)
  const relCounts = await prisma.entityRelationship.groupBy({
    by: ["fromEntityId"],
    _count: { _all: true },
  });
  const relCountByEntity = new Map<string, number>();
  for (const r of relCounts) {
    relCountByEntity.set(r.fromEntityId, (relCountByEntity.get(r.fromEntityId) ?? 0) + r._count._all);
  }
  const toCounts = await prisma.entityRelationship.groupBy({
    by: ["toEntityId"],
    _count: { _all: true },
  });
  for (const r of toCounts) {
    relCountByEntity.set(r.toEntityId, (relCountByEntity.get(r.toEntityId) ?? 0) + r._count._all);
  }

  const aliasCounts = await prisma.entityAlias.groupBy({
    by: ["entityId"],
    _count: { _all: true },
  });
  const aliasCountByEntity = new Map(aliasCounts.map((a) => [a.entityId, a._count._all]));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-5">
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
          Entities
        </h1>
        <p className="text-[12px] opacity-70" style={{ color: "var(--text-soft)" }}>
          Canonical market participants resolved from historical signals. Each row
          links to a profile that explains how the system knows what it knows.
        </p>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">
          <span style={{ color: "var(--text-soft)" }}>{totalActive} active</span>
          <span style={{ color: "#ffcc72" }}>{totalPending} pending review</span>
          <span style={{ color: "#ff8b66" }}>{totalLow} low confidence</span>
          <Link href="/market-intelligence/entities/review" className="underline opacity-90 hover:opacity-100">
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
        <FilterInput label="Search" name="search" defaultValue={search ?? ""} placeholder="name or alias..." />
        <FilterSelect
          label="Type"
          name="type"
          defaultValue={type ?? ""}
          options={["", "Developer", "Owner", "Broker", "GC", "Architect", "Engineer", "Municipality", "Tenant", "Lender", "Agency", "Unknown"]}
        />
        <FilterSelect
          label="Status"
          name="status"
          defaultValue={status ?? ""}
          options={["", "VERIFIED", "AUTO_MATCHED", "AUTO", "PENDING_REVIEW", "LOW_CONFIDENCE", "REJECTED"]}
        />
        <FilterSelect
          label="Confidence"
          name="confidence"
          defaultValue={confidence ?? ""}
          options={["", "VERIFIED", "HIGH", "MEDIUM", "LOW", "NONE"]}
        />
        <button
          type="submit"
          className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.07em] rounded-md"
          style={{ background: "var(--signal-dim)", color: "var(--signal-soft)", border: "1px solid rgba(45,123,255,0.22)" }}
        >
          Filter
        </button>
      </form>

      {/* Result count */}
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
        {entities.length} result{entities.length === 1 ? "" : "s"} (capped at 200)
      </div>

      {/* List */}
      <ul className="flex flex-col gap-2">
        {entities.length === 0 && (
          <li className="opacity-60 text-[12px] py-4">No entities match these filters.</li>
        )}
        {entities.map((e) => {
          const aliasN = aliasCountByEntity.get(e.id) ?? 0;
          const relN = relCountByEntity.get(e.id) ?? 0;
          return (
            <li
              key={e.id}
              className="p-3 rounded-md flex items-center justify-between gap-4"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
            >
              <div className="flex flex-col gap-1 min-w-0">
                <Link
                  href={`/market-intelligence/entities/${e.id}`}
                  className="font-[600] hover:underline truncate"
                  style={{ color: "var(--text)" }}
                >
                  {e.canonicalName}
                </Link>
                <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-50 truncate">
                  {e.normalizedName}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <EntityTypeChip entityType={e.entityType} />
                <ReviewStatusChip status={e.reviewStatus} />
                <ConfidenceChip confidence={e.confidence} />
                <span
                  className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.07em] opacity-70"
                  style={{ border: "1px solid var(--line)", borderRadius: 999 }}
                >
                  {relN} rel · {aliasN} alias
                </span>
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
    <label className="flex flex-col gap-1 min-w-[200px]">
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
  options: string[];
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
