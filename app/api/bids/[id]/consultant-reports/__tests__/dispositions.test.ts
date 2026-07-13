// Module OPS4 (Phase 1B) — append-only disposition log. Pins all three
// fences: 405 handlers, create/read-only service surface, and (via the
// mocked model) that a second disposition APPENDS. Mocked Prisma/auth per
// repo idiom — no DB, no network.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  observations: [] as Row[],
  dispositions: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  currentUser: { id: "u1", role: "admin" } as { id: string; role: string } | null,
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    consultantObservation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.observations.find((o) => matches(o, where));
        return found ? { ...found } : null;
      }),
    },
    consultantDispositionRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, disposedAt: new Date(h.nextId), ...data } as Row;
        h.dispositions.push(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.dispositions.filter((d) => matches(d, where))
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const rows = h.dispositions.filter((d) => matches(d, where));
        return rows.length ? { ...rows[rows.length - 1] } : null;
      }),
      // Mutation paths exist on the mock ONLY to prove the service never
      // calls them (the real client's extension throws on all of these).
      update: vi.fn(async () => {
        throw new Error("append-only");
      }),
      delete: vi.fn(async () => {
        throw new Error("append-only");
      }),
    },
  },
}));

import * as dispositionService from "@/lib/services/consultantReports/dispositions";
import {
  DELETE as disposeDELETE,
  GET as disposeGET,
  PATCH as disposePATCH,
  POST as disposePOST,
  PUT as disposePUT,
} from "../[reportId]/observations/[observationId]/dispose/route";

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
  h.observations.length = 0;
  h.dispositions.length = 0;
  h.audits.length = 0;
  h.currentUser = { id: "u1", role: "admin" };
  h.authOk = true;
  h.nextId = 1;
  h.observations.push({ id: 100, reportId: 10, bidId: 1, state: "ENTERED" });
});

describe("POST dispose", () => {
  test("admin and pm can record; row carries actor + type; audited without text", async () => {
    const res = await disposePOST(
      jsonReq({ dispositionType: "APPROVE", dispositionText: "meets the revised detail" }),
      po("1", "10", "100")
    );
    expect(res.status).toBe(201);
    expect(h.dispositions).toHaveLength(1);
    expect(h.dispositions[0]).toMatchObject({
      observationId: 100,
      bidId: 1,
      dispositionType: "APPROVE",
      disposedBy: "josh@example.test",
    });
    const audit = h.audits.find((a) => a.action === "disposition_recorded")!;
    expect(JSON.stringify(audit.payload)).not.toContain("revised detail");
    expect(audit.payload).toMatchObject({
      textLength: "meets the revised detail".length,
    });

    h.currentUser = { id: "u2", role: "pm" };
    expect(
      (await disposePOST(jsonReq({ dispositionType: "DEFER" }), po("1", "10", "100"))).status
    ).toBe(201);
  });

  test("a second disposition APPENDS — both rows kept, latest is current", async () => {
    await disposePOST(jsonReq({ dispositionType: "REJECT" }), po("1", "10", "100"));
    await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("1", "10", "100"));
    expect(h.dispositions).toHaveLength(2);
    expect(h.dispositions.map((d) => d.dispositionType)).toEqual(["REJECT", "APPROVE"]);
    const current = await dispositionService.currentDisposition(1, 100);
    expect(current?.dispositionType).toBe("APPROVE");
  });

  test("estimator → 403 zero rows; unauthenticated → 401", async () => {
    h.currentUser = { id: "u3", role: "estimator" };
    expect(
      (await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("1", "10", "100"))).status
    ).toBe(403);
    expect(h.dispositions).toHaveLength(0);

    h.authOk = false;
    expect(
      (await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("1", "10", "100"))).status
    ).toBe(401);
  });

  test("unknown type / over-length text → 400; cross-project → 404 zero rows", async () => {
    expect(
      (await disposePOST(jsonReq({ dispositionType: "MAYBE" }), po("1", "10", "100"))).status
    ).toBe(400);
    expect(
      (
        await disposePOST(
          jsonReq({ dispositionType: "APPROVE", dispositionText: "x".repeat(2001) }),
          po("1", "10", "100")
        )
      ).status
    ).toBe(400);
    expect(
      (await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("2", "10", "100"))).status
    ).toBe(404);
    expect(
      (await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("1", "99", "100"))).status
    ).toBe(404);
    expect(h.dispositions).toHaveLength(0);
  });
});

describe("append-only enforcement", () => {
  test("PATCH / PUT / DELETE → 405, zero mutation", async () => {
    await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("1", "10", "100"));
    for (const handler of [disposePATCH, disposePUT, disposeDELETE]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(((await res.json()) as { error: string }).error).toMatch(/append-only/);
    }
    expect(h.dispositions).toHaveLength(1);
    expect(h.dispositions[0].dispositionType).toBe("APPROVE");
  });

  test("the service module exports NO update or delete function", () => {
    const exported = Object.keys(dispositionService);
    expect(exported.some((n) => /update|delete|remove|edit/i.test(n))).toBe(false);
    expect(exported).toContain("recordDisposition");
    expect(exported).toContain("listDispositions");
  });
});

describe("GET dispose (log)", () => {
  test("returns the chronological log; cross-project → 404; unauth → 401", async () => {
    await disposePOST(jsonReq({ dispositionType: "REJECT" }), po("1", "10", "100"));
    await disposePOST(jsonReq({ dispositionType: "APPROVE" }), po("1", "10", "100"));
    const res = await disposeGET(new Request("http://test/x"), po("1", "10", "100"));
    const json = (await res.json()) as { dispositions: Array<{ dispositionType: string }> };
    expect(json.dispositions.map((d) => d.dispositionType)).toEqual(["REJECT", "APPROVE"]);

    expect((await disposeGET(new Request("http://test/x"), po("2", "10", "100"))).status).toBe(404);
    h.authOk = false;
    expect((await disposeGET(new Request("http://test/x"), po("1", "10", "100"))).status).toBe(401);
  });
});
