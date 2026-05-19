// Phase MI-7 — Parcel resolver tests.
//
// Covers Passes 1–5 of resolveParcel via an in-memory Prisma mock.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    parcels: new Map<string, ParcelRow>(),
    aliases: [] as AliasRow[],
    counter: 0,
  },
}));

interface ParcelRow {
  id: string;
  canonicalRef: string;
  normalizedRef: string;
  parcelKind: string;
  assessorParcelId: string | null;
  legalDescription: string | null;
  primaryAddress: string | null;
  jurisdiction: string | null;
  state: string | null;
  centroidLat: number | null;
  centroidLng: number | null;
  reviewStatus: string;
  confidence: string;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AliasRow {
  id: string;
  parcelId: string;
  alias: string;
  normalizedAlias: string;
  aliasKind: string;
  confidence: string;
}

function nextId(): string {
  store.counter += 1;
  return `p${store.counter}`;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    parcel: {
      findFirst: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
        for (const row of store.parcels.values()) {
          if (where.normalizedRef && row.normalizedRef !== where.normalizedRef) continue;
          if (where.jurisdiction && row.jurisdiction !== where.jurisdiction) continue;
          if (where.NOT && typeof where.NOT === "object") {
            const not = where.NOT as Record<string, unknown>;
            const status = not.reviewStatus as { in?: string[] } | undefined;
            if (status?.in?.includes(row.reviewStatus)) continue;
          }
          return { ...row };
        }
        return null;
      }),
      findMany: vi.fn(async ({ where = {}, take }: { where?: Record<string, unknown>; take?: number } = {}) => {
        const list = [...store.parcels.values()].filter((row) => {
          if (where.parcelKind && row.parcelKind !== where.parcelKind) return false;
          if (where.jurisdiction && row.jurisdiction !== where.jurisdiction) return false;
          if (where.id && typeof where.id === "object") {
            const idClause = where.id as { not?: string };
            if (idClause.not && row.id === idClause.not) return false;
          }
          if (where.NOT && typeof where.NOT === "object") {
            const not = where.NOT as Record<string, unknown>;
            const status = not.reviewStatus as { in?: string[] } | undefined;
            if (status?.in?.includes(row.reviewStatus)) return false;
          }
          return true;
        });
        return take ? list.slice(0, take) : list;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => {
        if (!where.id) return null;
        const row = store.parcels.get(where.id);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<ParcelRow> }) => {
        for (const r of store.parcels.values()) {
          if (r.normalizedRef === data.normalizedRef) {
            const err = new Error("Unique constraint failed on (`normalizedRef`)") as Error & { code?: string };
            err.code = "P2002";
            throw err;
          }
        }
        const id = nextId();
        const row: ParcelRow = {
          id,
          canonicalRef: data.canonicalRef ?? "",
          normalizedRef: data.normalizedRef ?? "",
          parcelKind: data.parcelKind ?? "UNKNOWN",
          assessorParcelId: data.assessorParcelId ?? null,
          legalDescription: data.legalDescription ?? null,
          primaryAddress: data.primaryAddress ?? null,
          jurisdiction: data.jurisdiction ?? null,
          state: data.state ?? null,
          centroidLat: data.centroidLat ?? null,
          centroidLng: data.centroidLng ?? null,
          reviewStatus: data.reviewStatus ?? "AUTO",
          confidence: data.confidence ?? "MEDIUM",
          source: data.source ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.parcels.set(id, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ParcelRow> }) => {
        const row = store.parcels.get(where.id);
        if (!row) throw new Error("Parcel not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      }),
    },
    parcelAlias: {
      findFirst: vi.fn(async ({ where, include }: { where: { normalizedAlias?: string }; include?: { parcel?: boolean } }) => {
        const alias = store.aliases.find((a) => a.normalizedAlias === where.normalizedAlias);
        if (!alias) return null;
        if (include?.parcel) {
          const parcel = store.parcels.get(alias.parcelId);
          return parcel ? { ...alias, parcel: { ...parcel } } : null;
        }
        return { ...alias };
      }),
    },
  },
}));

beforeEach(() => {
  store.parcels.clear();
  store.aliases.length = 0;
  store.counter = 0;
});

import { resolveParcel } from "../resolver";

function seedParcel(partial: Partial<ParcelRow> & { canonicalRef: string; normalizedRef: string }): ParcelRow {
  const id = nextId();
  const row: ParcelRow = {
    id,
    canonicalRef: partial.canonicalRef,
    normalizedRef: partial.normalizedRef,
    parcelKind: partial.parcelKind ?? "ADDRESS_ONLY",
    assessorParcelId: partial.assessorParcelId ?? null,
    legalDescription: partial.legalDescription ?? null,
    primaryAddress: partial.primaryAddress ?? null,
    jurisdiction: partial.jurisdiction ?? null,
    state: partial.state ?? null,
    centroidLat: partial.centroidLat ?? null,
    centroidLng: partial.centroidLng ?? null,
    reviewStatus: partial.reviewStatus ?? "AUTO",
    confidence: partial.confidence ?? "MEDIUM",
    source: partial.source ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  store.parcels.set(id, row);
  return row;
}

describe("resolveParcel — Pass 1 exact normalized match", () => {
  test("matches exact assessor parcel id", async () => {
    seedParcel({
      canonicalRef: "010-12345-678",
      normalizedRef: "01012345678",
      parcelKind: "ASSESSOR",
    });
    const result = await resolveParcel({ rawRef: "010-12345-678" });
    expect(result.match.pass).toBe(1);
    expect(result.match.parcel).toBeTruthy();
    expect(result.match.confidence).toBe("HIGH");
    expect(result.created).toBe(false);
  });

  test("matches across format variants of same assessor id", async () => {
    seedParcel({
      canonicalRef: "010-12345-678",
      normalizedRef: "01012345678",
      parcelKind: "ASSESSOR",
    });
    const result = await resolveParcel({ rawRef: "Polk Co 010 12345 678" });
    expect(result.match.pass).toBe(1);
    expect(result.match.parcel?.normalizedRef).toBe("01012345678");
  });

  test("skips MERGED / REJECTED rows", async () => {
    seedParcel({
      canonicalRef: "010-12345-678",
      normalizedRef: "01012345678",
      parcelKind: "ASSESSOR",
      reviewStatus: "REJECTED",
    });
    const result = await resolveParcel(
      { rawRef: "010-12345-678" },
      { create: false }
    );
    expect(result.match.pass).toBe(5);
    expect(result.match.parcel).toBeNull();
  });
});

describe("resolveParcel — Pass 3 fuzzy", () => {
  test("matches typo'd parkway/pkway/pkwy variants via fuzzy", async () => {
    seedParcel({
      canonicalRef: "5301 Mills Civic Pkwy",
      normalizedRef: "5301millscivicpkwy",
      parcelKind: "ADDRESS_ONLY",
      jurisdiction: "West Des Moines",
    });
    // Normalize collapses pkway → pkwy via the suffix table, so this is
    // really a Pass 1 match. Confirm with a real fuzzy near-miss instead.
    const result = await resolveParcel(
      { rawRef: "5301 Mills Civics Pkwy", jurisdiction: "West Des Moines" }
    );
    expect(result.match.pass).toBeGreaterThanOrEqual(1);
    expect(result.match.pass).toBeLessThanOrEqual(3);
    expect(result.match.parcel?.id).toBeTruthy();
  });
});

describe("resolveParcel — Pass 5 no match, auto-create", () => {
  test("creates a new parcel when no candidates exist", async () => {
    const result = await resolveParcel(
      { rawRef: "9999 Empty Lot Rd", jurisdiction: "Des Moines" }
    );
    expect(result.match.pass).toBe(5);
    expect(result.created).toBe(true);
    expect(result.parcel?.reviewStatus).toBe("AUTO");
    expect(result.parcel?.parcelKind).toBe("ADDRESS_ONLY");
  });

  test("read-only mode returns no_match instead of creating", async () => {
    const result = await resolveParcel(
      { rawRef: "9999 Empty Lot Rd" },
      { create: false }
    );
    expect(result.match.pass).toBe(5);
    expect(result.created).toBe(false);
    expect(result.parcel).toBeNull();
  });
});

describe("resolveParcel — Pass 2 alias match", () => {
  test("matches via alias normalized form", async () => {
    const seeded = seedParcel({
      canonicalRef: "Polk Co 010-12345-678",
      normalizedRef: "01012345678",
      parcelKind: "ASSESSOR",
    });
    store.aliases.push({
      id: "a1",
      parcelId: seeded.id,
      alias: "5301 Mills Civic Pkwy",
      normalizedAlias: "5301millscivicpkwy",
      aliasKind: "ADDRESS",
      confidence: "MEDIUM",
    });
    const result = await resolveParcel({ rawRef: "5301 Mills Civic Pkwy" });
    expect(result.match.pass).toBeLessThanOrEqual(2);
    expect(result.match.parcel?.id).toBe(seeded.id);
  });
});

describe("resolveParcel — empty / unnormalizable input", () => {
  test("returns no_match without throwing", async () => {
    const result = await resolveParcel({ rawRef: "" });
    expect(result.match.pass).toBe(5);
    expect(result.match.reason).toBe("empty_or_unnormalizable_input");
    expect(result.parcel).toBeNull();
  });
});
