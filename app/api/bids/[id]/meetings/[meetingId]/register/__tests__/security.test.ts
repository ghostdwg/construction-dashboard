// R2-B1 — security tests for the Meeting Register surface.
//
// (1) Denied access: when requireBidAccess says no, every new route returns
//     that response verbatim and performs ZERO service/prisma work — the
//     exact regression class Codex flagged in gwx/phase1a-ai-extraction.
// (2) Cross-bid: entry/run ids belonging to another bid 404.
// (3) Guard inventory: every route file under meetings/** must contain the
//     bid-access guard (source-text assertion, navRecovery style).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  prismaCalls: 0,
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => {
    if (state.denied) {
      return {
        ok: false,
        response: Response.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    return { ok: true, user: { id: "u1", role: "admin" } };
  }),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.com" } })),
}));
vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: vi.fn(async () => {}) }));

// Counting prisma proxy — any property access that leads to a call counts.
vi.mock("@/lib/prisma", () => {
  const rowStores: Record<string, unknown[]> = {
    meeting: [{ id: 5, bidId: 1 }],
    meetingRegisterEntry: [
      {
        id: 1, meetingId: 5, bidId: 1, entryType: "RISK", rawSourceText: "r", normalizedText: "r",
        origin: "ai_extraction", reviewState: "PENDING", linkedTrackedItemId: null,
        dueDate: null, mergedIntoEntryId: null,
      },
      // cross-bid entry — same meeting id namespace, different bid
      {
        id: 99, meetingId: 5, bidId: 2, entryType: "RISK", rawSourceText: "x", normalizedText: "x",
        origin: "ai_extraction", reviewState: "PENDING", linkedTrackedItemId: null,
        dueDate: null, mergedIntoEntryId: null,
      },
    ],
    meetingExtractionRun: [],
    meetingRegisterEntryRevision: [],
    meetingTranscriptSegment: [],
    meetingTranscriptCorrection: [],
    meetingMinutesRevision: [],
    meetingParticipant: [],
    trackedItem: [],
  };
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v !== null && typeof v === "object" && !Array.isArray(v) ? true : row[k] === v
    );
  const table = (name: string) => ({
    findFirst: async (args: { where?: Record<string, unknown> } = {}) => {
      state.prismaCalls++;
      return (rowStores[name] ?? []).find((r) => matches(r as Record<string, unknown>, args.where)) ?? null;
    },
    findUnique: async (args: { where: Record<string, unknown> }) => {
      state.prismaCalls++;
      return (rowStores[name] ?? []).find((r) => matches(r as Record<string, unknown>, args.where)) ?? null;
    },
    findMany: async (args: { where?: Record<string, unknown> } = {}) => {
      state.prismaCalls++;
      return (rowStores[name] ?? []).filter((r) => matches(r as Record<string, unknown>, args.where));
    },
    count: async () => {
      state.prismaCalls++;
      return 0;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      state.prismaCalls++;
      return { id: 1000, ...args.data };
    },
    update: async () => {
      state.prismaCalls++;
      return {};
    },
    updateMany: async () => {
      state.prismaCalls++;
      return { count: 0 };
    },
    deleteMany: async () => {
      state.prismaCalls++;
      return { count: 0 };
    },
  });
  const prisma = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "$transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
        }
        return table(prop);
      },
    }
  );
  return { prisma };
});

import { GET as registerGET, POST as registerPOST } from "../route";
import { PATCH as entryPATCH } from "../[entryId]/route";
import { POST as dispositionPOST } from "../[entryId]/disposition/route";
import { POST as promotePOST } from "../[entryId]/promote/route";
import { POST as linkPOST } from "../[entryId]/link/route";
import { GET as coverageGET } from "../coverage/route";

const params = (entryId?: string) =>
  ({ params: Promise.resolve({ id: "1", meetingId: "5", ...(entryId ? { entryId } : {}) }) }) as never;

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.denied = false;
  state.prismaCalls = 0;
});

describe("denied access — every route returns the guard response with zero data-layer work", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["GET register", () => registerGET(new Request("http://local/x"), params())],
    ["POST register", () => registerPOST(jsonReq({ entryType: "RISK", normalizedText: "x" }), params())],
    ["PATCH entry", () => entryPATCH(jsonReq({ normalizedText: "x" }), params("1"))],
    ["POST disposition", () => dispositionPOST(jsonReq({ disposition: "CONFIRMED" }), params("1"))],
    ["POST promote", () => promotePOST(jsonReq({}), params("1"))],
    ["POST link", () => linkPOST(jsonReq({ trackedItemId: 1 }), params("1"))],
    ["GET coverage", () => coverageGET(new Request("http://local/x"), params())],
  ];

  for (const [name, run] of cases) {
    it(`${name} → 403, no prisma calls`, async () => {
      state.denied = true;
      const res = await run();
      expect(res.status).toBe(403);
      expect(state.prismaCalls).toBe(0);
    });
  }
});

describe("cross-bid ids 404 even for authenticated users", () => {
  it("disposition of an entry belonging to another bid → 404", async () => {
    const res = await dispositionPOST(jsonReq({ disposition: "CONFIRMED" }), params("99"));
    expect(res.status).toBe(404);
  });

  it("promotion of an entry belonging to another bid → 404", async () => {
    const res = await promotePOST(jsonReq({}), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("guard inventory — every meetings route file carries the bid-access guard", () => {
  it("all route.ts files under app/api/bids/[id]/meetings use requireBidAccess (directly or via meetingRouteContext)", () => {
    const root = join(process.cwd(), "app/api/bids/[id]/meetings");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__") walk(p);
        } else if (name === "route.ts") {
          files.push(p);
        }
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThanOrEqual(20);
    const unguarded = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return !src.includes("requireBidAccess") && !src.includes("meetingRouteContext");
    });
    expect(unguarded).toEqual([]);
  });
});
