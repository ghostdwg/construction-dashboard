// Module OPS3 (Phase 1A) — link/relink citation operations. The single
// most important route-bug class for this feature: cross-project link
// attempts MUST 404 with zero mutation. SQLite cannot enforce same-bid
// linkage, so these negative paths are mandatory, not optional.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  observations: [] as Row[],
  items: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  authOk: true,
}));

const auditMock = vi.hoisted(() =>
  vi.fn(async (input: { action: string; payload?: Record<string, unknown> }) => {
    h.audits.push({ action: input.action, payload: input.payload });
  })
);

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () =>
    h.authOk
      ? { ok: true, user: { id: "u1", role: "admin" } }
      : {
          ok: false,
          response: Response.json(
            { error: "Authentication required" },
            { status: 401 }
          ),
        }
  ),
}));

vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    consultantObservation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.observations.find((o) => matches(o, where));
        return found ? { ...found } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.observations.find((o) => o.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
    trackedItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.items.find((i) => matches(i, where));
        return found ? { ...found } : null;
      }),
    },
  },
}));

import { POST as linkPOST } from "../[itemId]/link-observation/route";

const pi = (id: string, itemId: string) => ({
  params: Promise.resolve({ id, itemId }),
});
const jsonReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.authOk = true;
  h.observations.length = 0;
  h.items.length = 0;
  h.audits.length = 0;
  // Bid 1: report 10 with an ENTERED observation; two items.
  h.observations.push({
    id: 100,
    reportId: 10,
    bidId: 1,
    state: "ENTERED",
    registerItemId: null,
    observationText: "obs",
  });
  h.items.push({ id: 7, bidId: 1 });
  h.items.push({ id: 8, bidId: 1 });
  // Bid 2: a foreign item and a foreign observation.
  h.items.push({ id: 9, bidId: 2 });
  h.observations.push({
    id: 200,
    reportId: 20,
    bidId: 2,
    state: "ENTERED",
    registerItemId: null,
    observationText: "foreign obs",
  });
});

describe("POST tracked-items/[itemId]/link-observation", () => {
  test("links an ENTERED observation to a same-bid item (audited)", async () => {
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "7"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { relinked: boolean; trackedItemId: number };
    expect(json.relinked).toBe(false);
    expect(json.trackedItemId).toBe(7);
    const obs = h.observations.find((o) => o.id === 100)!;
    expect(obs.state).toBe("ACCEPTED_LINKED_ITEM");
    expect(obs.registerItemId).toBe(7);
    expect(h.audits.map((a) => a.action)).toContain("observation_accepted_linked");
  });

  test("relink correction moves the citation and audits prior/new", async () => {
    await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "7"));
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "8"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { relinked: boolean }).relinked).toBe(true);
    expect(h.observations.find((o) => o.id === 100)!.registerItemId).toBe(8);
    const relinkAudit = h.audits.find((a) => a.action === "observation_link_corrected")!;
    expect(relinkAudit.payload).toMatchObject({ priorTrackedItemId: 7, trackedItemId: 8 });
  });

  test("CROSS-PROJECT: bid-1 observation → bid-2 item is 404 with zero mutation", async () => {
    // URL scoped to bid 2 (where the item lives); the observation belongs to bid 1.
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("2", "9"));
    expect(res.status).toBe(404);
    const obs = h.observations.find((o) => o.id === 100)!;
    expect(obs.state).toBe("ENTERED");
    expect(obs.registerItemId).toBeNull();
    expect(h.audits).toHaveLength(0);
  });

  test("CROSS-PROJECT: bid-2 observation → bid-1 item is 404 with zero mutation", async () => {
    // URL scoped to bid 1 (where the item lives); the observation belongs to bid 2.
    const res = await linkPOST(jsonReq({ reportId: 20, observationId: 200 }), pi("1", "7"));
    expect(res.status).toBe(404);
    const obs = h.observations.find((o) => o.id === 200)!;
    expect(obs.state).toBe("ENTERED");
    expect(obs.registerItemId).toBeNull();
    expect(h.audits).toHaveLength(0);
  });

  test("CROSS-PROJECT relink: linked bid-1 observation cannot be relinked to a bid-2 item", async () => {
    await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "7"));
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("2", "9"));
    expect(res.status).toBe(404);
    expect(h.observations.find((o) => o.id === 100)!.registerItemId).toBe(7); // unchanged
  });

  test("nonexistent item in this bid → 404, zero mutation", async () => {
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "999"));
    expect(res.status).toBe(404);
    expect(h.observations.find((o) => o.id === 100)!.state).toBe("ENTERED");
  });

  test("linking a DISMISSED observation → 400", async () => {
    h.observations.find((o) => o.id === 100)!.state = "DISMISSED";
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "7"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Cannot link/);
  });

  test("missing / non-numeric body ids → 400", async () => {
    expect((await linkPOST(jsonReq({}), pi("1", "7"))).status).toBe(400);
    expect(
      (await linkPOST(jsonReq({ reportId: "10", observationId: "100" }), pi("1", "7"))).status
    ).toBe(400);
  });
});
