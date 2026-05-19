// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityGovernance/__tests__/governance.test.ts
//  Phase MI-4 — Governance service tests.
//
//  Mocks @/lib/prisma via vi.hoisted (same pattern as the MI-2 resolver tests).
//  Covers the happy paths and the principal refusal conditions for the five
//  operator actions.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

interface E {
  id: string;
  canonicalName: string;
  normalizedName: string;
  entityType: string;
  reviewStatus: string;
  confidence: string;
  source: string | null;
  notes: string | null;
}
interface A {
  id: string;
  entityId: string;
  alias: string;
  normalizedAlias: string;
  confidence: string;
  source: string | null;
}
interface ER {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: string;
}
interface RE {
  id: string;
  fromEntityId: string | null;
  toEntityId: string | null;
}

const { store } = vi.hoisted(() => ({
  store: {
    entities: new Map<string, E>(),
    aliases: [] as A[],
    entityRelationships: [] as ER[],
    relationshipEdges: [] as RE[],
    counter: 0,
  },
}));

function nextId() {
  store.counter += 1;
  return `e${store.counter}`;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.entities.get(where.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<E> }) => {
        const row = store.entities.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      }),
    },
    entityAlias: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.aliases.find((a) => a.id === where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { entityId?: string; normalizedAlias?: string } }) => {
        return (
          store.aliases.find(
            (a) =>
              (!where.entityId || a.entityId === where.entityId) &&
              (!where.normalizedAlias || a.normalizedAlias === where.normalizedAlias)
          ) ?? null
        );
      }),
      findMany: vi.fn(async ({ where }: { where: { entityId?: string } }) => {
        return store.aliases.filter((a) => !where.entityId || a.entityId === where.entityId).map((a) => ({ ...a }));
      }),
      count: vi.fn(async ({ where }: { where: { entityId?: string } }) => {
        return store.aliases.filter((a) => !where.entityId || a.entityId === where.entityId).length;
      }),
      create: vi.fn(async ({ data }: { data: Partial<A> }) => {
        // simulate unique-violation on (entityId, normalizedAlias)
        const collision = store.aliases.find(
          (a) => a.entityId === data.entityId && a.normalizedAlias === data.normalizedAlias
        );
        if (collision) {
          const err = new Error("Unique constraint failed") as Error & { code?: string };
          err.code = "P2002";
          throw err;
        }
        const row: A = {
          id: nextId(),
          entityId: data.entityId ?? "",
          alias: data.alias ?? "",
          normalizedAlias: data.normalizedAlias ?? "",
          confidence: data.confidence ?? "MEDIUM",
          source: data.source ?? null,
        };
        store.aliases.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<A> }) => {
        const row = store.aliases.find((a) => a.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const idx = store.aliases.findIndex((a) => a.id === where.id);
        if (idx < 0) throw new Error("not found");
        const [row] = store.aliases.splice(idx, 1);
        return row;
      }),
    },
    entityRelationship: {
      count: vi.fn(async ({ where }: { where: { fromEntityId?: string; toEntityId?: string } }) => {
        return store.entityRelationships.filter(
          (r) =>
            (!where.fromEntityId || r.fromEntityId === where.fromEntityId) &&
            (!where.toEntityId || r.toEntityId === where.toEntityId)
        ).length;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { fromEntityId?: string; toEntityId?: string }; data: Partial<ER> }) => {
        let count = 0;
        for (const r of store.entityRelationships) {
          if (where.fromEntityId && r.fromEntityId === where.fromEntityId) {
            Object.assign(r, data);
            count += 1;
          } else if (where.toEntityId && r.toEntityId === where.toEntityId) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    relationshipEdge: {
      updateMany: vi.fn(async ({ where, data }: { where: { fromEntityId?: string; toEntityId?: string }; data: Partial<RE> }) => {
        let count = 0;
        for (const r of store.relationshipEdges) {
          if (where.fromEntityId && r.fromEntityId === where.fromEntityId) {
            Object.assign(r, data);
            count += 1;
          } else if (where.toEntityId && r.toEntityId === where.toEntityId) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      // We're using the same mocked prisma object as `tx` so callbacks operate
      // on the same store. No actual isolation semantics, but sufficient to
      // verify ordering + atomic write paths.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return cb((globalThis as any).__mockPrisma);
    }),
  },
}));

import {
  verifyEntity,
  rejectEntity,
  unrejectEntity,
  planMerge,
  mergeEntities,
  addAlias,
  removeAlias,
} from "../index";

// Expose the same mocked prisma to $transaction's callback
import { prisma } from "@/lib/prisma";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__mockPrisma = prisma;

function seedEntity(canonicalName: string, normalizedName: string, opts: { reviewStatus?: string } = {}): E {
  const row: E = {
    id: nextId(),
    canonicalName,
    normalizedName,
    entityType: "Developer",
    reviewStatus: opts.reviewStatus ?? "AUTO_MATCHED",
    confidence: "MEDIUM",
    source: "test",
    notes: null,
  };
  store.entities.set(row.id, row);
  return row;
}

beforeEach(() => {
  store.entities.clear();
  store.aliases.length = 0;
  store.entityRelationships.length = 0;
  store.relationshipEdges.length = 0;
  store.counter = 0;
});

const actor = { userId: "u1", email: "test@example.com" };

describe("verifyEntity", () => {
  test("promotes AUTO_MATCHED → VERIFIED", async () => {
    const e = seedEntity("Hubbell Realty", "hubbell");
    const r = await verifyEntity(e.id, actor);
    expect(r.ok).toBe(true);
    expect(store.entities.get(e.id)?.reviewStatus).toBe("VERIFIED");
    expect(store.entities.get(e.id)?.confidence).toBe("VERIFIED");
  });
  test("refuses to verify a REJECTED entity", async () => {
    const e = seedEntity("Stale Inc", "staleinc", { reviewStatus: "REJECTED" });
    const r = await verifyEntity(e.id, actor);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/REJECTED/);
  });
  test("returns error on unknown id", async () => {
    const r = await verifyEntity("nope", actor);
    expect(r.ok).toBe(false);
  });
});

describe("rejectEntity + unrejectEntity", () => {
  test("rejectEntity sets REJECTED and appends note when reason provided", async () => {
    const e = seedEntity("Trash Entity", "trash");
    const r = await rejectEntity(e.id, actor, "obviously spam");
    expect(r.ok).toBe(true);
    expect(store.entities.get(e.id)?.reviewStatus).toBe("REJECTED");
    expect(store.entities.get(e.id)?.notes).toMatch(/obviously spam/);
  });
  test("unrejectEntity restores PENDING_REVIEW only on REJECTED rows", async () => {
    const a = seedEntity("X", "x", { reviewStatus: "VERIFIED" });
    const aResult = await unrejectEntity(a.id, actor);
    expect(aResult.ok).toBe(false);

    const b = seedEntity("Y", "y", { reviewStatus: "REJECTED" });
    const bResult = await unrejectEntity(b.id, actor);
    expect(bResult.ok).toBe(true);
    expect(store.entities.get(b.id)?.reviewStatus).toBe("PENDING_REVIEW");
  });
});

describe("planMerge / mergeEntities", () => {
  test("planMerge refuses identical source and target", async () => {
    const a = seedEntity("A", "a");
    const r = await planMerge(a.id, a.id);
    expect(r.ok).toBe(false);
  });

  test("mergeEntities moves aliases, repoints relationships, REJECTs source", async () => {
    const src = seedEntity("Hubbell Realty Company", "hubbell");
    const tgt = seedEntity("Hubbell Holdings", "hubbellholdings");
    store.aliases.push({
      id: "a1",
      entityId: src.id,
      alias: "Hubbell Co",
      normalizedAlias: "hubbellco",
      confidence: "MEDIUM",
      source: "backfill",
    });
    store.entityRelationships.push({
      id: "r1",
      fromEntityId: src.id,
      toEntityId: "weitz",
      relationshipType: "BUILT",
    });
    store.relationshipEdges.push({ id: "le1", fromEntityId: src.id, toEntityId: "weitz" });

    const merge = await mergeEntities(src.id, tgt.id, actor);
    expect(merge.ok).toBe(true);

    // Source canonical name copied to target as alias
    const tgtAliases = store.aliases.filter((a) => a.entityId === tgt.id);
    expect(tgtAliases.some((a) => a.alias === "Hubbell Realty Company")).toBe(true);
    // Source's existing alias moved to target
    expect(tgtAliases.some((a) => a.alias === "Hubbell Co")).toBe(true);
    // Source has no aliases left
    expect(store.aliases.filter((a) => a.entityId === src.id)).toHaveLength(0);
    // EntityRelationship repointed
    expect(store.entityRelationships[0].fromEntityId).toBe(tgt.id);
    // RelationshipEdge repointed
    expect(store.relationshipEdges[0].fromEntityId).toBe(tgt.id);
    // Source marked REJECTED
    expect(store.entities.get(src.id)?.reviewStatus).toBe("REJECTED");
    // Source notes mention forwarding
    expect(store.entities.get(src.id)?.notes).toMatch(/Merged into/);
  });

  test("merge into REJECTED target is refused", async () => {
    const src = seedEntity("A", "a");
    const tgt = seedEntity("B", "b", { reviewStatus: "REJECTED" });
    const r = await mergeEntities(src.id, tgt.id, actor);
    expect(r.ok).toBe(false);
  });
});

describe("addAlias / removeAlias", () => {
  test("addAlias normalizes the input and stores", async () => {
    const e = seedEntity("Hubbell Realty Company", "hubbell");
    const r = await addAlias(e.id, { alias: "Hubbell, LLC" }, actor);
    expect(r.ok).toBe(true);
    const stored = store.aliases.find((a) => a.id === r.data?.aliasId);
    expect(stored?.normalizedAlias).toBe("hubbell");
    expect(stored?.source).toBe("manual");
  });

  test("addAlias rejects empty input", async () => {
    const e = seedEntity("Hubbell", "hubbell");
    const r = await addAlias(e.id, { alias: "   " }, actor);
    expect(r.ok).toBe(false);
  });

  test("addAlias surfaces duplicate-on-entity collision as user-facing error", async () => {
    const e = seedEntity("Hubbell Realty Company", "hubbell");
    await addAlias(e.id, { alias: "Hubbell, LLC" }, actor);
    const second = await addAlias(e.id, { alias: "Hubbell, LLC" }, actor);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already exists/i);
  });

  test("removeAlias refuses if alias does not belong to entity", async () => {
    const e1 = seedEntity("A", "a");
    const e2 = seedEntity("B", "b");
    const created = await addAlias(e1.id, { alias: "alpha" }, actor);
    const cross = await removeAlias(e2.id, created.data!.aliasId, actor);
    expect(cross.ok).toBe(false);
  });

  test("removeAlias deletes valid alias", async () => {
    const e = seedEntity("A", "a");
    const created = await addAlias(e.id, { alias: "alpha" }, actor);
    const removed = await removeAlias(e.id, created.data!.aliasId, actor);
    expect(removed.ok).toBe(true);
    expect(store.aliases.find((a) => a.id === created.data!.aliasId)).toBeUndefined();
  });
});
