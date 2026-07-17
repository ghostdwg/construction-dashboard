// Module OPS3 (Phase 1A) — relink route: safe repair for the missing HTTP
// surface of the relinkObservation service function.
//
// POST …/observations/[observationId]/relink  Body: { trackedItemId }
//
// ACCEPTED_LINKED_ITEM only; cross-project → 404; wrong state → 400;
// missing trackedItemId → 400; unauthenticated → 401.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  observations: [] as Row[],
  items: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  authOk: true,
  nextId: 1,
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
  requireBidAccess: vi.fn(async () =>
    h.authOk
      ? { ok: true, user: { id: "u1", role: "pm" } }
      : {
          ok: false,
          response: Response.json({ error: "Authentication required" }, { status: 401 }),
        }
  ),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock("@/lib/prisma", () => {
  const prisma = {
    consultantObservation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.observations.find((o) => matches(o, where));
        return found ? { ...found } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = h.observations.find((o) => o.id === where.id)!;
          Object.assign(row, data);
          return { ...row };
        }
      ),
    },
    trackedItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.items.find((i) => matches(i, where));
        return found ? { ...found } : null;
      }),
    },
    auditEvent: {
      create: vi.fn(async () => ({})),
    },
  };
  return { prisma };
});

import { POST } from "../[reportId]/observations/[observationId]/relink/route";

const p = (id: string, reportId: string, observationId: string) => ({
  params: Promise.resolve({ id, reportId, observationId }),
});
const jsonReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.observations.length = 0;
  h.items.length = 0;
  h.audits.length = 0;
  h.authOk = true;
  h.nextId = 1;
});

describe("POST relink", () => {
  test("happy path: relinks ACCEPTED_LINKED_ITEM to new trackedItemId", async () => {
    const obs: Row = {
      id: 1,
      reportId: 10,
      bidId: 1,
      state: "ACCEPTED_LINKED_ITEM",
      registerItemId: 100,
    };
    const newItem: Row = { id: 200, bidId: 1 };
    h.observations.push(obs);
    h.items.push(newItem);

    const res = await POST(jsonReq({ trackedItemId: 200 }), p("1", "10", "1"));
    const body = (await res.json()) as { ok: boolean; trackedItemId: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.trackedItemId).toBe(200);
    // registerItemId updated in memory
    expect(obs.registerItemId).toBe(200);
  });

  test("emits observation_link_corrected audit event with prior and new itemId", async () => {
    const obs: Row = {
      id: 2,
      reportId: 10,
      bidId: 1,
      state: "ACCEPTED_LINKED_ITEM",
      registerItemId: 100,
    };
    h.observations.push(obs);
    h.items.push({ id: 300, bidId: 1 });

    await POST(jsonReq({ trackedItemId: 300 }), p("1", "10", "2"));
    const audit = h.audits.find((a) => a.action === "observation_link_corrected");
    expect(audit).toBeDefined();
    expect(audit!.payload?.priorTrackedItemId).toBe(100);
    expect(audit!.payload?.trackedItemId).toBe(300);
  });

  test("returns 400 when observation is ENTERED (not yet linked)", async () => {
    h.observations.push({ id: 3, reportId: 10, bidId: 1, state: "ENTERED", registerItemId: null });
    h.items.push({ id: 400, bidId: 1 });
    const res = await POST(jsonReq({ trackedItemId: 400 }), p("1", "10", "3"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Cannot relink from state ENTERED/);
  });

  test("returns 400 when trackedItemId is missing", async () => {
    h.observations.push({ id: 4, reportId: 10, bidId: 1, state: "ACCEPTED_LINKED_ITEM", registerItemId: 100 });
    const res = await POST(jsonReq({}), p("1", "10", "4"));
    expect(res.status).toBe(400);
  });

  test("returns 400 when trackedItemId is a string instead of number", async () => {
    h.observations.push({ id: 5, reportId: 10, bidId: 1, state: "ACCEPTED_LINKED_ITEM", registerItemId: 100 });
    const res = await POST(jsonReq({ trackedItemId: "abc" }), p("1", "10", "5"));
    expect(res.status).toBe(400);
  });

  test("returns 404 for cross-project trackedItem (item bidId does not match)", async () => {
    h.observations.push({ id: 6, reportId: 10, bidId: 1, state: "ACCEPTED_LINKED_ITEM", registerItemId: 100 });
    // Item belongs to bid 2, not bid 1
    h.items.push({ id: 500, bidId: 2 });
    const res = await POST(jsonReq({ trackedItemId: 500 }), p("1", "10", "6"));
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent observation", async () => {
    h.items.push({ id: 600, bidId: 1 });
    const res = await POST(jsonReq({ trackedItemId: 600 }), p("1", "10", "999"));
    expect(res.status).toBe(404);
  });

  test("returns 401 when unauthenticated", async () => {
    h.authOk = false;
    h.observations.push({ id: 7, reportId: 10, bidId: 1, state: "ACCEPTED_LINKED_ITEM", registerItemId: 100 });
    h.items.push({ id: 700, bidId: 1 });
    const res = await POST(jsonReq({ trackedItemId: 700 }), p("1", "10", "7"));
    expect(res.status).toBe(401);
    // No mutation occurred
    const row = h.observations.find((o) => o.id === 7)!;
    expect(row.registerItemId).toBe(100);
  });

  test("returns 400 for invalid observationId (non-numeric)", async () => {
    const res = await POST(jsonReq({ trackedItemId: 1 }), p("1", "10", "abc"));
    expect(res.status).toBe(400);
  });

  test("zero mutation on any error path", async () => {
    const obs: Row = { id: 8, reportId: 10, bidId: 1, state: "ENTERED", registerItemId: null };
    h.observations.push(obs);
    h.items.push({ id: 800, bidId: 1 });
    await POST(jsonReq({ trackedItemId: 800 }), p("1", "10", "8"));
    expect(obs.registerItemId).toBeNull(); // not mutated on error
  });
});
