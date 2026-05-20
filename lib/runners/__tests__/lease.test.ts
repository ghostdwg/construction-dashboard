// Phase O1.5.d — claimLease integration: confirm the unique-constraint
// normalization is wired into the lease layer, not only the helper.
//
// We mock prisma.runnerLease.create to throw each of the three error shapes
// the production system observes (Prisma P2002, libsql LibsqlError, raw
// SQLite message). For each shape claimLease must return
//   { ok: false, reason: "already_held" }
// — which is the precondition for the dispatcher to short-circuit to
// preempted=true / status=succeeded / exit code 0.

import { describe, expect, test, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    runnerLease: {
      create: mockCreate,
    },
  },
}));

import { claimLease } from "../lease";

describe("claimLease — duplicate-claim normalization (O1.5.d)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  test("Prisma P2002 → reason=already_held", async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`windowKey`)"), {
        code: "P2002",
        clientVersion: "7.6.0",
        meta: { target: ["windowKey"] },
      })
    );
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_test-unique",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("already_held");
  });

  test("libsql LibsqlError code=SQLITE_CONSTRAINT_UNIQUE → reason=already_held", async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(
        new Error("SQLite error: UNIQUE constraint failed: RunnerLease.windowKey"),
        { code: "SQLITE_CONSTRAINT_UNIQUE", rawCode: 2067 }
      )
    );
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_test-unique",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("already_held");
  });

  test("libsql rawCode=2067 without code string → reason=already_held", async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error("constraint failed"), { rawCode: 2067 })
    );
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_test-unique",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("already_held");
  });

  test("generic Error with UNIQUE message → reason=already_held", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error("UNIQUE constraint failed: RunnerLease.windowKey")
    );
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_test-unique",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("already_held");
  });

  test("unrelated DB error (connection refused) → reason=db_error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("connection refused"));
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_test-unique",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("db_error");
      expect(res.details).toContain("connection refused");
    }
  });

  test("foreign-key violation does NOT misclassify as already_held", async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error("FK failed"), {
        code: "SQLITE_CONSTRAINT_FOREIGNKEY",
        rawCode: 787,
      })
    );
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_test-unique",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("db_error");
  });

  test("successful create returns ok=true with lease details", async () => {
    const now = new Date();
    mockCreate.mockResolvedValueOnce({
      id: "lease-1",
      leaseToken: "token-abc",
      leasedBy: "host:123:inst",
      leasedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    });
    const res = await claimLease({
      cycleName: "health-check",
      windowKey: "health-check_first-claim",
      leaseSeconds: 30,
      runnerId: "test-runner",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lease.leaseId).toBe("lease-1");
      expect(res.lease.leaseToken).toBe("token-abc");
    }
  });
});
