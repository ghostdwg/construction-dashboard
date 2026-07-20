// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/pursuitPromotion/__tests__/mockDb.ts
//  In-memory Prisma fake for the promotion service.
//
//  Follows the vi.hoisted store pattern used by the MI-2 resolver and MI-6
//  governance tests, with two additions the promotion tests actually need:
//
//    1. $transaction() SNAPSHOTS and ROLLS BACK. Promotion's whole safety
//       argument is "a race loser's bid insert disappears" — a fake that
//       ignores rollback would let that bug pass silently.
//    2. projectTimelineEvent.create ENFORCES the primary key, throwing a
//       Prisma-shaped { code: "P2002" }. That PK *is* the project duplicate
//       guard, so the fake has to enforce it to test it.
// ──────────────────────────────────────────────────────────────────────────────

export interface LeadRow {
  id: string;
  title: string;
  status: string;
  location: string | null;
  jurisdiction: string | null;
  projectType: string | null;
  estimatedValue: number | null;
  sourceUrl: string | null;
  sourceDocId: string | null;
  promotedToBidId: number | null;
  promotedAt: Date | null;
  aiSummary?: string | null;
  rawText?: string | null;
  notes?: string | null;
}

export interface ProjectRow {
  id: string;
  workingTitle: string;
  jurisdiction: string | null;
  projectType: string | null;
  estimatedValue: number | null;
  estimatedSqft: number | null;
  source: string | null;
  reviewStatus: string;
  lifecycleState: string;
  notes?: string | null;
  emergenceProbability?: number | null;
}

export interface BidRow {
  id: number;
  projectName: string;
  location: string | null;
  buildingType: string | null;
  approxSqft: number | null;
  status: string;
  workflowType: string;
  createdById: string | null;
}

export interface TimelineRow {
  id: string;
  projectId: string;
  eventType: string;
  occurredAt: Date;
  summary: string;
  sourceRefKind: string | null;
  sourceRefId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  payloadJson: string | null;
}

export interface AuditRow {
  category: string;
  action: string;
  severity: string;
  subjectKind: string | null;
  subjectId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  decision: string | null;
  payloadJson: string | null;
  emittedAt: Date;
}

export interface Store {
  leads: Map<string, LeadRow>;
  projects: Map<string, ProjectRow>;
  bids: Map<number, BidRow>;
  timeline: Map<string, TimelineRow>;
  audits: AuditRow[];
  bidCounter: number;
  /** Fires immediately BEFORE marketLead.updateMany runs — lets a test
   *  interleave a competing writer to exercise the CAS loser path. */
  beforeLeadSwap: (() => void) | null;
  /** Same, for projectTimelineEvent.create (project duplicate guard). */
  beforeTimelineCreate: (() => void) | null;
  /** Forces the in-transaction audit insert to throw (fail-closed test). */
  failAuditWrite: boolean;
  /**
   * Mutations made by a SEPARATE committed transaction while ours is open.
   * A rollback restores our snapshot and then replays these, because another
   * session's committed work does not vanish when our transaction aborts.
   * Without this the fake would "roll back" the competing writer too and the
   * concurrency tests would assert against physically impossible states.
   */
  externalCommits: Array<() => void>;
}

/** Apply a mutation as if a separate session had committed it, and record it
 *  so it survives our transaction's rollback. */
export function commitExternally(store: Store, mutate: () => void): void {
  store.externalCommits.push(mutate);
  mutate();
}

export function emptyStore(): Store {
  return {
    leads: new Map(),
    projects: new Map(),
    bids: new Map(),
    timeline: new Map(),
    audits: [],
    bidCounter: 0,
    beforeLeadSwap: null,
    beforeTimelineCreate: null,
    failAuditWrite: false,
    externalCommits: [],
  };
}

export function resetStore(store: Store): void {
  const fresh = emptyStore();
  store.leads = fresh.leads;
  store.projects = fresh.projects;
  store.bids = fresh.bids;
  store.timeline = fresh.timeline;
  store.audits = fresh.audits;
  store.bidCounter = 0;
  store.beforeLeadSwap = null;
  store.beforeTimelineCreate = null;
  store.failAuditWrite = false;
  store.externalCommits = [];
}

type Snapshot = {
  leads: Map<string, LeadRow>;
  projects: Map<string, ProjectRow>;
  bids: Map<number, BidRow>;
  timeline: Map<string, TimelineRow>;
  audits: AuditRow[];
  bidCounter: number;
};

function snapshot(store: Store): Snapshot {
  return {
    leads: new Map([...store.leads].map(([k, v]) => [k, { ...v }])),
    projects: new Map([...store.projects].map(([k, v]) => [k, { ...v }])),
    bids: new Map([...store.bids].map(([k, v]) => [k, { ...v }])),
    timeline: new Map([...store.timeline].map(([k, v]) => [k, { ...v }])),
    audits: store.audits.map((a) => ({ ...a })),
    bidCounter: store.bidCounter,
  };
}

function restore(store: Store, snap: Snapshot): void {
  store.leads = snap.leads;
  store.projects = snap.projects;
  store.bids = snap.bids;
  store.timeline = snap.timeline;
  store.audits = snap.audits;
  store.bidCounter = snap.bidCounter;
}

/** Prisma-shaped unique-constraint violation. */
function uniqueViolation(target: string): Error & { code: string } {
  const err = new Error(`Unique constraint failed on ${target}`) as Error & {
    code: string;
  };
  err.code = "P2002";
  return err;
}

function pick<T extends object>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = (row as Record<string, unknown>)[key];
  }
  return out as Partial<T>;
}

/** Builds the client surface the promotion service touches. */
export function buildPrismaMock(store: Store) {
  const client = {
    marketLead: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = store.leads.get(where.id);
        return row ? pick(row, select) : null;
      },
      findFirst: async ({
        where,
        select,
      }: {
        where: { promotedToBidId?: number };
        select?: Record<string, boolean>;
      }) => {
        for (const row of store.leads.values()) {
          if (where.promotedToBidId != null && row.promotedToBidId === where.promotedToBidId) {
            return pick(row, select);
          }
        }
        return null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; promotedToBidId: number | null };
        data: Partial<LeadRow>;
      }) => {
        store.beforeLeadSwap?.();
        const row = store.leads.get(where.id);
        // Compare-and-swap semantics: the null predicate must still hold.
        if (!row || row.promotedToBidId !== where.promotedToBidId) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },

    project: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = store.projects.get(where.id);
        return row ? pick(row, select) : null;
      },
    },

    projectTimelineEvent: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = store.timeline.get(where.id);
        return row ? pick(row, select) : null;
      },
      findFirst: async ({
        where,
      }: {
        where: { eventType?: string; sourceRefKind?: string; sourceRefId?: string };
        select?: Record<string, unknown>;
      }) => {
        for (const row of store.timeline.values()) {
          if (where.eventType && row.eventType !== where.eventType) continue;
          if (where.sourceRefKind && row.sourceRefKind !== where.sourceRefKind) continue;
          if (where.sourceRefId && row.sourceRefId !== where.sourceRefId) continue;
          const project = store.projects.get(row.projectId);
          return {
            projectId: row.projectId,
            occurredAt: row.occurredAt,
            actorUserId: row.actorUserId,
            actorEmail: row.actorEmail,
            project: project ? { workingTitle: project.workingTitle } : null,
          };
        }
        return null;
      },
      create: async ({ data }: { data: TimelineRow }) => {
        store.beforeTimelineCreate?.();
        // The deterministic PK is the project duplicate guard — enforce it.
        if (store.timeline.has(data.id)) {
          throw uniqueViolation("ProjectTimelineEvent.id");
        }
        store.timeline.set(data.id, { ...data });
        return { ...data };
      },
    },

    bid: {
      create: async ({
        data,
        select,
      }: {
        data: Omit<BidRow, "id">;
        select?: Record<string, boolean>;
      }) => {
        store.bidCounter += 1;
        const row: BidRow = { id: store.bidCounter, ...data };
        store.bids.set(row.id, row);
        return pick(row, select);
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: number };
        select?: Record<string, boolean>;
      }) => {
        const row = store.bids.get(where.id);
        return row ? pick(row, select) : null;
      },
    },

    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (store.failAuditWrite) throw new Error("audit-write-failed");
        store.audits.push({ ...(data as unknown as AuditRow), emittedAt: new Date() });
        return data;
      },
      findFirst: async ({
        where,
      }: {
        where: { category?: string; action?: string; subjectKind?: string; subjectId?: string };
      }) => {
        for (const a of store.audits) {
          if (where.category && a.category !== where.category) continue;
          if (where.action && a.action !== where.action) continue;
          if (where.subjectKind && a.subjectKind !== where.subjectKind) continue;
          if (where.subjectId && a.subjectId !== where.subjectId) continue;
          return { actorUserId: a.actorUserId, actorEmail: a.actorEmail };
        }
        return null;
      },
      findMany: async ({
        where,
      }: {
        where: { category?: string; subjectKind?: string; subjectId?: string };
      }) =>
        store.audits
          .filter(
            (a) =>
              (!where.category || a.category === where.category) &&
              (!where.subjectKind || a.subjectKind === where.subjectKind) &&
              (!where.subjectId || a.subjectId === where.subjectId)
          )
          .map((a) => ({
            action: a.action,
            decision: a.decision,
            actorEmail: a.actorEmail,
            emittedAt: a.emittedAt,
          })),
    },

    /** Snapshot / rollback — the whole point of this fake. */
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snap = snapshot(store);
      try {
        return await fn(client);
      } catch (err) {
        restore(store, snap);
        // Another session's committed work survives our abort.
        for (const replay of store.externalCommits) replay();
        throw err;
      }
    },
  };

  return client;
}
