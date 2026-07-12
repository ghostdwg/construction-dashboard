// Module OPS3 (Phase 1A) — observation workflow coverage: manual create,
// pre-resolution edit + source freeze, accept-new (citation + NO date
// sync), dismiss/reinstate, and cross-project 404s with zero mutation.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  reports: [] as Row[],
  observations: [] as Row[],
  items: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  nextId: 1,
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

vi.mock("@/lib/prisma", () => {
  const prisma = {
    consultantReport: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.reports.find((r) => matches(r, where));
        return found ? { ...found } : null;
      }),
    },
    consultantObservation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.observations.find((o) => matches(o, where));
        return found ? { ...found } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.observations
          .filter((o) => matches(o, where))
          .map((o) => ({
            ...o,
            registerItem:
              o.registerItemId != null
                ? (h.items.find((i) => i.id === o.registerItemId) ?? null)
                : null,
          }))
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: h.nextId++,
          state: "ENTERED",
          registerItemId: null,
          dismissedReason: null,
          sourcePage: null,
          consultantTargetDate: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          ...data,
        } as Row;
        h.observations.push(row);
        return { id: row.id };
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

import { GET as obsGET, POST as obsPOST } from "../[reportId]/observations/route";
import { PATCH as obsPATCH } from "../[reportId]/observations/[observationId]/route";
import { POST as acceptNewPOST } from "../[reportId]/observations/[observationId]/accept-new/route";
import { POST as dismissPOST } from "../[reportId]/observations/[observationId]/dismiss/route";
import { POST as reinstatePOST } from "../[reportId]/observations/[observationId]/reinstate/route";

const pr = (id: string, reportId: string) => ({
  params: Promise.resolve({ id, reportId }),
});
const po = (id: string, reportId: string, observationId: string) => ({
  params: Promise.resolve({ id, reportId, observationId }),
});
const jsonReq = (body: unknown, method = "POST") =>
  new Request("http://test/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.authOk = true;
  h.reports.length = 0;
  h.observations.length = 0;
  h.items.length = 0;
  h.audits.length = 0;
  h.nextId = 1;
  h.reports.push({ id: 10, bidId: 1, status: "ACTIVE" });
  h.reports.push({ id: 20, bidId: 2, status: "ACTIVE" });
});

async function seedObservation(withTarget = true): Promise<number> {
  const res = await obsPOST(
    jsonReq({
      observationText: "Handrail at stair 2 not yet installed",
      sourcePage: "p.3",
      ...(withTarget ? { consultantTargetDate: "2026-07-18T00:00:00.000Z" } : {}),
    }),
    pr("1", "10")
  );
  return ((await res.json()) as { id: number }).id;
}

describe("POST observations (manual create)", () => {
  test("creates an ENTERED row with verbatim fields + audit", async () => {
    const id = await seedObservation();
    const row = h.observations.find((o) => o.id === id)!;
    expect(row.state).toBe("ENTERED");
    expect(row.sourcePage).toBe("p.3");
    expect(row.consultantTargetDate).toEqual(new Date("2026-07-18T00:00:00.000Z"));
    expect(h.audits.map((a) => a.action)).toContain("observation_created");
  });

  test("audit payload never carries the observation text", async () => {
    await seedObservation();
    const created = h.audits.find((a) => a.action === "observation_created")!;
    expect(JSON.stringify(created.payload)).not.toContain("Handrail");
  });

  test("missing text → 400; cross-project report → 404; voided report → 400", async () => {
    expect((await obsPOST(jsonReq({}), pr("1", "10"))).status).toBe(400);
    expect(
      (await obsPOST(jsonReq({ observationText: "x" }), pr("1", "20"))).status
    ).toBe(404);
    h.reports[0].status = "VOIDED";
    expect(
      (await obsPOST(jsonReq({ observationText: "x" }), pr("1", "10"))).status
    ).toBe(400);
  });
});

describe("GET observations", () => {
  test("returns rows with live linked-item status; cross-project → 404", async () => {
    const id = await seedObservation();
    h.items.push({ id: 500, bidId: 1, title: "Fix handrail", status: "IN_PROGRESS", dueDate: null });
    h.observations.find((o) => o.id === id)!.registerItemId = 500;
    const res = await obsGET(new Request("http://test/x"), pr("1", "10"));
    const json = (await res.json()) as {
      observations: Array<{ registerItem: { status: string } | null }>;
    };
    expect(json.observations[0].registerItem?.status).toBe("IN_PROGRESS");
    expect((await obsGET(new Request("http://test/x"), pr("2", "10"))).status).toBe(404);
  });
});

describe("PATCH observation (pre-resolution edit + freeze)", () => {
  test("edits are allowed and audited while ENTERED", async () => {
    const id = await seedObservation();
    const res = await obsPATCH(
      jsonReq({ observationText: "Handrail at stair 2 missing", sourcePage: "p.4" }, "PATCH"),
      po("1", "10", String(id))
    );
    expect(res.status).toBe(200);
    expect(h.observations.find((o) => o.id === id)!.sourcePage).toBe("p.4");
    expect(h.audits.map((a) => a.action)).toContain("observation_edited");
  });

  test("PATCH on a resolved row → 400, ZERO mutation (source freeze)", async () => {
    const id = await seedObservation();
    h.observations.find((o) => o.id === id)!.state = "ACCEPTED_NEW_ITEM";
    const before = { ...h.observations.find((o) => o.id === id)! };
    const res = await obsPATCH(
      jsonReq({ observationText: "changed", consultantTargetDate: "2026-08-01T00:00:00.000Z" }, "PATCH"),
      po("1", "10", String(id))
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/frozen/);
    expect(h.observations.find((o) => o.id === id)!).toEqual(before);
  });

  test("cross-project PATCH → 404", async () => {
    const id = await seedObservation();
    const res = await obsPATCH(
      jsonReq({ observationText: "x" }, "PATCH"),
      po("2", "10", String(id))
    );
    expect(res.status).toBe(404);
  });
});

describe("POST accept-new", () => {
  test("creates a TrackedItem with the consultant citation + flips state", async () => {
    const id = await seedObservation();
    const res = await acceptNewPOST(
      jsonReq({ title: "Install handrail at stair 2" }),
      po("1", "10", String(id))
    );
    expect(res.status).toBe(201);
    const { trackedItemId } = (await res.json()) as { trackedItemId: number };
    const item = h.items.find((i) => i.id === trackedItemId)!;
    expect(item.sourceKind).toBe("consultant_report");
    expect(item.sourceConsultantObservationId).toBe(id);
    expect(item.evidenceExcerpt).toBe("Handrail at stair 2 not yet installed");
    expect(item.sourceLocator).toBe("p.3");
    expect(item.extractionMethod).toBe("manual");
    const obs = h.observations.find((o) => o.id === id)!;
    expect(obs.state).toBe("ACCEPTED_NEW_ITEM");
    expect(obs.registerItemId).toBe(trackedItemId);
    expect(h.audits.map((a) => a.action)).toContain("observation_accepted_new");
  });

  test("consultantTargetDate is NEVER copied into dueDate (no sync)", async () => {
    const id = await seedObservation(true);
    const res = await acceptNewPOST(
      jsonReq({ title: "No due date given" }),
      po("1", "10", String(id))
    );
    const { trackedItemId } = (await res.json()) as { trackedItemId: number };
    expect(h.items.find((i) => i.id === trackedItemId)!.dueDate).toBeNull();
    // The observation's target date survives untouched, structurally separate.
    expect(h.observations.find((o) => o.id === id)!.consultantTargetDate).toEqual(
      new Date("2026-07-18T00:00:00.000Z")
    );
  });

  test("an explicit human-confirmed dueDate IS honored (one-time pre-fill)", async () => {
    const id = await seedObservation();
    const res = await acceptNewPOST(
      jsonReq({ title: "With due date", dueDate: "2026-07-15T00:00:00.000Z" }),
      po("1", "10", String(id))
    );
    const { trackedItemId } = (await res.json()) as { trackedItemId: number };
    expect(h.items.find((i) => i.id === trackedItemId)!.dueDate).toEqual(
      new Date("2026-07-15T00:00:00.000Z")
    );
  });

  test("accept from a non-ENTERED state → 400", async () => {
    const id = await seedObservation();
    h.observations.find((o) => o.id === id)!.state = "DISMISSED";
    const res = await acceptNewPOST(jsonReq({ title: "x" }), po("1", "10", String(id)));
    expect(res.status).toBe(400);
    expect(h.items).toHaveLength(0);
  });

  test("cross-project accept → 404, zero mutation", async () => {
    const id = await seedObservation();
    const res = await acceptNewPOST(jsonReq({ title: "x" }), po("2", "10", String(id)));
    expect(res.status).toBe(404);
    expect(h.items).toHaveLength(0);
    expect(h.observations.find((o) => o.id === id)!.state).toBe("ENTERED");
  });
});

describe("dismiss / reinstate", () => {
  test("dismiss records reason + audit; row stays listed", async () => {
    const id = await seedObservation();
    const res = await dismissPOST(
      jsonReq({ reason: "duplicate of item 12" }),
      po("1", "10", String(id))
    );
    expect(res.status).toBe(200);
    const obs = h.observations.find((o) => o.id === id)!;
    expect(obs.state).toBe("DISMISSED");
    expect(obs.dismissedReason).toBe("duplicate of item 12");
    expect(h.observations).toHaveLength(1); // never deleted
    expect(h.audits.map((a) => a.action)).toContain("observation_dismissed");
  });

  test("dismissing an accepted observation → 400", async () => {
    const id = await seedObservation();
    h.observations.find((o) => o.id === id)!.state = "ACCEPTED_NEW_ITEM";
    const res = await dismissPOST(jsonReq({}), po("1", "10", String(id)));
    expect(res.status).toBe(400);
  });

  test("reinstate returns a DISMISSED row to ENTERED, audited", async () => {
    const id = await seedObservation();
    await dismissPOST(jsonReq({ reason: "mistake" }), po("1", "10", String(id)));
    const res = await reinstatePOST(new Request("http://test/x", { method: "POST" }), po("1", "10", String(id)));
    expect(res.status).toBe(200);
    const obs = h.observations.find((o) => o.id === id)!;
    expect(obs.state).toBe("ENTERED");
    expect(obs.dismissedReason).toBeNull();
    expect(h.audits.map((a) => a.action)).toContain("observation_reinstated");
  });

  test("reinstating a non-dismissed row → 400; cross-project → 404", async () => {
    const id = await seedObservation();
    expect(
      (await reinstatePOST(new Request("http://test/x", { method: "POST" }), po("1", "10", String(id)))).status
    ).toBe(400);
    expect(
      (await dismissPOST(jsonReq({}), po("2", "10", String(id)))).status
    ).toBe(404);
  });
});
