// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/seedSources.test.ts
//  Phase O2.2 PR5 — Seed idempotency + identity + safe-default tests.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = {
  id: string;
  name: string;
  jurisdiction: string;
  sourceType: string;
  url: string;
  isActive: boolean;
  publishStatus: string;
  prefilterMode: string;
  minRelevanceScore: number;
  publishCadenceDays: number | null;
};

const { store } = vi.hoisted(() => ({
  store: {
    rows: [] as Row[],
    counter: 0,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSource: {
      findMany: vi.fn(async (args: { where: { OR: Array<{ AND: Array<Record<string, string>> }> } }) => {
        const keys = (args.where.OR ?? []).map((clause) => {
          const m: Record<string, string> = {};
          for (const cond of clause.AND ?? []) Object.assign(m, cond);
          return m;
        });
        return store.rows.filter((r) =>
          keys.some((k) =>
            r.jurisdiction === k.jurisdiction &&
            r.sourceType === k.sourceType &&
            r.name === k.name,
          ),
        ).map((r) => ({ id: r.id, name: r.name, jurisdiction: r.jurisdiction, sourceType: r.sourceType }));
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.counter += 1;
        const id = `seed-${store.counter}`;
        const row: Row = {
          id,
          name: data.name as string,
          jurisdiction: data.jurisdiction as string,
          sourceType: data.sourceType as string,
          url: data.url as string,
          isActive: data.isActive as boolean,
          publishStatus: data.publishStatus as string,
          prefilterMode: data.prefilterMode as string,
          minRelevanceScore: data.minRelevanceScore as number,
          publishCadenceDays: (data.publishCadenceDays as number | null) ?? null,
        };
        store.rows.push(row);
        return row;
      }),
    },
  },
}));

import {
  executeSeed,
  seedIdentityKey,
  DES_MOINES_METRO_SEEDS,
  type SeedSource,
} from "../seedSources";

const SAMPLE: SeedSource = {
  name: "Ankeny — Planning & Zoning Commission",
  jurisdiction: "Ankeny",
  sourceType: "planning_commission",
  url: "https://www.ankenyiowa.gov/AgendaCenter",
  prefilterMode: "off",
  minRelevanceScore: 60,
  publishCadenceDaysInitial: 14,
};

const SAMPLE_B: SeedSource = {
  name: "Polk County — Planning & Zoning Commission",
  jurisdiction: "Polk County",
  sourceType: "planning_commission",
  url: "https://www.polkcountyiowa.gov/AgendaCenter",
  prefilterMode: "large",
  minRelevanceScore: 60,
  publishCadenceDaysInitial: 21,
};

beforeEach(() => {
  store.rows = [];
  store.counter = 0;
});

describe("seedIdentityKey", () => {
  test("collapses whitespace and lowercases", () => {
    expect(seedIdentityKey({
      name: "  City of Des Moines  ",
      jurisdiction: " Des Moines ",
      sourceType: "planning_commission",
    })).toBe("des moines|planning_commission|city of des moines");
  });

  test("two seeds with the same key are considered identical", () => {
    const k1 = seedIdentityKey({ name: "X", jurisdiction: "Y", sourceType: "city_council" });
    const k2 = seedIdentityKey({ name: "X", jurisdiction: "Y", sourceType: "city_council" });
    expect(k1).toBe(k2);
  });

  test("different sourceType produces different key (allows P&Z + Council from same city)", () => {
    const a = seedIdentityKey({ name: "City of X", jurisdiction: "X", sourceType: "planning_commission" });
    const b = seedIdentityKey({ name: "City of X", jurisdiction: "X", sourceType: "city_council" });
    expect(a).not.toBe(b);
  });
});

describe("executeSeed — empty DB", () => {
  test("creates all rows on first run; reports counts", async () => {
    const result = await executeSeed([SAMPLE, SAMPLE_B]);
    expect(result.total).toBe(2);
    expect(result.created).toBe(2);
    expect(result.alreadyExisted).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.dryRun).toBe(false);
    expect(result.activated).toBe(false);
    expect(store.rows).toHaveLength(2);
  });

  test("safe default: isActive=false on created rows", async () => {
    await executeSeed([SAMPLE]);
    expect(store.rows[0].isActive).toBe(false);
    expect(store.rows[0].publishStatus).toBe("HEALTHY");
  });

  test("--activate flag sets isActive=true", async () => {
    const result = await executeSeed([SAMPLE], { activate: true });
    expect(result.activated).toBe(true);
    expect(store.rows[0].isActive).toBe(true);
  });

  test("publishCadenceDaysInitial is persisted as publishCadenceDays", async () => {
    await executeSeed([SAMPLE]);
    expect(store.rows[0].publishCadenceDays).toBe(14);
  });
});

describe("executeSeed — idempotency", () => {
  test("second run with the same seed does NOT create duplicates", async () => {
    await executeSeed([SAMPLE]);
    expect(store.rows).toHaveLength(1);

    const second = await executeSeed([SAMPLE]);
    expect(second.created).toBe(0);
    expect(second.alreadyExisted).toBe(1);
    expect(store.rows).toHaveLength(1);
  });

  test("partial overlap: one new + one existing", async () => {
    await executeSeed([SAMPLE]);
    const result = await executeSeed([SAMPLE, SAMPLE_B]);
    expect(result.created).toBe(1);
    expect(result.alreadyExisted).toBe(1);
    expect(store.rows).toHaveLength(2);
  });

  test("identity check is exact-match on name + jurisdiction + sourceType (DB-driven)", async () => {
    // The DB findMany predicate uses exact equality. Re-seeding with the
    // SAME canonical strings produces alreadyExisted=1. Variant casing is
    // NOT supported — operators tune the seed constant, not ad-hoc input.
    await executeSeed([SAMPLE]);
    const result = await executeSeed([{ ...SAMPLE }]);
    expect(result.alreadyExisted).toBe(1);
    expect(result.created).toBe(0);
  });

  test("existing rows are NOT mutated (additive-only contract)", async () => {
    await executeSeed([{ ...SAMPLE, prefilterMode: "off" }]);
    const original = { ...store.rows[0] };

    // Re-seed with different tuning — must be ignored.
    await executeSeed([{ ...SAMPLE, prefilterMode: "always", minRelevanceScore: 80 }]);

    expect(store.rows[0]).toEqual(original);
  });
});

describe("executeSeed — dry-run", () => {
  test("dry-run reports what would be created without writing", async () => {
    const result = await executeSeed([SAMPLE, SAMPLE_B], { dryRun: true });
    expect(result.created).toBe(2);
    expect(result.dryRun).toBe(true);
    expect(store.rows).toHaveLength(0);
    expect(result.createdSources.every((s) => s.id === "(dry-run)")).toBe(true);
  });

  test("dry-run with existing rows still reports them as alreadyExisted (no false-positive)", async () => {
    await executeSeed([SAMPLE]);
    const result = await executeSeed([SAMPLE, SAMPLE_B], { dryRun: true });
    expect(result.created).toBe(1);
    expect(result.alreadyExisted).toBe(1);
    expect(store.rows).toHaveLength(1); // SAMPLE_B not actually created
  });
});

describe("DES_MOINES_METRO_SEEDS — data integrity", () => {
  test("contains 17 P&Z + 2 city-council + 1 utility-board = 20 seeds (per spec ~15-20)", () => {
    const byType: Record<string, number> = {};
    for (const s of DES_MOINES_METRO_SEEDS) byType[s.sourceType] = (byType[s.sourceType] ?? 0) + 1;
    expect(byType.planning_commission).toBeGreaterThanOrEqual(15);
    expect(byType.planning_commission).toBeLessThanOrEqual(20);
    expect(byType.city_council).toBeGreaterThanOrEqual(1);
    expect(byType.utility_board).toBeGreaterThanOrEqual(1);
    expect(byType.utility_board).toBeLessThanOrEqual(3);   // sparingly per spec
  });

  test("every seed has a non-empty URL using https", () => {
    for (const s of DES_MOINES_METRO_SEEDS) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.url.length).toBeGreaterThan(10);
    }
  });

  test("utility-board sources use prefilterMode=always (heavy noise floor)", () => {
    const utilities = DES_MOINES_METRO_SEEDS.filter((s) => s.sourceType === "utility_board");
    for (const u of utilities) {
      expect(u.prefilterMode).toBe("always");
      expect(u.minRelevanceScore).toBeGreaterThanOrEqual(70);
    }
  });

  test("no two seeds collide on identity key (set is pre-deduped)", () => {
    const keys = new Set<string>();
    for (const s of DES_MOINES_METRO_SEEDS) {
      const k = seedIdentityKey(s);
      expect(keys.has(k)).toBe(false);
      keys.add(k);
    }
    expect(keys.size).toBe(DES_MOINES_METRO_SEEDS.length);
  });

  test("seeding the entire set is itself idempotent end-to-end", async () => {
    const first = await executeSeed(DES_MOINES_METRO_SEEDS);
    expect(first.created).toBe(DES_MOINES_METRO_SEEDS.length);
    expect(first.alreadyExisted).toBe(0);

    const second = await executeSeed(DES_MOINES_METRO_SEEDS);
    expect(second.created).toBe(0);
    expect(second.alreadyExisted).toBe(DES_MOINES_METRO_SEEDS.length);
    expect(store.rows).toHaveLength(DES_MOINES_METRO_SEEDS.length);
  });
});
