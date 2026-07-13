// Module OPS4 (Phase 1B) — spawn route. One creation path with 1A's
// accept-new: spawn sets spawnedItemId AND registerItemId + state,
// atomically; linking never sets spawnedItemId. pm|admin only.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  observations: [] as Row[],
  items: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  currentUser: { id: "u1", role: "pm" } as { id: string; role: string } | null,
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

vi.mock("@/lib/prisma", () => {
  const prisma = {
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
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, status: "OPEN", dueDate: null, ...data } as Row;
        h.items.push(row);
        return { id: row.id };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

import { POST as spawnPOST } from "../[reportId]/observations/[observationId]/spawn/route";
import { POST as acceptNewPOST } from "../[reportId]/observations/[observationId]/accept-new/route";
import { POST as linkPOST } from "../../tracked-items/[itemId]/link-observation/route";

const po = (id: string, reportId: string, observationId: string) => ({
  params: Promise.resolve({ id, reportId, observationId }),
});
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
  h.observations.length = 0;
  h.items.length = 0;
  h.audits.length = 0;
  h.currentUser = { id: "u1", role: "pm" };
  h.authOk = true;
  h.nextId = 1;
  h.observations.push({
    id: 100,
    reportId: 10,
    bidId: 1,
    state: "ENTERED",
    registerItemId: null,
    spawnedItemId: null,
    observationText: "Handrail at stair 2 not yet installed",
    sourcePage: "p.3",
    consultantTargetDate: new Date("2026-07-18T00:00:00.000Z"),
  });
});

describe("POST spawn", () => {
  test("creates the item, sets BOTH FKs + state, atomically, audited as spawn", async () => {
    const res = await spawnPOST(jsonReq({ title: "Install handrail" }), po("1", "10", "100"));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { trackedItemId: number; spawnedItemId: number };
    expect(json.spawnedItemId).toBe(json.trackedItemId);

    const item = h.items.find((i) => i.id === json.trackedItemId)!;
    expect(item.sourceKind).toBe("consultant_report");
    expect(item.sourceConsultantObservationId).toBe(100);
    expect(item.evidenceExcerpt).toBe("Handrail at stair 2 not yet installed");
    expect(item.dueDate).toBeNull(); // consultantTargetDate NEVER copied

    const obs = h.observations[0];
    expect(obs.state).toBe("ACCEPTED_NEW_ITEM");
    expect(obs.registerItemId).toBe(json.trackedItemId);
    expect(obs.spawnedItemId).toBe(json.trackedItemId);
    expect(h.audits.map((a) => a.action)).toContain("observation_spawned_item");
  });

  test("accept-new shares the creation path (also sets spawnedItemId, its own audit verb)", async () => {
    const res = await acceptNewPOST(jsonReq({ title: "Via accept-new" }), po("1", "10", "100"));
    expect(res.status).toBe(201);
    expect(h.observations[0].spawnedItemId).not.toBeNull();
    expect(h.audits.map((a) => a.action)).toContain("observation_accepted_new");
  });

  test("LINKING an existing item never sets spawnedItemId", async () => {
    h.items.push({ id: 500, bidId: 1 });
    const res = await linkPOST(jsonReq({ reportId: 10, observationId: 100 }), pi("1", "500"));
    expect(res.status).toBe(200);
    const obs = h.observations[0];
    expect(obs.registerItemId).toBe(500);
    expect(obs.spawnedItemId).toBeNull(); // linked ≠ spawned
    expect(obs.state).toBe("ACCEPTED_LINKED_ITEM");
  });

  test("estimator → 403 zero mutation; unauthenticated → 401", async () => {
    h.currentUser = { id: "u3", role: "estimator" };
    expect((await spawnPOST(jsonReq({ title: "x" }), po("1", "10", "100"))).status).toBe(403);
    expect(h.items).toHaveLength(0);
    expect(h.observations[0].state).toBe("ENTERED");

    h.authOk = false;
    expect((await spawnPOST(jsonReq({ title: "x" }), po("1", "10", "100"))).status).toBe(401);
  });

  test("non-ENTERED → 400; cross-project → 404 zero mutation; explicit dueDate honored", async () => {
    h.observations[0].state = "DISMISSED";
    expect((await spawnPOST(jsonReq({ title: "x" }), po("1", "10", "100"))).status).toBe(400);
    h.observations[0].state = "ENTERED";

    expect((await spawnPOST(jsonReq({ title: "x" }), po("2", "10", "100"))).status).toBe(404);
    expect(h.items).toHaveLength(0);

    const res = await spawnPOST(
      jsonReq({ title: "With due", dueDate: "2026-07-15T00:00:00.000Z" }),
      po("1", "10", "100")
    );
    const { trackedItemId } = (await res.json()) as { trackedItemId: number };
    expect(h.items.find((i) => i.id === trackedItemId)!.dueDate).toEqual(
      new Date("2026-07-15T00:00:00.000Z")
    );
  });
});
