// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/sourceCadence.test.ts
//  Phase O2.2 PR2 — Cadence intelligence tests.
//
//  Pure helpers tested directly (no mocks). DB-touching helpers tested via
//  an in-memory prisma mock that mirrors the surface sourceCadence.ts uses.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

// ── In-memory prisma mock ──────────────────────────────────────────────────

const { store } = vi.hoisted(() => ({
  store: {
    sources: new Map<string, {
      id: string;
      lastScannedAt: Date | null;
      nextExpectedAt: Date | null;
      publishStatus: string;
      consecutiveEmptyRuns: number;
      lastEmptyRunAt: Date | null;
      publishCadenceDays: number | null;
      cadenceConfidence: string | null;
      cadenceSampleSize: number | null;
      lastDocSeenAt: Date | null;
    }>(),
    samples: [] as Array<{ id: string; sourceId: string; docDate: Date; observedAt: Date }>,
    sourceUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    counter: 0,
  },
}));

function nextId(): string {
  store.counter += 1;
  return `id${store.counter}`;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSource: {
      findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = store.sources.get(where.id);
        if (!row) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (row as unknown as Record<string, unknown>)[k];
        }
        return out;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        store.sourceUpdates.push({ id: where.id, data });
        const row = store.sources.get(where.id);
        if (row) Object.assign(row, data);
        return { id: where.id, ...data };
      }),
    },
    marketSourceCadenceSample: {
      create: vi.fn(async ({ data }: { data: { sourceId: string; docDate: Date; observedAt?: Date } }) => {
        const row = {
          id: nextId(),
          sourceId: data.sourceId,
          docDate: data.docDate,
          observedAt: data.observedAt ?? new Date(),
        };
        store.samples.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where, orderBy, select, take }: {
        where: { sourceId: string };
        orderBy?: { docDate?: "asc" | "desc"; observedAt?: "asc" | "desc" };
        select?: Record<string, boolean>;
        take?: number;
      }) => {
        let rows = store.samples.filter((s) => s.sourceId === where.sourceId);
        if (orderBy?.docDate === "asc") rows = [...rows].sort((a, b) => a.docDate.getTime() - b.docDate.getTime());
        else if (orderBy?.docDate === "desc") rows = [...rows].sort((a, b) => b.docDate.getTime() - a.docDate.getTime());
        else if (orderBy?.observedAt === "asc") rows = [...rows].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
        else if (orderBy?.observedAt === "desc") rows = [...rows].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
        if (take != null) rows = rows.slice(0, take);
        if (!select) return rows;
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) {
            if (select[k]) out[k] = (r as unknown as Record<string, unknown>)[k];
          }
          return out;
        });
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        const idSet = new Set(where.id.in);
        const before = store.samples.length;
        store.samples = store.samples.filter((s) => !idSet.has(s.id));
        return { count: before - store.samples.length };
      }),
    },
  },
}));

import {
  estimateCadence,
  computeNextExpectedAt,
  determineDueStatus,
  determineRunOutcome,
  recordDocDate,
  recomputeCadence,
  recordRunOutcome,
  isSourceDue,
  __internals,
} from "../sourceCadence";

type SourceSeed = {
  id?: string;
  lastScannedAt?: Date | null;
  nextExpectedAt?: Date | null;
  publishStatus?: string;
  consecutiveEmptyRuns?: number;
  lastEmptyRunAt?: Date | null;
  publishCadenceDays?: number | null;
  cadenceConfidence?: string | null;
  cadenceSampleSize?: number | null;
  lastDocSeenAt?: Date | null;
};

function seedSource(over: SourceSeed = {}): string {
  const id = over.id ?? nextId();
  store.sources.set(id, {
    id,
    lastScannedAt: over.lastScannedAt ?? null,
    nextExpectedAt: over.nextExpectedAt ?? null,
    publishStatus: over.publishStatus ?? "HEALTHY",
    consecutiveEmptyRuns: over.consecutiveEmptyRuns ?? 0,
    lastEmptyRunAt: over.lastEmptyRunAt ?? null,
    publishCadenceDays: over.publishCadenceDays ?? null,
    cadenceConfidence: over.cadenceConfidence ?? null,
    cadenceSampleSize: over.cadenceSampleSize ?? null,
    lastDocSeenAt: over.lastDocSeenAt ?? null,
  });
  return id;
}

function date(iso: string): Date {
  return new Date(iso);
}

beforeEach(() => {
  store.sources.clear();
  store.samples.length = 0;
  store.sourceUpdates.length = 0;
  store.counter = 0;
});

// ── estimateCadence ─────────────────────────────────────────────────────────

describe("estimateCadence", () => {
  test("empty input → all-null estimate", () => {
    expect(estimateCadence([])).toEqual({
      publishCadenceDays: null,
      confidence: null,
      sampleSize: 0,
    });
  });

  test("single doc → cadence unknown, confidence LOW", () => {
    expect(estimateCadence([date("2026-05-01")])).toEqual({
      publishCadenceDays: null,
      confidence: "LOW",
      sampleSize: 1,
    });
  });

  test("two docs 14 days apart → cadence=14, sampleSize=1, confidence=LOW", () => {
    const e = estimateCadence([date("2026-05-01"), date("2026-05-15")]);
    expect(e.publishCadenceDays).toBe(14);
    expect(e.confidence).toBe("LOW");
    expect(e.sampleSize).toBe(1);
  });

  test("six docs roughly monthly → cadence ≈ 30, sampleSize=5, confidence=MEDIUM", () => {
    const dates = [
      "2026-01-01", "2026-01-31", "2026-03-02", "2026-04-01", "2026-05-01", "2026-05-31",
    ].map(date);
    const e = estimateCadence(dates);
    expect(e.publishCadenceDays).toBeGreaterThanOrEqual(28);
    expect(e.publishCadenceDays).toBeLessThanOrEqual(32);
    expect(e.confidence).toBe("MEDIUM");
    expect(e.sampleSize).toBe(5);
  });

  test("twenty docs gives HIGH confidence (sampleSize=19 > 15)", () => {
    const dates: Date[] = [];
    for (let i = 0; i < 20; i++) {
      dates.push(date(`2026-${String(Math.floor(i / 4) + 1).padStart(2, "0")}-${String((i % 4) * 7 + 1).padStart(2, "0")}`));
    }
    const e = estimateCadence(dates);
    expect(e.confidence).toBe("HIGH");
    expect(e.sampleSize).toBe(19);
  });

  test("duplicate dates are deduped before computing deltas", () => {
    const e = estimateCadence([
      date("2026-05-01"), date("2026-05-01"), date("2026-05-15"),
    ]);
    expect(e.sampleSize).toBe(1); // 2 unique dates → 1 delta
    expect(e.publishCadenceDays).toBe(14);
  });

  test("median is used (not mean) so a long gap doesn't dominate", () => {
    const dates = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-12-01"].map(date);
    const e = estimateCadence(dates);
    // 4 deltas: ~31, ~28, ~31, ~245 → median ~31, NOT ~83 (mean).
    expect(e.publishCadenceDays).toBeGreaterThanOrEqual(28);
    expect(e.publishCadenceDays).toBeLessThanOrEqual(32);
  });

  test("clamps below CADENCE_MIN_DAYS", () => {
    const dates: Date[] = [];
    let t = new Date("2026-01-01").getTime();
    for (let i = 0; i < 5; i++) {
      dates.push(new Date(t));
      t += 60 * 60 * 1000; // 1-hour apart
    }
    const e = estimateCadence(dates);
    expect(e.publishCadenceDays).toBe(__internals.CADENCE_MIN_DAYS);
  });

  test("clamps above CADENCE_MAX_DAYS", () => {
    const dates = ["2024-01-01", "2025-01-01", "2026-01-01"].map(date);
    const e = estimateCadence(dates);
    expect(e.publishCadenceDays).toBe(__internals.CADENCE_MAX_DAYS);
  });
});

// ── computeNextExpectedAt ───────────────────────────────────────────────────

describe("computeNextExpectedAt", () => {
  test("null lastDoc → null", () => {
    expect(computeNextExpectedAt(null, 14)).toBeNull();
  });
  test("null cadence → null", () => {
    expect(computeNextExpectedAt(new Date(), null)).toBeNull();
  });
  test("lastDoc + cadence-lead days", () => {
    const lastDoc = new Date("2026-05-01T00:00:00Z");
    const next = computeNextExpectedAt(lastDoc, 14);
    // 14 - NEXT_EXPECTED_LEAD_DAYS (1) = 13 days forward
    expect(next).not.toBeNull();
    expect(next!.toISOString().slice(0, 10)).toBe("2026-05-14");
  });
});

// ── determineDueStatus ──────────────────────────────────────────────────────

describe("determineDueStatus", () => {
  const now = date("2026-05-21T12:00:00Z");

  test("OPERATOR_REVIEW → not due (operator hold)", () => {
    const r = determineDueStatus({
      now,
      lastScannedAt: date("2026-05-20"),
      nextExpectedAt: null,
      publishStatus: "OPERATOR_REVIEW",
    });
    expect(r.isDue).toBe(false);
    expect(r.reason).toBe("operator_review_hold");
  });

  test("STALE_PUBLISH → not due (stale hold)", () => {
    const r = determineDueStatus({
      now,
      lastScannedAt: date("2026-05-20"),
      nextExpectedAt: null,
      publishStatus: "STALE_PUBLISH",
    });
    expect(r.isDue).toBe(false);
    expect(r.reason).toBe("stale_publish_hold");
  });

  test("never scanned → due (never_scanned)", () => {
    const r = determineDueStatus({ now, lastScannedAt: null, nextExpectedAt: null });
    expect(r.isDue).toBe(true);
    expect(r.reason).toBe("never_scanned");
  });

  test("nextExpectedAt in the past → due (expected_now)", () => {
    const r = determineDueStatus({
      now,
      lastScannedAt: date("2026-05-19"),
      nextExpectedAt: date("2026-05-20"),
    });
    expect(r.isDue).toBe(true);
    expect(r.reason).toBe("expected_now");
  });

  test("nextExpectedAt in the future, lastScannedAt yesterday → not due", () => {
    const r = determineDueStatus({
      now,
      lastScannedAt: date("2026-05-20"),
      nextExpectedAt: date("2026-06-01"),
    });
    expect(r.isDue).toBe(false);
    expect(r.reason).toBe("not_due");
  });

  test("safety floor: lastScannedAt > 7 days ago forces due even with future nextExpectedAt", () => {
    const r = determineDueStatus({
      now,
      lastScannedAt: date("2026-05-13"), // 8 days ago
      nextExpectedAt: date("2026-06-15"),
    });
    expect(r.isDue).toBe(true);
    expect(r.reason).toBe("safety_floor");
  });

  test("boundary: exactly nextExpectedAt = now → due", () => {
    const r = determineDueStatus({
      now,
      lastScannedAt: date("2026-05-20"),
      nextExpectedAt: now,
    });
    expect(r.isDue).toBe(true);
    expect(r.reason).toBe("expected_now");
  });
});

// ── determineRunOutcome (dormancy detection) ───────────────────────────────

describe("determineRunOutcome (dormancy)", () => {
  const now = date("2026-05-21");
  const pastExpected = date("2026-05-01"); // before now

  test("found new docs → HEALTHY, counter reset to 0", () => {
    const r = determineRunOutcome({
      foundNewDocs: true,
      priorStatus: "HEALTHY",
      priorConsecutiveEmptyRuns: 7,
      now,
      nextExpectedAt: pastExpected,
    });
    expect(r).toEqual({ publishStatus: "HEALTHY", consecutiveEmptyRuns: 0 });
  });

  test("first empty run, not past expected → HEALTHY, counter=1", () => {
    const r = determineRunOutcome({
      foundNewDocs: false,
      priorStatus: "HEALTHY",
      priorConsecutiveEmptyRuns: 0,
      now,
      nextExpectedAt: date("2026-06-15"), // future
    });
    expect(r).toEqual({ publishStatus: "HEALTHY", consecutiveEmptyRuns: 1 });
  });

  test("3rd empty run past expected → STALE_PUBLISH", () => {
    const r = determineRunOutcome({
      foundNewDocs: false,
      priorStatus: "HEALTHY",
      priorConsecutiveEmptyRuns: 2,
      now,
      nextExpectedAt: pastExpected,
    });
    expect(r.publishStatus).toBe("STALE_PUBLISH");
    expect(r.consecutiveEmptyRuns).toBe(3);
  });

  test("3rd empty run but expected is in the future → still HEALTHY (early publish gap is fine)", () => {
    const r = determineRunOutcome({
      foundNewDocs: false,
      priorStatus: "HEALTHY",
      priorConsecutiveEmptyRuns: 2,
      now,
      nextExpectedAt: date("2026-06-15"), // future
    });
    expect(r.publishStatus).toBe("HEALTHY");
    expect(r.consecutiveEmptyRuns).toBe(3);
  });

  test("OPERATOR_REVIEW status is never overridden by automation", () => {
    const r = determineRunOutcome({
      foundNewDocs: true,
      priorStatus: "OPERATOR_REVIEW",
      priorConsecutiveEmptyRuns: 0,
      now,
      nextExpectedAt: null,
    });
    expect(r.publishStatus).toBe("OPERATOR_REVIEW");
  });
});

// ── recordDocDate (DB) ──────────────────────────────────────────────────────

describe("recordDocDate", () => {
  test("appends a sample row for the source", async () => {
    const sourceId = seedSource();
    await recordDocDate(sourceId, date("2026-05-01"));
    expect(store.samples).toHaveLength(1);
    expect(store.samples[0].sourceId).toBe(sourceId);
  });

  test("prunes oldest beyond CADENCE_SAMPLE_CAP", async () => {
    const sourceId = seedSource();
    // Insert CADENCE_SAMPLE_CAP + 5 samples with increasing observedAt.
    for (let i = 0; i < __internals.CADENCE_SAMPLE_CAP + 5; i++) {
      const observedAt = new Date(2026, 0, 1 + i);
      await recordDocDate(sourceId, date(`2026-05-${String((i % 28) + 1).padStart(2, "0")}`), observedAt);
    }
    const remaining = store.samples.filter((s) => s.sourceId === sourceId);
    expect(remaining.length).toBe(__internals.CADENCE_SAMPLE_CAP);
  });
});

// ── recomputeCadence (DB) ───────────────────────────────────────────────────

describe("recomputeCadence", () => {
  test("writes cadence + nextExpectedAt back to MarketSource", async () => {
    const sourceId = seedSource();
    await recordDocDate(sourceId, date("2026-01-01"));
    await recordDocDate(sourceId, date("2026-02-01"));
    await recordDocDate(sourceId, date("2026-03-01"));
    await recordDocDate(sourceId, date("2026-04-01"));

    const obs = await recomputeCadence(sourceId, date("2026-04-15"));
    expect(obs.sampleSize).toBe(3);
    expect(obs.publishCadenceDays).toBeGreaterThanOrEqual(28);
    expect(obs.publishCadenceDays).toBeLessThanOrEqual(32);
    expect(obs.lastDocSeenAt?.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(obs.nextExpectedAt).not.toBeNull();

    const updates = store.sourceUpdates.filter((u) => u.id === sourceId);
    expect(updates.length).toBeGreaterThan(0);
    const last = updates[updates.length - 1].data;
    expect(last.publishCadenceDays).toBe(obs.publishCadenceDays);
    expect(last.lastDocSeenAt).toEqual(obs.lastDocSeenAt);
    expect(last.nextExpectedAt).toEqual(obs.nextExpectedAt);
  });

  test("zero samples → writes nulls (no estimate possible)", async () => {
    const sourceId = seedSource();
    const obs = await recomputeCadence(sourceId);
    expect(obs.publishCadenceDays).toBeNull();
    expect(obs.confidence).toBeNull();
    expect(obs.lastDocSeenAt).toBeNull();
    expect(obs.nextExpectedAt).toBeNull();
  });
});

// ── recordRunOutcome (DB) ───────────────────────────────────────────────────

describe("recordRunOutcome", () => {
  test("HEALTHY source with new docs → HEALTHY, counter=0, lastEmptyRunAt cleared", async () => {
    const sourceId = seedSource({ consecutiveEmptyRuns: 4, lastEmptyRunAt: date("2026-05-10") });
    const r = await recordRunOutcome(sourceId, true, date("2026-05-21"));
    expect(r).toEqual({ publishStatus: "HEALTHY", consecutiveEmptyRuns: 0 });
    const lastUpdate = store.sourceUpdates[store.sourceUpdates.length - 1].data;
    expect(lastUpdate.publishStatus).toBe("HEALTHY");
    expect(lastUpdate.consecutiveEmptyRuns).toBe(0);
    expect(lastUpdate.lastEmptyRunAt).toBeNull();
  });

  test("3rd consecutive empty run past expected → STALE_PUBLISH", async () => {
    const sourceId = seedSource({
      consecutiveEmptyRuns: 2,
      nextExpectedAt: date("2026-05-01"),
    });
    const r = await recordRunOutcome(sourceId, false, date("2026-05-21"));
    expect(r.publishStatus).toBe("STALE_PUBLISH");
    expect(r.consecutiveEmptyRuns).toBe(3);
  });

  test("missing source throws", async () => {
    await expect(recordRunOutcome("does-not-exist", false)).rejects.toThrow(/not found/);
  });
});

// ── isSourceDue (DB) ────────────────────────────────────────────────────────

describe("isSourceDue", () => {
  test("never-scanned source is due", async () => {
    const sourceId = seedSource();
    const r = await isSourceDue(sourceId, date("2026-05-21"));
    expect(r.isDue).toBe(true);
    expect(r.reason).toBe("never_scanned");
  });

  test("STALE_PUBLISH source returns stale_publish_hold even past expected", async () => {
    const sourceId = seedSource({
      publishStatus: "STALE_PUBLISH",
      lastScannedAt: date("2026-04-01"),
      nextExpectedAt: date("2026-04-15"),
    });
    const r = await isSourceDue(sourceId, date("2026-05-21"));
    expect(r.isDue).toBe(false);
    expect(r.reason).toBe("stale_publish_hold");
  });

  test("source scanned 10 days ago, no nextExpectedAt → safety_floor due", async () => {
    const sourceId = seedSource({
      lastScannedAt: date("2026-05-11"),
      nextExpectedAt: null,
    });
    const r = await isSourceDue(sourceId, date("2026-05-21"));
    expect(r.isDue).toBe(true);
    expect(r.reason).toBe("safety_floor");
  });
});
