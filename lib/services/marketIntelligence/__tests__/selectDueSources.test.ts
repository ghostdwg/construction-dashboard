// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/selectDueSources.test.ts
//  Phase O2.2 PR4 — Due-source selection tests.
//
//  Deterministic clock + in-memory prisma mock. Verifies the predicate +
//  ordering + bounds enforcement that the recurring runner depends on.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

type SrcRow = {
  id: string;
  name: string;
  sourceType: string;
  jurisdiction: string;
  isActive: boolean;
  publishStatus: string;
  lastScannedAt: Date | null;
  nextExpectedAt: Date | null;
};

const { store } = vi.hoisted(() => ({
  store: {
    sources: [] as SrcRow[],
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSource: {
      findMany: vi.fn(async (args: {
        where: {
          isActive?: boolean;
          publishStatus?: string;
          OR?: Array<{ nextExpectedAt?: null | { lte: Date } }>;
        };
        orderBy?: unknown;
        select?: Record<string, boolean>;
        take?: number;
      }) => {
        let rows = store.sources.filter((s) => {
          if (args.where.isActive !== undefined && s.isActive !== args.where.isActive) return false;
          if (args.where.publishStatus !== undefined && s.publishStatus !== args.where.publishStatus) return false;
          if (args.where.OR) {
            const ok = args.where.OR.some((cond) => {
              if (cond.nextExpectedAt === null) return s.nextExpectedAt === null;
              if (cond.nextExpectedAt && "lte" in cond.nextExpectedAt) {
                return s.nextExpectedAt !== null && s.nextExpectedAt.getTime() <= cond.nextExpectedAt.lte.getTime();
              }
              return false;
            });
            if (!ok) return false;
          }
          return true;
        });

        // Emulate Prisma asc-with-nulls-last on SQLite.
        rows = [...rows].sort((a, b) => {
          if (a.nextExpectedAt === null && b.nextExpectedAt === null) return a.id < b.id ? -1 : 1;
          if (a.nextExpectedAt === null) return 1;  // nulls last (matches SQLite default)
          if (b.nextExpectedAt === null) return -1;
          const dt = a.nextExpectedAt.getTime() - b.nextExpectedAt.getTime();
          return dt !== 0 ? dt : (a.id < b.id ? -1 : 1);
        });

        if (args.take) rows = rows.slice(0, args.take);

        if (!args.select) return rows;
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(args.select!)) {
            if (args.select![k]) out[k] = (r as unknown as Record<string, unknown>)[k];
          }
          return out;
        });
      }),
      count: vi.fn(async ({ where }: { where: { publishStatus: string } }) => {
        return store.sources.filter((s) => s.publishStatus === where.publishStatus).length;
      }),
    },
  },
}));

import {
  selectDueSources,
  countSourcesByPublishStatus,
  SELECT_DUE_DEFAULT_LIMIT,
  SELECT_DUE_MAX_LIMIT,
} from "../sourceCadence";

function seedSource(over: Partial<SrcRow>): SrcRow {
  const row: SrcRow = {
    id: over.id ?? `src${store.sources.length + 1}`,
    name: over.name ?? "Test source",
    sourceType: over.sourceType ?? "planning_commission",
    jurisdiction: over.jurisdiction ?? "Ankeny",
    isActive: over.isActive ?? true,
    publishStatus: over.publishStatus ?? "HEALTHY",
    lastScannedAt: over.lastScannedAt ?? null,
    nextExpectedAt: over.nextExpectedAt ?? null,
  };
  store.sources.push(row);
  return row;
}

const now = new Date("2026-05-21T12:00:00Z");

beforeEach(() => {
  store.sources.length = 0;
});

describe("selectDueSources — predicate", () => {
  test("only HEALTHY sources are returned", async () => {
    seedSource({ id: "h", publishStatus: "HEALTHY", nextExpectedAt: null });
    seedSource({ id: "s", publishStatus: "STALE_PUBLISH", nextExpectedAt: null });
    seedSource({ id: "o", publishStatus: "OPERATOR_REVIEW", nextExpectedAt: null });
    const due = await selectDueSources({ now });
    expect(due.map((d) => d.id)).toEqual(["h"]);
  });

  test("isActive=false sources are excluded", async () => {
    seedSource({ id: "active", isActive: true, nextExpectedAt: null });
    seedSource({ id: "paused", isActive: false, nextExpectedAt: null });
    const due = await selectDueSources({ now });
    expect(due.map((d) => d.id)).toEqual(["active"]);
  });

  test("nextExpectedAt in the future excludes the source", async () => {
    seedSource({ id: "future", nextExpectedAt: new Date("2026-06-01T00:00:00Z") });
    seedSource({ id: "past",   nextExpectedAt: new Date("2026-05-20T00:00:00Z") });
    const due = await selectDueSources({ now });
    expect(due.map((d) => d.id)).toEqual(["past"]);
  });

  test("nextExpectedAt exactly equal to now → due (boundary inclusive)", async () => {
    seedSource({ id: "boundary", nextExpectedAt: now });
    const due = await selectDueSources({ now });
    expect(due).toHaveLength(1);
  });

  test("nextExpectedAt null → due (never-scanned wins)", async () => {
    seedSource({ id: "fresh", nextExpectedAt: null });
    const due = await selectDueSources({ now });
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("fresh");
  });
});

describe("selectDueSources — ordering", () => {
  test("never-scanned (nextExpectedAt=null) sources come FIRST", async () => {
    seedSource({ id: "scheduled", nextExpectedAt: new Date("2026-05-20T00:00:00Z") });
    seedSource({ id: "fresh",     nextExpectedAt: null });
    seedSource({ id: "older",     nextExpectedAt: new Date("2026-05-15T00:00:00Z") });
    const due = await selectDueSources({ now });
    expect(due.map((d) => d.id)).toEqual(["fresh", "older", "scheduled"]);
  });

  test("among scheduled sources, oldest nextExpectedAt comes first", async () => {
    seedSource({ id: "a", nextExpectedAt: new Date("2026-05-20T00:00:00Z") });
    seedSource({ id: "b", nextExpectedAt: new Date("2026-05-19T00:00:00Z") });
    seedSource({ id: "c", nextExpectedAt: new Date("2026-05-18T00:00:00Z") });
    const due = await selectDueSources({ now });
    expect(due.map((d) => d.id)).toEqual(["c", "b", "a"]);
  });

  test("ties broken by id (deterministic — replay-safe)", async () => {
    const date = new Date("2026-05-20T00:00:00Z");
    seedSource({ id: "z_late", nextExpectedAt: date });
    seedSource({ id: "a_early", nextExpectedAt: date });
    seedSource({ id: "m_mid",  nextExpectedAt: date });
    const due = await selectDueSources({ now });
    expect(due.map((d) => d.id)).toEqual(["a_early", "m_mid", "z_late"]);
  });
});

describe("selectDueSources — bounds", () => {
  test("default limit is SELECT_DUE_DEFAULT_LIMIT", async () => {
    for (let i = 0; i < SELECT_DUE_DEFAULT_LIMIT + 5; i++) {
      seedSource({
        id: `s${String(i).padStart(3, "0")}`,
        nextExpectedAt: new Date(`2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      });
    }
    const due = await selectDueSources({ now });
    expect(due).toHaveLength(SELECT_DUE_DEFAULT_LIMIT);
  });

  test("caller can lower limit", async () => {
    for (let i = 0; i < 10; i++) seedSource({ id: `s${i}`, nextExpectedAt: null });
    const due = await selectDueSources({ now, limit: 3 });
    expect(due).toHaveLength(3);
  });

  test("limit is clamped to SELECT_DUE_MAX_LIMIT", async () => {
    for (let i = 0; i < SELECT_DUE_MAX_LIMIT + 10; i++) {
      seedSource({ id: `s${String(i).padStart(3, "0")}`, nextExpectedAt: null });
    }
    const due = await selectDueSources({ now, limit: 1000 });
    expect(due.length).toBeLessThanOrEqual(SELECT_DUE_MAX_LIMIT);
  });

  test("limit below 1 is clamped to 1", async () => {
    seedSource({ id: "only", nextExpectedAt: null });
    const due = await selectDueSources({ now, limit: 0 });
    expect(due).toHaveLength(1);
  });
});

describe("selectDueSources — empty + edge cases", () => {
  test("no sources → empty array", async () => {
    const due = await selectDueSources({ now });
    expect(due).toEqual([]);
  });

  test("all sources non-HEALTHY → empty array", async () => {
    seedSource({ publishStatus: "STALE_PUBLISH" });
    seedSource({ publishStatus: "OPERATOR_REVIEW" });
    const due = await selectDueSources({ now });
    expect(due).toEqual([]);
  });

  test("default now (no override) uses real time but still respects predicate", async () => {
    seedSource({ id: "due_now", nextExpectedAt: new Date("2020-01-01T00:00:00Z") });
    const due = await selectDueSources(); // no `now` override
    expect(due.some((d) => d.id === "due_now")).toBe(true);
  });
});

describe("countSourcesByPublishStatus", () => {
  test("returns count of sources in the given status", async () => {
    seedSource({ publishStatus: "HEALTHY" });
    seedSource({ publishStatus: "HEALTHY" });
    seedSource({ publishStatus: "STALE_PUBLISH" });
    seedSource({ publishStatus: "OPERATOR_REVIEW" });
    expect(await countSourcesByPublishStatus("HEALTHY")).toBe(2);
    expect(await countSourcesByPublishStatus("STALE_PUBLISH")).toBe(1);
    expect(await countSourcesByPublishStatus("OPERATOR_REVIEW")).toBe(1);
  });
});
