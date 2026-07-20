import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  row: null as null | {
    id: string;
    status: string;
    activeSlot: number | null;
    externalJobId: string | null;
    errorMessage: string | null;
  },
  failures: [] as unknown[],
}));

const updateMany = vi.hoisted(() =>
  vi.fn(async ({ where, data }) => {
    const failure = h.failures.shift();
    if (failure) throw failure;
    if (
      !h.row ||
      h.row.id !== where.id ||
      !(where.status.in as string[]).includes(h.row.status)
    ) {
      return { count: 0 };
    }
    Object.assign(h.row, data);
    return { count: 1 };
  }),
);

const findUnique = vi.hoisted(() =>
  vi.fn(async () => (h.row ? { ...h.row } : null)),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backgroundJob: {
      updateMany,
      findUnique,
    },
  },
}));

import {
  BackgroundJobReconciliationError,
  failJob,
} from "../backgroundJobService";

function busyError() {
  const error = new Error("SQLITE_BUSY: database is locked") as Error & {
    code: string;
  };
  error.code = "P1008";
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.failures = [];
  h.row = {
    id: "job-1",
    status: "queued",
    activeSlot: 1,
    externalJobId: null,
    errorMessage: null,
  };
});

describe("failJob durable active-slot reconciliation", () => {
  it("retries contention, releases the slot, and preserves the provider id", async () => {
    h.failures = [busyError(), busyError()];

    await failJob("job-1", "provider failed", "provider-7");

    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(h.row).toMatchObject({
      status: "failed",
      activeSlot: null,
      externalJobId: "provider-7",
      errorMessage: "provider failed",
    });
  });

  it("is idempotent across repeated failure reconciliation", async () => {
    await failJob("job-1", "first", "provider-7");
    await failJob("job-1", "first", "provider-7");

    expect(h.row).toMatchObject({
      status: "failed",
      activeSlot: null,
      externalJobId: "provider-7",
    });
  });

  it("surfaces exhaustion with original failure context", async () => {
    h.failures = [busyError(), busyError(), busyError(), busyError()];

    const error = await failJob("job-1", "sidecar request failed").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BackgroundJobReconciliationError);
    expect(error).toMatchObject({
      jobId: "job-1",
      originalFailureMessage: "sidecar request failed",
      code: "BACKGROUND_JOB_RECONCILIATION_REQUIRED",
    });
    expect(h.row).toMatchObject({ status: "queued", activeSlot: 1 });
  });

  it("does not relabel unrelated database failures or rewrite completed jobs", async () => {
    const unrelated = new Error("unique constraint") as Error & { code: string };
    unrelated.code = "P2002";
    h.failures = [unrelated];
    await expect(failJob("job-1", "failure")).rejects.toBe(unrelated);

    h.row!.status = "complete";
    h.row!.activeSlot = null;
    await expect(failJob("job-1", "late failure")).rejects.toBeInstanceOf(
      BackgroundJobReconciliationError,
    );
    expect(h.row!.status).toBe("complete");
  });
});
