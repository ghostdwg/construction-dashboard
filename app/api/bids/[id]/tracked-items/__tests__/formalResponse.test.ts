// Module OPS3 (Phase 1A) — the audited formal-response PATCH. Card §15
// requirements verified here: prior value remains in the domain row,
// generic audit is body-free, and audit failure rolls the mutation back.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  items: [] as Row[],
  auditRows: [] as Array<Record<string, unknown>>,
  emits: [] as Array<Record<string, unknown>>,
  authOk: true,
  auditFail: false,
}));

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

vi.mock("@/lib/services/operationsAudit", () => ({
  writeOperationsAuditTx: vi.fn(async (_tx, args: Record<string, unknown>) => {
    if (h.auditFail) throw new Error("synthetic audit failure");
    h.auditRows.push({
      ...args,
      category: args.category ?? "register_action",
      payloadJson: JSON.stringify(args.payload ?? {}),
    });
    return args;
  }),
  emitOperationsAuditPostCommit: vi.fn((envelope: Record<string, unknown>) => {
    h.emits.push(envelope);
  }),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock("@/lib/prisma", () => {
  const prisma = {
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
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.auditRows.push(data);
        return { id: "a1", ...data };
      }),
    },
  } as Record<string, unknown>;
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const itemSnapshot = structuredClone(h.items);
    const auditSnapshot = structuredClone(h.auditRows);
    try {
      return await fn(prisma);
    } catch (error) {
      h.items.splice(0, h.items.length, ...itemSnapshot);
      h.auditRows.splice(0, h.auditRows.length, ...auditSnapshot);
      throw error;
    }
  });
  return { prisma };
});

import { PATCH as formalResponsePATCH } from "../[itemId]/formal-response/route";

const pi = (id: string, itemId: string) => ({
  params: Promise.resolve({ id, itemId }),
});
const patchReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const RESPONSE_TEXT = "We will re-install the handrail per detail 5/A501 by 7/15.";

let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  h.authOk = true;
  h.items.length = 0;
  h.auditRows.length = 0;
  h.emits.length = 0;
  h.auditFail = false;
  h.items.push({
    id: 7,
    bidId: 1,
    formalResponse: null,
    formalResponseBy: null,
    formalResponseAt: null,
    formalResponsePrior: null,
  });
  consoleSpies = [
    vi.spyOn(console, "log"),
    vi.spyOn(console, "info"),
    vi.spyOn(console, "warn"),
    vi.spyOn(console, "error"),
  ];
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
});

function allConsoleOutput(): string {
  return consoleSpies
    .flatMap((s) => s.mock.calls)
    .map((args) =>
      args.map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    )
    .join("\n");
}

describe("PATCH tracked-items/[itemId]/formal-response", () => {
  test("first save sets value, actor, timestamp; prior is null everywhere", async () => {
    const res = await formalResponsePATCH(patchReq({ formalResponse: RESPONSE_TEXT }), pi("1", "7"));
    expect(res.status).toBe(200);
    const item = h.items[0];
    expect(item.formalResponse).toBe(RESPONSE_TEXT);
    expect(item.formalResponseBy).toBe("josh@example.test");
    expect(item.formalResponseAt).toBeInstanceOf(Date);
    expect(item.formalResponsePrior).toBeNull();

    expect(h.auditRows).toHaveLength(1);
    const payload = JSON.parse(h.auditRows[0].payloadJson as string) as Record<string, unknown>;
    expect(payload).toEqual({ bidId: 1, priorLength: 0, newLength: RESPONSE_TEXT.length });
    expect(h.auditRows[0].action).toBe("formal_response_edited");
    expect(h.auditRows[0].category).toBe("consultant_report");
  });

  test("second edit records PRIOR text only on the domain item, never generic audit", async () => {
    await formalResponsePATCH(patchReq({ formalResponse: RESPONSE_TEXT }), pi("1", "7"));
    const res = await formalResponsePATCH(
      patchReq({ formalResponse: "Revised: complete, pending consultant verification." }),
      pi("1", "7")
    );
    expect(res.status).toBe(200);
    expect(h.items[0].formalResponsePrior).toBe(RESPONSE_TEXT);
    const payload = JSON.parse(h.auditRows[1].payloadJson as string) as Record<string, unknown>;
    expect(payload).toMatchObject({ priorLength: RESPONSE_TEXT.length });
    expect(JSON.stringify(payload)).not.toContain(RESPONSE_TEXT);
    expect(h.auditRows[1].decision).toBe("edited");
  });

  test("audit contains true lengths and no response body", async () => {
    const long = "x".repeat(600);
    await formalResponsePATCH(patchReq({ formalResponse: long }), pi("1", "7"));
    await formalResponsePATCH(patchReq({ formalResponse: "short" }), pi("1", "7"));
    const payload = JSON.parse(h.auditRows[1].payloadJson as string) as { priorLength: number };
    expect(payload.priorLength).toBe(600);
    expect(JSON.stringify(payload)).not.toContain("x".repeat(20));
  });

  test("stdout/log projections NEVER emit formal-response text", async () => {
    await formalResponsePATCH(patchReq({ formalResponse: RESPONSE_TEXT }), pi("1", "7"));
    await formalResponsePATCH(patchReq({ formalResponse: "second value, also secret" }), pi("1", "7"));
    // Nothing printed by the route/service path at all…
    expect(allConsoleOutput()).not.toContain(RESPONSE_TEXT);
    expect(allConsoleOutput()).not.toContain("also secret");
    // …and the stdout-bound emitter envelope carries lengths only.
    for (const emit of h.emits) {
      const s = JSON.stringify(emit);
      expect(s).not.toContain(RESPONSE_TEXT);
      expect(s).not.toContain("also secret");
    }
    expect(h.emits.length).toBe(2);
  });

  test("audit failure rolls the formal response mutation back with no telemetry", async () => {
    h.auditFail = true;
    await expect(
      formalResponsePATCH(patchReq({ formalResponse: RESPONSE_TEXT }), pi("1", "7")),
    ).rejects.toThrow("synthetic audit failure");
    expect(h.items[0].formalResponse).toBeNull();
    expect(h.auditRows).toEqual([]);
    expect(h.emits).toEqual([]);
  });

  test("over-length response (>4000) → 400, nothing stored", async () => {
    const res = await formalResponsePATCH(
      patchReq({ formalResponse: "y".repeat(4001) }),
      pi("1", "7")
    );
    expect(res.status).toBe(400);
    expect(h.items[0].formalResponse).toBeNull();
    expect(h.auditRows).toHaveLength(0);
  });

  test("empty / missing / non-string body → 400", async () => {
    expect((await formalResponsePATCH(patchReq({ formalResponse: "   " }), pi("1", "7"))).status).toBe(400);
    expect((await formalResponsePATCH(patchReq({}), pi("1", "7"))).status).toBe(400);
    expect((await formalResponsePATCH(patchReq({ formalResponse: 42 }), pi("1", "7"))).status).toBe(400);
  });

  test("cross-project item → 404, zero mutation, zero audit", async () => {
    const res = await formalResponsePATCH(patchReq({ formalResponse: RESPONSE_TEXT }), pi("2", "7"));
    expect(res.status).toBe(404);
    expect(h.items[0].formalResponse).toBeNull();
    expect(h.auditRows).toHaveLength(0);
    expect(h.emits).toHaveLength(0);
  });
});
