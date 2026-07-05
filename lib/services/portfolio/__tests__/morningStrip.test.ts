// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/portfolio/__tests__/morningStrip.test.ts
//
//  Covers the Morning Strip V0 data loader: zero-data quiet state, non-zero
//  Overnight (failed jobs) count + deep link, non-zero Today (bids due soon
//  + submittals due soon) count + deep link, and query-count bounds (no
//  N+1 — a fixed number of Prisma calls regardless of row count).
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

type JobRow = {
  id: string;
  jobType: string;
  status: string;
  bidId: number | null;
  completedAt: Date | null;
  bid: { projectName: string } | null;
};

type BidRow = {
  id: number;
  projectName: string;
  dueDate: Date | null;
  status: string;
};

type SubmittalRow = {
  id: number;
  title: string;
  bidId: number;
  status: string;
  submitByDate: Date | null;
  bid: { projectName: string } | null;
};

const { store, calls } = vi.hoisted(() => ({
  store: {
    jobs: [] as JobRow[],
    bids: [] as BidRow[],
    submittals: [] as SubmittalRow[],
  },
  calls: {
    backgroundJobCount: 0,
    backgroundJobFindMany: 0,
    bidCount: 0,
    bidFindMany: 0,
    submittalItemCount: 0,
    submittalItemFindMany: 0,
  },
}));

function matchesJob(
  row: JobRow,
  where: { status?: string; completedAt?: { gte?: Date }; bidId?: { not?: null } }
): boolean {
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.bidId?.not === null && row.bidId === null) return false;
  if (where.completedAt?.gte && (!row.completedAt || row.completedAt < where.completedAt.gte)) return false;
  return true;
}

function matchesBid(
  row: BidRow,
  where: { dueDate?: { not?: null; lte?: Date }; status?: { in?: string[] } }
): boolean {
  if (where.dueDate?.not === null && row.dueDate === null) return false;
  if (where.dueDate?.lte && (!row.dueDate || row.dueDate > where.dueDate.lte)) return false;
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  return true;
}

function matchesSubmittal(
  row: SubmittalRow,
  where: { status?: { in?: string[] }; submitByDate?: { not?: null; lte?: Date } }
): boolean {
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  if (where.submitByDate?.not === null && row.submitByDate === null) return false;
  if (where.submitByDate?.lte && (!row.submitByDate || row.submitByDate > where.submitByDate.lte)) return false;
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backgroundJob: {
      count: vi.fn(async (args: { where: Parameters<typeof matchesJob>[1] }) => {
        calls.backgroundJobCount++;
        return store.jobs.filter((j) => matchesJob(j, args.where)).length;
      }),
      findMany: vi.fn(
        async (args: { where: Parameters<typeof matchesJob>[1]; orderBy?: unknown; take?: number }) => {
          calls.backgroundJobFindMany++;
          let rows = store.jobs.filter((j) => matchesJob(j, args.where));
          rows = [...rows].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
          if (args.take) rows = rows.slice(0, args.take);
          return rows;
        }
      ),
    },
    bid: {
      count: vi.fn(async (args: { where: Parameters<typeof matchesBid>[1] }) => {
        calls.bidCount++;
        return store.bids.filter((b) => matchesBid(b, args.where)).length;
      }),
      findMany: vi.fn(
        async (args: { where: Parameters<typeof matchesBid>[1]; orderBy?: unknown; take?: number }) => {
          calls.bidFindMany++;
          let rows = store.bids.filter((b) => matchesBid(b, args.where));
          rows = [...rows].sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
          if (args.take) rows = rows.slice(0, args.take);
          return rows;
        }
      ),
    },
    submittalItem: {
      count: vi.fn(async (args: { where: Parameters<typeof matchesSubmittal>[1] }) => {
        calls.submittalItemCount++;
        return store.submittals.filter((s) => matchesSubmittal(s, args.where)).length;
      }),
      findMany: vi.fn(
        async (args: { where: Parameters<typeof matchesSubmittal>[1]; orderBy?: unknown; take?: number }) => {
          calls.submittalItemFindMany++;
          let rows = store.submittals.filter((s) => matchesSubmittal(s, args.where));
          rows = [...rows].sort((a, b) => (a.submitByDate?.getTime() ?? 0) - (b.submitByDate?.getTime() ?? 0));
          if (args.take) rows = rows.slice(0, args.take);
          return rows;
        }
      ),
    },
  },
}));

const NOW = new Date("2026-07-05T08:00:00.000Z");

describe("loadMorningStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.jobs = [];
    store.bids = [];
    store.submittals = [];
    calls.backgroundJobCount = 0;
    calls.backgroundJobFindMany = 0;
    calls.bidCount = 0;
    calls.bidFindMany = 0;
    calls.submittalItemCount = 0;
    calls.submittalItemFindMany = 0;
  });

  test("zero data renders the quiet state (isQuiet === true, all totals 0)", async () => {
    const { loadMorningStrip } = await import("../morningStrip");
    const data = await loadMorningStrip(NOW);

    expect(data.isQuiet).toBe(true);
    expect(data.failedJobs.total).toBe(0);
    expect(data.completedJobs.total).toBe(0);
    expect(data.bidsDueSoon.total).toBe(0);
    expect(data.submittalsDueSoon.total).toBe(0);
    expect(data.failedJobs.items).toEqual([]);
    expect(data.bidsDueSoon.items).toEqual([]);
    expect(data.submittalsDueSoon.items).toEqual([]);
  });

  test("a bid with no dueDate and no jobs does not count toward anything", async () => {
    store.bids = [{ id: 1, projectName: "No Due Date Co", dueDate: null, status: "active" }];
    const { loadMorningStrip } = await import("../morningStrip");
    const data = await loadMorningStrip(NOW);

    expect(data.isQuiet).toBe(true);
    expect(data.bidsDueSoon.total).toBe(0);
  });

  test("non-zero Overnight failed-job count includes a deep link to the bid page", async () => {
    store.jobs = [
      {
        id: "job-1",
        jobType: "spec_analysis",
        status: "failed",
        bidId: 42,
        completedAt: new Date("2026-07-05T02:00:00.000Z"), // 6h before NOW
        bid: { projectName: "Riverside Tower" },
      },
      // Failed but > 24h ago — must be excluded.
      {
        id: "job-2",
        jobType: "drawing_analysis",
        status: "failed",
        bidId: 42,
        completedAt: new Date("2026-07-01T00:00:00.000Z"),
        bid: { projectName: "Riverside Tower" },
      },
      // Failed, recent, but bid relation gone (bidId null) — must be excluded
      // since there is no deep link to show it against.
      {
        id: "job-3",
        jobType: "meeting_transcription",
        status: "failed",
        bidId: null,
        completedAt: new Date("2026-07-05T01:00:00.000Z"),
        bid: null,
      },
    ];

    const { loadMorningStrip } = await import("../morningStrip");
    const data = await loadMorningStrip(NOW);

    expect(data.isQuiet).toBe(false);
    expect(data.failedJobs.total).toBe(1);
    expect(data.failedJobs.items).toHaveLength(1);
    expect(data.failedJobs.items[0]).toMatchObject({
      id: "job-1",
      bidId: 42,
      bidProjectName: "Riverside Tower",
      jobType: "spec_analysis",
    });
    // The page renders `/bids/${bidId}` from this — assert the field a
    // human would use to build that link is present and correct.
    expect(data.failedJobs.items[0].bidId).toBe(42);
  });

  test("non-zero Today bids-due-soon count includes a deep link to the bid page, and excludes bids already submitted or past the window", async () => {
    store.bids = [
      { id: 10, projectName: "Due In 2 Days", dueDate: new Date("2026-07-07T00:00:00.000Z"), status: "active" },
      { id: 11, projectName: "Due In 20 Days", dueDate: new Date("2026-07-25T00:00:00.000Z"), status: "active" },
      { id: 12, projectName: "Already Submitted", dueDate: new Date("2026-07-06T00:00:00.000Z"), status: "submitted" },
      { id: 13, projectName: "No Due Date", dueDate: null, status: "active" },
    ];

    const { loadMorningStrip } = await import("../morningStrip");
    const data = await loadMorningStrip(NOW);

    expect(data.isQuiet).toBe(false);
    expect(data.bidsDueSoon.total).toBe(1);
    expect(data.bidsDueSoon.items[0]).toMatchObject({ id: 10, projectName: "Due In 2 Days" });
  });

  test("non-zero Today submittals-due-soon count includes a deep link (bidId) and excludes terminal statuses", async () => {
    store.submittals = [
      {
        id: 100,
        title: "Structural Steel Shop Drawings",
        bidId: 55,
        status: "PENDING",
        submitByDate: new Date("2026-07-08T00:00:00.000Z"),
        bid: { projectName: "Harbor Point" },
      },
      {
        id: 101,
        title: "Already Approved Item",
        bidId: 55,
        status: "APPROVED",
        submitByDate: new Date("2026-07-06T00:00:00.000Z"),
        bid: { projectName: "Harbor Point" },
      },
    ];

    const { loadMorningStrip } = await import("../morningStrip");
    const data = await loadMorningStrip(NOW);

    expect(data.isQuiet).toBe(false);
    expect(data.submittalsDueSoon.total).toBe(1);
    expect(data.submittalsDueSoon.items[0]).toMatchObject({ id: 100, bidId: 55, bidProjectName: "Harbor Point" });
  });

  test("query shape is bounded: one count + one findMany per source, never per-row", async () => {
    // 50 failed jobs, 50 due-soon bids, 50 due-soon submittals — if the
    // loader were doing N+1 queries this would blow up the call counters.
    store.jobs = Array.from({ length: 50 }, (_, i) => ({
      id: `job-${i}`,
      jobType: "spec_analysis",
      status: "failed",
      bidId: i,
      completedAt: new Date(NOW.getTime() - 1000 * i),
      bid: { projectName: `Project ${i}` },
    }));
    store.bids = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      projectName: `Project ${i}`,
      dueDate: new Date(NOW.getTime() + 1000 * i),
      status: "active",
    }));
    store.submittals = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      title: `Submittal ${i}`,
      bidId: i,
      status: "PENDING",
      submitByDate: new Date(NOW.getTime() + 1000 * i),
      bid: { projectName: `Project ${i}` },
    }));

    const { loadMorningStrip } = await import("../morningStrip");
    const data = await loadMorningStrip(NOW);

    expect(data.failedJobs.total).toBe(50);
    expect(data.failedJobs.items).toHaveLength(5); // MAX_LIST_ITEMS bound
    expect(data.bidsDueSoon.total).toBe(50);
    expect(data.bidsDueSoon.items).toHaveLength(5);
    expect(data.submittalsDueSoon.total).toBe(50);
    expect(data.submittalsDueSoon.items).toHaveLength(5);

    // Two backgroundJob queries (failed + complete) x {count, findMany} = 4 total.
    expect(calls.backgroundJobCount).toBe(2);
    expect(calls.backgroundJobFindMany).toBe(2);
    expect(calls.bidCount).toBe(1);
    expect(calls.bidFindMany).toBe(1);
    expect(calls.submittalItemCount).toBe(1);
    expect(calls.submittalItemFindMany).toBe(1);
  });
});
