// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectGovernance/__tests__/governance.test.ts
//  Phase MI-6 PR3 — Operator governance action tests.
//
//  Uses vi.hoisted in-memory Prisma mock (same pattern as MI-2 resolver and
//  MI-4 entity governance tests). Covers the nine required governance fns:
//    verifyProject, rejectProject, markProjectStalled, transitionProjectState,
//    planProjectMerge, mergeProjects, detachProjectSignal,
//    reattachProjectSignal, addProjectNote
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

interface P {
  id: string;
  workingTitle: string;
  jurisdiction: string | null;
  lifecycleState: string;
  confidence: string;
  reviewStatus: string;
  emergenceProbability: number | null;
  source: string | null;
  notes: string | null;
  mergedIntoProjectId: string | null;
  firstSignalAt: Date | null;
  lastSignalAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
interface PS {
  id: string;
  projectId: string;
  signalKind: string;
  sourceMarketSignalId: string | null;
  sourceRelationshipEdgeId: string | null;
  sourceMarketLeadId: string | null;
  sourceMarketSourceDocId: string | null;
  sourceExternalRef: string | null;
  attachReason: string;
  attachScore: number;
  attachConfidence: string;
  factorJson: string | null;
  attachedAt: Date;
  detachedAt: Date | null;
  detachedReason: string | null;
  detachedBy: string | null;
  updatedAt: Date;
}
interface PE {
  id: string;
  projectId: string;
  entityId: string;
  role: string;
  confidence: string;
  attachReason: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  removed: boolean;
  removedReason: string | null;
  removedBy: string | null;
  attachedAt: Date;
  updatedAt: Date;
}
interface PP {
  id: string;
  projectId: string;
  parcelId: string;
  parcelSource: string;
  address: string | null;
  jurisdiction: string | null;
  lat: number | null;
  lng: number | null;
  areaSqft: number | null;
  attachReason: string;
  confidence: string;
  attachedAt: Date;
  updatedAt: Date;
}
interface PT {
  id: string;
  projectId: string;
  eventType: string;
  occurredAt: Date;
  recordedAt: Date;
  summary: string;
  payloadJson: string | null;
  sourceRefKind: string | null;
  sourceRefId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
}
interface PST {
  id: string;
  projectId: string;
  fromState: string;
  toState: string;
  reason: string;
  triggerSignalRefKind: string | null;
  triggerSignalRefId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  occurredAt: Date;
}
interface PPS {
  id: string;
  projectId: string;
  probability: number;
  lifecycleState: string;
  factorsJson: string;
  computedAt: Date;
  actorUserId: string | null;
  actorEmail: string | null;
  reason: string | null;
}

const { store } = vi.hoisted(() => ({
  store: {
    projects: new Map<string, P>(),
    signals: [] as PS[],
    entities: [] as PE[],
    parcels: [] as PP[],
    timeline: [] as PT[],
    transitions: [] as PST[],
    snapshots: [] as PPS[],
    counter: 0,
  },
}));

function nextId() {
  store.counter += 1;
  return `id${store.counter}`;
}

vi.mock("@/lib/prisma", () => {
  function matchesProject(p: P, where: Record<string, unknown> = {}): boolean {
    if (where.id && p.id !== where.id) return false;
    return true;
  }
  return {
    prisma: {
      project: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return store.projects.get(where.id) ?? null;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<P> }) => {
          const p = store.projects.get(where.id);
          if (!p) throw new Error("not found");
          Object.assign(p, data, { updatedAt: new Date() });
          return { ...p };
        }),
      },
      projectSignal: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return store.signals.find((s) => s.id === where.id) ?? null;
        }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          return (
            store.signals.find(
              (s) =>
                (!where.projectId || s.projectId === where.projectId) &&
                (where.detachedAt === undefined || s.detachedAt === where.detachedAt)
            ) ?? null
          );
        }),
        findMany: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          return store.signals
            .filter(
              (s) =>
                (!where.projectId || s.projectId === where.projectId) &&
                (where.detachedAt === undefined || s.detachedAt === where.detachedAt)
            )
            .map((s) => ({ ...s }));
        }),
        count: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          return store.signals.filter(
            (s) =>
              (!where.projectId || s.projectId === where.projectId) &&
              (where.detachedAt === undefined || s.detachedAt === where.detachedAt)
          ).length;
        }),
        create: vi.fn(async ({ data }: { data: Partial<PS> }) => {
          const row: PS = {
            id: nextId(),
            projectId: data.projectId ?? "",
            signalKind: data.signalKind ?? "MARKET_SIGNAL",
            sourceMarketSignalId: data.sourceMarketSignalId ?? null,
            sourceRelationshipEdgeId: data.sourceRelationshipEdgeId ?? null,
            sourceMarketLeadId: data.sourceMarketLeadId ?? null,
            sourceMarketSourceDocId: data.sourceMarketSourceDocId ?? null,
            sourceExternalRef: data.sourceExternalRef ?? null,
            attachReason: data.attachReason ?? "test",
            attachScore: data.attachScore ?? 0.5,
            attachConfidence: data.attachConfidence ?? "MEDIUM",
            factorJson: data.factorJson ?? null,
            attachedAt: new Date(),
            detachedAt: null,
            detachedReason: null,
            detachedBy: null,
            updatedAt: new Date(),
          };
          store.signals.push(row);
          return { ...row };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PS> }) => {
          const row = store.signals.find((s) => s.id === where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { projectId?: string; detachedAt?: null }; data: Partial<PS> }) => {
          let n = 0;
          for (const s of store.signals) {
            const match =
              (!where.projectId || s.projectId === where.projectId) &&
              (where.detachedAt === undefined || s.detachedAt === where.detachedAt);
            if (match) {
              Object.assign(s, data);
              n += 1;
            }
          }
          return { count: n };
        }),
      },
      projectEntity: {
        findMany: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          return store.entities
            .filter(
              (e) =>
                (!where.projectId || e.projectId === where.projectId) &&
                (where.removed === undefined || e.removed === where.removed)
            )
            .map((e) => ({ ...e }));
        }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          return (
            store.entities.find(
              (e) =>
                (!where.projectId || e.projectId === where.projectId) &&
                (!where.entityId || e.entityId === where.entityId) &&
                (!where.role || e.role === where.role)
            ) ?? null
          );
        }),
        count: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          return store.entities.filter(
            (e) =>
              (!where.projectId || e.projectId === where.projectId) &&
              (where.removed === undefined || e.removed === where.removed)
          ).length;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PE> }) => {
          const row = store.entities.find((e) => e.id === where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        }),
        groupBy: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          const roles = new Set(
            store.entities
              .filter(
                (e) =>
                  (!where.projectId || e.projectId === where.projectId) &&
                  (where.removed === undefined || e.removed === where.removed)
              )
              .map((e) => e.role)
          );
          return [...roles].map((role) => ({ role }));
        }),
      },
      projectParcel: {
        findMany: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          return store.parcels
            .filter((p) => !where.projectId || p.projectId === where.projectId)
            .map((p) => ({ ...p }));
        }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          return (
            store.parcels.find(
              (p) =>
                (!where.projectId || p.projectId === where.projectId) &&
                (!where.parcelId || p.parcelId === where.parcelId) &&
                (!where.parcelSource || p.parcelSource === where.parcelSource)
            ) ?? null
          );
        }),
        count: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
          return store.parcels.filter((p) => !where.projectId || p.projectId === where.projectId).length;
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          const i = store.parcels.findIndex((p) => p.id === where.id);
          if (i < 0) throw new Error("not found");
          const [row] = store.parcels.splice(i, 1);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PP> }) => {
          const row = store.parcels.find((p) => p.id === where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        }),
      },
      projectTimelineEvent: {
        create: vi.fn(async ({ data }: { data: Partial<PT> }) => {
          const row: PT = {
            id: nextId(),
            projectId: data.projectId ?? "",
            eventType: data.eventType ?? "MANUAL_NOTE",
            occurredAt: data.occurredAt ?? new Date(),
            recordedAt: new Date(),
            summary: data.summary ?? "",
            payloadJson: data.payloadJson ?? null,
            sourceRefKind: data.sourceRefKind ?? null,
            sourceRefId: data.sourceRefId ?? null,
            actorUserId: data.actorUserId ?? null,
            actorEmail: data.actorEmail ?? null,
          };
          store.timeline.push(row);
          return { ...row };
        }),
      },
      projectStateTransition: {
        create: vi.fn(async ({ data }: { data: Partial<PST> }) => {
          const row: PST = {
            id: nextId(),
            projectId: data.projectId ?? "",
            fromState: data.fromState ?? "EMERGING",
            toState: data.toState ?? "EMERGING",
            reason: data.reason ?? "test",
            triggerSignalRefKind: data.triggerSignalRefKind ?? null,
            triggerSignalRefId: data.triggerSignalRefId ?? null,
            actorUserId: data.actorUserId ?? null,
            actorEmail: data.actorEmail ?? null,
            occurredAt: new Date(),
          };
          store.transitions.push(row);
          return { ...row };
        }),
      },
      projectProbabilitySnapshot: {
        create: vi.fn(async ({ data }: { data: Partial<PPS> }) => {
          const row: PPS = {
            id: nextId(),
            projectId: data.projectId ?? "",
            probability: data.probability ?? 0,
            lifecycleState: data.lifecycleState ?? "EMERGING",
            factorsJson: data.factorsJson ?? "{}",
            computedAt: new Date(),
            actorUserId: data.actorUserId ?? null,
            actorEmail: data.actorEmail ?? null,
            reason: data.reason ?? null,
          };
          store.snapshots.push(row);
          return { ...row };
        }),
      },
      $transaction: vi.fn(async (arg: unknown) => {
        if (Array.isArray(arg)) {
          // Awaited individually
          return Promise.all(arg);
        }
        // Callback form — pass mocked prisma as tx so calls hit the same store
        const cb = arg as (tx: unknown) => Promise<unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return cb((globalThis as any).__mockProjectPrisma);
      }),
    },
  };
});

// Expose mocked prisma for the $transaction callback path
import { prisma } from "@/lib/prisma";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__mockProjectPrisma = prisma;

import {
  verifyProject,
  rejectProject,
  markProjectStalled,
  transitionProjectState,
  planProjectMerge,
  mergeProjects,
  detachProjectSignal,
  reattachProjectSignal,
  addProjectNote,
} from "../index";

function seedProject(over: Partial<P> = {}): P {
  const row: P = {
    id: nextId(),
    workingTitle: "Test Project",
    jurisdiction: "DSM",
    lifecycleState: "EMERGING",
    confidence: "MEDIUM",
    reviewStatus: "AUTO_AGGREGATED",
    emergenceProbability: null,
    source: "test",
    notes: null,
    mergedIntoProjectId: null,
    firstSignalAt: null,
    lastSignalAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  store.projects.set(row.id, row);
  return row;
}

function seedSignal(projectId: string, over: Partial<PS> = {}): PS {
  const row: PS = {
    id: nextId(),
    projectId,
    signalKind: "MARKET_SIGNAL",
    sourceMarketSignalId: "src-signal",
    sourceRelationshipEdgeId: null,
    sourceMarketLeadId: null,
    sourceMarketSourceDocId: null,
    sourceExternalRef: null,
    attachReason: "test",
    attachScore: 0.7,
    attachConfidence: "MEDIUM",
    factorJson: null,
    attachedAt: new Date(),
    detachedAt: null,
    detachedReason: null,
    detachedBy: null,
    updatedAt: new Date(),
    ...over,
  };
  store.signals.push(row);
  return row;
}

beforeEach(() => {
  store.projects.clear();
  store.signals.length = 0;
  store.entities.length = 0;
  store.parcels.length = 0;
  store.timeline.length = 0;
  store.transitions.length = 0;
  store.snapshots.length = 0;
  store.counter = 0;
});

const actor = { userId: "u1", email: "test@example.com" };

describe("verifyProject", () => {
  test("promotes AUTO_AGGREGATED → VERIFIED + records timeline", async () => {
    const p = seedProject();
    const r = await verifyProject(p.id, actor);
    expect(r.ok).toBe(true);
    expect(store.projects.get(p.id)?.reviewStatus).toBe("VERIFIED");
    expect(store.timeline.some((t) => t.eventType === "REVIEW_ACTION")).toBe(true);
  });
  test("refuses REJECTED", async () => {
    const p = seedProject({ reviewStatus: "REJECTED" });
    const r = await verifyProject(p.id, actor);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/REJECTED/);
  });
  test("refuses MERGED", async () => {
    const p = seedProject({ reviewStatus: "MERGED" });
    const r = await verifyProject(p.id, actor);
    expect(r.ok).toBe(false);
  });
});

describe("rejectProject", () => {
  test("marks REJECTED + appends note + records timeline", async () => {
    const p = seedProject();
    const r = await rejectProject(p.id, actor, "wrong cluster");
    expect(r.ok).toBe(true);
    expect(store.projects.get(p.id)?.reviewStatus).toBe("REJECTED");
    expect(store.projects.get(p.id)?.notes).toMatch(/wrong cluster/);
  });
});

describe("markProjectStalled / transitionProjectState", () => {
  test("markProjectStalled refuses if already STALLED", async () => {
    const p = seedProject({ lifecycleState: "STALLED" });
    const r = await markProjectStalled(p.id, actor);
    expect(r.ok).toBe(false);
  });
  test("markProjectStalled writes ProjectStateTransition + ProjectTimelineEvent", async () => {
    const p = seedProject({ lifecycleState: "EARLY_SIGNAL" });
    const r = await markProjectStalled(p.id, actor, "no activity 6 months");
    expect(r.ok).toBe(true);
    expect(store.projects.get(p.id)?.lifecycleState).toBe("STALLED");
    expect(store.transitions.some((t) => t.fromState === "EARLY_SIGNAL" && t.toState === "STALLED")).toBe(true);
    expect(store.timeline.some((t) => t.eventType === "STATE_TRANSITION")).toBe(true);
  });
  test("transitionProjectState refuses invalid forward jump without override", async () => {
    const p = seedProject({ lifecycleState: "EMERGING" });
    const r = await transitionProjectState(
      { projectId: p.id, toState: "ACTIVE_CONSTRUCTION", reason: "jump" },
      actor
    );
    expect(r.ok).toBe(false);
  });
  test("transitionProjectState allows override on otherwise-invalid jump", async () => {
    const p = seedProject({ lifecycleState: "COMPLETED" });
    const r = await transitionProjectState(
      { projectId: p.id, toState: "STALLED", reason: "operator override", override: true },
      actor
    );
    expect(r.ok).toBe(true);
    expect(store.projects.get(p.id)?.lifecycleState).toBe("STALLED");
  });
});

describe("planProjectMerge / mergeProjects", () => {
  test("planProjectMerge refuses self-merge", async () => {
    const p = seedProject();
    const r = await planProjectMerge(p.id, p.id);
    expect(r.ok).toBe(false);
  });
  test("planProjectMerge refuses MERGED target", async () => {
    const a = seedProject();
    const b = seedProject({ reviewStatus: "MERGED" });
    const r = await planProjectMerge(a.id, b.id);
    expect(r.ok).toBe(false);
  });
  test("mergeProjects repoints signals/entities/parcels, MERGES source", async () => {
    const src = seedProject({ workingTitle: "Walnut Phase 3 (typo)" });
    const tgt = seedProject({ workingTitle: "Walnut Creek Plat 3" });
    seedSignal(src.id, { attachScore: 0.9 });
    seedSignal(src.id, { attachScore: 0.8 });
    store.entities.push({
      id: nextId(),
      projectId: src.id,
      entityId: "hubbell",
      role: "DEVELOPER",
      confidence: "VERIFIED",
      attachReason: "test",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      removed: false,
      removedReason: null,
      removedBy: null,
      attachedAt: new Date(),
      updatedAt: new Date(),
    });
    store.parcels.push({
      id: nextId(),
      projectId: src.id,
      parcelId: "1234567890",
      parcelSource: "assessor:polk",
      address: null,
      jurisdiction: null,
      lat: null,
      lng: null,
      areaSqft: null,
      attachReason: "test",
      confidence: "MEDIUM",
      attachedAt: new Date(),
      updatedAt: new Date(),
    });

    const r = await mergeProjects(src.id, tgt.id, actor);
    expect(r.ok).toBe(true);
    expect(r.data?.signalsToMove).toBe(2);
    expect(r.data?.entitiesToMove).toBe(1);
    expect(r.data?.parcelsToMove).toBe(1);
    expect(store.projects.get(src.id)?.reviewStatus).toBe("MERGED");
    expect(store.projects.get(src.id)?.mergedIntoProjectId).toBe(tgt.id);
    // Signals repointed
    expect(store.signals.filter((s) => s.projectId === tgt.id).length).toBe(2);
    expect(store.signals.filter((s) => s.projectId === src.id).length).toBe(0);
    // Entities repointed
    expect(store.entities.find((e) => e.entityId === "hubbell")?.projectId).toBe(tgt.id);
    // Parcels repointed
    expect(store.parcels.find((p) => p.parcelId === "1234567890")?.projectId).toBe(tgt.id);
    // Both timeline events recorded
    expect(store.timeline.some((t) => t.eventType === "MERGE_INTO" && t.projectId === src.id)).toBe(true);
    expect(store.timeline.some((t) => t.eventType === "MERGE_RECEIVED" && t.projectId === tgt.id)).toBe(true);
  });
});

describe("detachProjectSignal / reattachProjectSignal", () => {
  test("detachProjectSignal soft-detaches + writes timeline event", async () => {
    const p = seedProject();
    const s = seedSignal(p.id);
    const r = await detachProjectSignal(p.id, s.id, actor, "wrong project");
    expect(r.ok).toBe(true);
    const updated = store.signals.find((x) => x.id === s.id);
    expect(updated?.detachedAt).not.toBeNull();
    expect(updated?.detachedReason).toBe("wrong project");
    expect(store.timeline.some((t) => t.eventType === "SIGNAL_DETACHED")).toBe(true);
  });
  test("detachProjectSignal refuses cross-project", async () => {
    const a = seedProject();
    const b = seedProject();
    const s = seedSignal(a.id);
    const r = await detachProjectSignal(b.id, s.id, actor);
    expect(r.ok).toBe(false);
  });
  test("reattachProjectSignal detaches from source + attaches to target", async () => {
    const a = seedProject();
    const b = seedProject();
    const s = seedSignal(a.id, { attachScore: 0.7 });
    const r = await reattachProjectSignal(s.id, b.id, actor, "belongs to b");
    expect(r.ok).toBe(true);
    const detached = store.signals.find((x) => x.id === s.id);
    expect(detached?.detachedAt).not.toBeNull();
    expect(store.signals.filter((x) => x.projectId === b.id && x.detachedAt === null).length).toBe(1);
  });
  test("reattachProjectSignal refuses if target equals source", async () => {
    const a = seedProject();
    const s = seedSignal(a.id);
    const r = await reattachProjectSignal(s.id, a.id, actor);
    expect(r.ok).toBe(false);
  });
});

describe("addProjectNote", () => {
  test("appends a MANUAL_NOTE timeline event", async () => {
    const p = seedProject();
    const r = await addProjectNote(p.id, "Operator observation", actor);
    expect(r.ok).toBe(true);
    expect(store.timeline.some((t) => t.eventType === "MANUAL_NOTE" && t.summary.includes("Operator"))).toBe(true);
  });
  test("refuses empty note", async () => {
    const p = seedProject();
    const r = await addProjectNote(p.id, "   ", actor);
    expect(r.ok).toBe(false);
  });
});
