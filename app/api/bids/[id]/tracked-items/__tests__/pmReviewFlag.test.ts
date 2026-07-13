// Module OPS4 (Phase 1B) — PM review flag: pm|admin only for set AND
// clear, manual only, audited both directions, cross-project 404.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  items: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  currentUser: { id: "u1", role: "pm" } as { id: string; role: string } | null,
  authOk: true,
}));

const auditMock = vi.hoisted(() =>
  vi.fn(async (input: { action: string; payload?: Record<string, unknown> }) => {
    h.audits.push({ action: input.action, payload: input.payload });
  })
);

vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));
vi.mock("@/lib/auth-helpers", () => ({
  ROLES: { ADMIN: "admin", ESTIMATOR: "estimator", PM: "pm" },
  getUser: vi.fn(async () => h.currentUser),
  requireBidAccess: vi.fn(async () =>
    h.authOk
      ? { ok: true, user: h.currentUser }
      : {
          ok: false,
          response: Response.json({ error: "Authentication required" }, { status: 401 }),
        }
  ),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    trackedItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.items.find((i) => matches(i, where));
        return found ? { ...found } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.items.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
  },
}));

import { PATCH as flagPATCH } from "../[itemId]/pm-review-flag/route";

const pi = (id: string, itemId: string) => ({
  params: Promise.resolve({ id, itemId }),
});
const patchReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.items.length = 0;
  h.audits.length = 0;
  h.currentUser = { id: "u1", role: "pm" };
  h.authOk = true;
  h.items.push({ id: 7, bidId: 1, pmReviewRequired: false });
});

describe("PATCH pm-review-flag", () => {
  test("pm sets and clears; audited both directions with the prior value", async () => {
    const set = await flagPATCH(patchReq({ pmReviewRequired: true }), pi("1", "7"));
    expect(set.status).toBe(200);
    expect(h.items[0].pmReviewRequired).toBe(true);

    const clear = await flagPATCH(patchReq({ pmReviewRequired: false }), pi("1", "7"));
    expect(clear.status).toBe(200);
    expect(h.items[0].pmReviewRequired).toBe(false);

    expect(h.audits.map((a) => a.action)).toEqual(["pm_review_flagged", "pm_review_cleared"]);
    expect(h.audits[1].payload).toMatchObject({ prior: true });
  });

  test("admin allowed; estimator → 403 zero mutation; unauthenticated → 401", async () => {
    h.currentUser = { id: "u2", role: "admin" };
    expect((await flagPATCH(patchReq({ pmReviewRequired: true }), pi("1", "7"))).status).toBe(200);

    h.currentUser = { id: "u3", role: "estimator" };
    expect((await flagPATCH(patchReq({ pmReviewRequired: false }), pi("1", "7"))).status).toBe(403);
    expect(h.items[0].pmReviewRequired).toBe(true); // unchanged by the 403

    h.authOk = false;
    expect((await flagPATCH(patchReq({ pmReviewRequired: false }), pi("1", "7"))).status).toBe(401);
  });

  test("non-boolean body → 400; cross-project → 404 zero mutation", async () => {
    expect((await flagPATCH(patchReq({ pmReviewRequired: "yes" }), pi("1", "7"))).status).toBe(400);
    expect((await flagPATCH(patchReq({}), pi("1", "7"))).status).toBe(400);
    expect((await flagPATCH(patchReq({ pmReviewRequired: true }), pi("2", "7"))).status).toBe(404);
    expect(h.items[0].pmReviewRequired).toBe(false);
    expect(h.audits).toHaveLength(0);
  });
});
