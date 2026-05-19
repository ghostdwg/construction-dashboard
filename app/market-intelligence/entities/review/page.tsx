// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/entities/review  — Operator review governance queue
//  Phase MI-4.
//
//  Single page consolidating the four review surfaces:
//    1. PENDING_REVIEW entities — resolver Pass 4 created these
//    2. LOW_CONFIDENCE entities — resolver Pass 5 auto-created these
//    3. Collision findings — from lib/services/entityBackfill/collisions.ts
//    4. Unresolved RelationshipEdge rows — fromEntityId or toEntityId IS NULL
//
//  Server component. The actions live on each entity's profile page; this
//  page is the index that surfaces what needs operator attention right now.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { detectCollisions } from "@/lib/services/entityBackfill";
import type { EntityRecord, AliasRecord } from "@/lib/services/entityResolver";
import { ConfidenceChip, EntityTypeChip, ReviewStatusChip } from "../chips";

export default async function ReviewQueuePage() {
  const [pendingEntities, lowConfidence, allEntities, allAliases, unresolvedEdges] =
    await Promise.all([
      prisma.entity.findMany({
        where: { reviewStatus: "PENDING_REVIEW" },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.entity.findMany({
        where: { reviewStatus: "LOW_CONFIDENCE" },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.entity.findMany(),
      prisma.entityAlias.findMany(),
      prisma.relationshipEdge.findMany({
        where: { OR: [{ fromEntityId: null }, { toEntityId: null }] },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

  const collisions = detectCollisions(
    allEntities as EntityRecord[],
    allAliases as AliasRecord[]
  );
  const entityById = new Map(allEntities.map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/market-intelligence/entities"
          className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100"
        >
          ← Back to entities
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-[700]" style={{ color: "var(--text)" }}>
          Review queue
        </h1>
        <p className="text-[12px] opacity-70" style={{ color: "var(--text-soft)" }}>
          Items the resolver couldn't decide on, and structural inconsistencies the
          collision detectors flagged. Click any entity to inspect and act.
        </p>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.07em]">
          <Badge label="Pending" count={pendingEntities.length} color="#ffcc72" />
          <Badge label="Low confidence" count={lowConfidence.length} color="#ff8b66" />
          <Badge label="Collisions" count={collisions.length} color="#b8ceff" />
          <Badge label="Unresolved edges" count={unresolvedEdges.length} color="var(--text-soft)" />
        </div>
      </header>

      {/* 1. PENDING_REVIEW */}
      <Section title={`PENDING_REVIEW entities (${pendingEntities.length})`}>
        {pendingEntities.length === 0 ? (
          <Empty>Nothing pending. Great state.</Empty>
        ) : (
          <EntityList entities={pendingEntities} />
        )}
      </Section>

      {/* 2. LOW_CONFIDENCE */}
      <Section title={`LOW_CONFIDENCE entities (${lowConfidence.length})`}>
        {lowConfidence.length === 0 ? (
          <Empty>No low-confidence auto-creates outstanding.</Empty>
        ) : (
          <EntityList entities={lowConfidence} />
        )}
      </Section>

      {/* 3. Collisions */}
      <Section title={`Collision findings (${collisions.length})`}>
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
                  <span className="font-mono text-[10px] opacity-60">{c.entityIds.length} entities</span>
                </div>
                <div className="text-[12px]" style={{ color: "var(--text-soft)" }}>
                  {c.description}
                </div>
                <div className="text-[11px] opacity-70">
                  <span className="font-mono opacity-70">Recommended:</span> {c.recommendedAction}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.entityIds.map((eid) => {
                    const e = entityById.get(eid);
                    return (
                      <Link
                        key={eid}
                        href={`/market-intelligence/entities/${eid}`}
                        className="font-mono text-[11px] px-2 py-0.5 rounded hover:underline"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", color: "var(--text)" }}
                      >
                        {e ? e.canonicalName : eid.slice(0, 8)}
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 4. Unresolved RelationshipEdge */}
      <Section title={`Unresolved RelationshipEdge rows (${unresolvedEdges.length})`}>
        {unresolvedEdges.length === 0 ? (
          <Empty>All edges have entity links.</Empty>
        ) : (
          <>
            <div className="opacity-60 text-[11px] mb-2">
              These RelationshipEdge rows have NULL fromEntityId or toEntityId — the
              backfill skipped them or they were added after the last backfill run.
              Re-run <span className="font-mono">npm run backfill:entity-graph</span> to fill them in.
            </div>
            <ul className="flex flex-col gap-1">
              {unresolvedEdges.map((e) => (
                <li
                  key={e.id}
                  className="p-2 rounded-md font-mono text-[11px] flex items-center justify-between gap-2"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}
                >
                  <span style={{ color: "var(--text-soft)" }}>
                    {e.fromName} <span className="opacity-50">[{e.fromType}]</span>{" "}
                    → {e.toName} <span className="opacity-50">[{e.toType}]</span>
                  </span>
                  <span className="opacity-60">
                    {e.relationshipType}
                    {e.fromEntityId == null && <span style={{ color: "#ff8b66" }}> · from↻</span>}
                    {e.toEntityId == null && <span style={{ color: "#ff8b66" }}> · to↻</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="opacity-50 text-[12px] py-2">{children}</div>
  );
}

function Badge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{ color }}>
      {count} {label}
    </span>
  );
}

function EntityList({
  entities,
}: {
  entities: Array<{
    id: string;
    canonicalName: string;
    normalizedName: string;
    entityType: string;
    reviewStatus: string;
    confidence: string;
    source: string | null;
    updatedAt: Date;
  }>;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {entities.map((e) => (
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
            <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-50">
              {e.normalizedName} · {e.source ?? "?"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <EntityTypeChip entityType={e.entityType} />
            <ReviewStatusChip status={e.reviewStatus} />
            <ConfidenceChip confidence={e.confidence} />
          </div>
        </li>
      ))}
    </ul>
  );
}
