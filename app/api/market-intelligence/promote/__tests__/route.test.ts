// ──────────────────────────────────────────────────────────────────────────────
//  Promotion API route tests.
//
//  Exercises the REAL route handlers over the REAL promotion service against
//  the in-memory Prisma fake. Only session resolution is mocked — everything
//  the route is responsible for (validation, status-code mapping, scope
//  non-disclosure) is genuinely executed.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  resetStore,
  type Store,
} from "@/lib/services/pursuitPromotion/__tests__/mockDb";
import type { PromotionActor } from "@/lib/services/pursuitPromotion/types";

const { store, actorRef } = vi.hoisted(() => ({
  store: {
    leads: new Map(),
    projects: new Map(),
    bids: new Map(),
    timeline: new Map(),
    audits: [],
    bidCounter: 0,
    beforeLeadSwap: null,
    beforeTimelineCreate: null,
    failAuditWrite: false,
    externalCommits: [],
  } as unknown as Store,
  actorRef: { current: null as PromotionActor | null },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("@/lib/prisma", async () => {
  const { buildPrismaMock } = await import(
    "@/lib/services/pursuitPromotion/__tests__/mockDb"
  );
  return { prisma: buildPrismaMock(store) };
});

vi.mock("@/lib/services/pursuitPromotion/actor", () => ({
  resolvePromotionActor: vi.fn(async () => actorRef.current),
}));

import { GET, POST } from "../route";

const ESTIMATOR: PromotionActor = { id: "u_est", role: "estimator", email: "est@example.com" };
const OTHER: PromotionActor = { id: "u_other", role: "estimator", email: "o@example.com" };
const PM: PromotionActor = { id: "u_pm", role: "pm", email: "pm@example.com" };

function seedLead(over: Record<string, unknown> = {}) {
  store.leads.set("lead_1", {
    id: "lead_1",
    title: "Riverside Medical Office",
    status: "QUALIFIED",
    location: "1200 Riverside Dr",
    jurisdiction: "Tulsa County",
    projectType: "medical office",
    estimatedValue: 8_400_000,
    sourceUrl: "https://city.example.gov/m.pdf",
    sourceDocId: "doc_9",
    promotedToBidId: null,
    promotedAt: null,
    ...over,
  } as never);
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/market-intelligence/promote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(qs: string): Request {
  return new Request(`http://localhost/api/market-intelligence/promote?${qs}`);
}

beforeEach(() => {
  resetStore(store);
  actorRef.current = ESTIMATOR;
});

describe("POST — authorization", () => {
  test("401 when unauthenticated", async () => {
    actorRef.current = null;
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  test("403 for a PM, with no pursuit created", async () => {
    seedLead();
    actorRef.current = PM;
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(store.bids.size).toBe(0);
  });
});

describe("POST — validation", () => {
  test.each([
    [{ sourceKind: "WIDGET", sourceId: "x" }, 400, "invalid_source_kind"],
    [{ sourceKind: "LEAD" }, 400, "invalid_source_id"],
    [{ sourceKind: "LEAD", sourceId: "   " }, 400, "invalid_source_id"],
    [{ sourceKind: "LEAD", sourceId: 42 }, 400, "invalid_source_id"],
    [{}, 400, "invalid_source_kind"],
  ])("rejects %j with %i", async (body, status, code) => {
    const res = await POST(postReq(body));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
  });

  test("a malformed body does not throw", async () => {
    const req = new Request("http://localhost/api/market-intelligence/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("404 for a source that does not exist", async () => {
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "ghost" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  test("409 for an unsupported source status", async () => {
    seedLead({ status: "DISMISSED" });
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ineligible_status");
    expect(body.status).toBe("DISMISSED");
  });
});

describe("POST — promotion", () => {
  test("201 on create, and the body carries the pursuit to navigate to", async () => {
    seedLead();
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reused).toBe(false);
    expect(typeof body.bidId).toBe("number");
    expect(store.bids.has(body.bidId)).toBe(true);
  });

  test("200 + reused on an idempotent retry, creating no second pursuit", async () => {
    seedLead();
    const first = await (await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }))).json();
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reused).toBe(true);
    expect(body.bidId).toBe(first.bidId);
    expect(store.bids.size).toBe(1);
  });

  test("does not disclose a cross-scope pursuit on a duplicate retry", async () => {
    seedLead();
    const first = await (await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }))).json();

    actorRef.current = OTHER;
    const res = await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));
    expect(res.status).toBe(409);

    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe("already_promoted");
    expect(raw).not.toContain(String(first.bidId));
    expect(raw).not.toContain("u_est");
  });
});

describe("GET — preview", () => {
  test("401 when unauthenticated", async () => {
    actorRef.current = null;
    const res = await GET(getReq("sourceKind=LEAD&sourceId=lead_1"));
    expect(res.status).toBe(401);
  });

  test("returns the server-authoritative draft for an eligible source", async () => {
    seedLead();
    const res = await GET(getReq("sourceKind=LEAD&sourceId=lead_1"));
    expect(res.status).toBe(200);

    const { preview } = await res.json();
    expect(preview.eligible).toBe(true);
    expect(preview.draft.projectName).toBe("Riverside Medical Office");
    expect(preview.draft.buildingType).toBe("medical office");
    expect(preview.existingBidId).toBeNull();
  });

  test("previewing never mutates", async () => {
    seedLead();
    await GET(getReq("sourceKind=LEAD&sourceId=lead_1"));
    expect(store.bids.size).toBe(0);
    expect(store.audits).toHaveLength(0);
    expect(store.leads.get("lead_1")!.promotedToBidId).toBeNull();
  });

  test("reports the already-promoted state with its pursuit id", async () => {
    seedLead();
    const created = await (await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }))).json();

    const { preview } = await (await GET(getReq("sourceKind=LEAD&sourceId=lead_1"))).json();
    expect(preview.eligible).toBe(false);
    expect(preview.reason).toBe("already_promoted");
    expect(preview.existingBidId).toBe(created.bidId);
  });

  test("hides a cross-scope pursuit id from the preview", async () => {
    seedLead();
    await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));

    actorRef.current = OTHER;
    const { preview } = await (await GET(getReq("sourceKind=LEAD&sourceId=lead_1"))).json();
    expect(preview.reason).toBe("already_promoted");
    expect(preview.existingBidId).toBeNull();
    expect(preview.promotedOutOfScope).toBe(true);
  });

  test("404 for an unknown source — indistinguishable from unreadable", async () => {
    const res = await GET(getReq("sourceKind=LEAD&sourceId=ghost"));
    expect(res.status).toBe(404);
  });

  test("400 for a bad source kind", async () => {
    const res = await GET(getReq("sourceKind=WIDGET&sourceId=x"));
    expect(res.status).toBe(400);
  });
});

describe("no external provider is reached", () => {
  test("promotion performs no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    seedLead();
    await POST(postReq({ sourceKind: "LEAD", sourceId: "lead_1" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
