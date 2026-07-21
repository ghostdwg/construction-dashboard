import { beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────────
//  Generic manual Market Lead creation is RETIRED. These tests prove the browser
//  path is closed: the endpoint answers POST with 405 and can never create a
//  MarketLead — not for an anonymous caller, not for a fully-authorized one, and
//  not by reaching the live-ingestion bridge. The route stays POST-only (no list
//  verb), so the retired endpoint cannot be repurposed to read or manufacture
//  intelligence candidates.
//
//  The legitimate ingestion pipeline (scrapeOneSource → processNewMarketLead) is
//  a different, in-process caller and is unaffected by this route's retirement;
//  its own suites cover it.
// ──────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  processNewMarketLead: vi.fn(),
  fireAndForgetIngest: vi.fn(),
}));

// If the retired handler ever tried to authenticate, write, or ingest, these
// spies would record it. They must stay untouched.
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { marketLead: { create: h.create } },
}));
vi.mock("@/lib/services/liveIngestion", () => ({
  processNewMarketLead: h.processNewMarketLead,
  fireAndForgetIngest: h.fireAndForgetIngest,
}));

import * as route from "../route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/market-intelligence/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function expectNoSideEffects() {
  expect(h.create).not.toHaveBeenCalled();
  expect(h.processNewMarketLead).not.toHaveBeenCalled();
  expect(h.fireAndForgetIngest).not.toHaveBeenCalled();
  // The retired handler must not even resolve a session — there is no work to
  // authorize, and it must not depend on auth to stay closed.
  expect(h.auth).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_DISABLED = "false";
});

describe("POST /api/market-intelligence/leads — retired manual creation", () => {
  test("an anonymous browser POST returns 405 and creates nothing", async () => {
    const req = request({ title: "Hand-typed lead" });
    const parse = vi.spyOn(req, "json");

    const response = await route.POST();

    expect(response.status).toBe(405);
    expect(parse).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test("even a would-be authorized POST returns 405 and creates nothing", async () => {
    // Regardless of who is calling, manual creation is closed: no evidence-free
    // MarketLead can be manufactured through this endpoint.
    h.auth.mockResolvedValue({
      user: { id: "user_admin", role: "admin", email: "admin@example.com" },
    });

    const response = await route.POST();

    expect(response.status).toBe(405);
    expectNoSideEffects();
  });

  test("the 405 body explains creation is retired without echoing input", async () => {
    const response = await route.POST();
    const body = (await response.json()) as { error: string; detail: string };

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method Not Allowed");
    expect(body.detail).toMatch(/retired/i);
    // Points operators at the correct manual-opportunity workspace (Pursuits).
    expect(body.detail).toContain("/bids/new");
  });

  test("advertises no allowed method for manual creation", async () => {
    const response = await route.POST();
    expect(response.headers.get("Allow")).toBe("");
  });
});

describe("/api/market-intelligence/leads — surface", () => {
  test("exposes no GET/list verb, so it stays POST-only", () => {
    expect(route).not.toHaveProperty("GET");
    expect(route).not.toHaveProperty("PUT");
    expect(route).not.toHaveProperty("PATCH");
    expect(route).not.toHaveProperty("DELETE");
  });
});
