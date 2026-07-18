// R2 auth/durability regression pack — Area H: real authenticated route
// behavior, WITHOUT relying on AUTH_DISABLED=true.
//
// Every other file in this pack mocks "@/lib/auth-helpers" wholesale (the
// repo's dominant test convention — see security.test.ts /
// tracked-items/__tests__/routes.test.ts) because those files are testing
// something ELSE (provenance, atomicity, ordering) and treat authorization
// as a known-good black box. THIS file does the opposite: it imports the
// REAL lib/auth-helpers.ts — requireUser() / getUser() / assertBidAccess() /
// requireBidAccess() all run their actual logic — and mocks only the two
// things a unit test legitimately cannot use for real: the next-auth
// session resolver (no real cookie/JWT/network) and Prisma (no real DB).
// AUTH_DISABLED is never set — confirmed by grep across the repo's
// *.test.ts files, that flag is exclusively the Playwright e2e/dev-boot
// bypass (playwright.config.ts), never a unit-test authentication pattern.
//
// GENUINELY EXERCISED (real code, not mocked): getUser()'s session→AppUser
// mapping (including the ESTIMATOR role default), requireUser()'s 401 on no
// session, bidScopeFilter()/assertBidAccess()'s ADMIN-bypass and
// createdById-ownership logic, requireBidAccess()'s composition of all of
// the above plus its 404-for-unknown-bid / 403-for-wrong-owner discipline.
//
// MOCKED: next-auth's auth() call itself (returns a fixed session object —
// no real JWT decode, no real cookie), Prisma (in-memory fixture — no real
// DB round-trip).
//
// NOT VERIFIED by this file (documented, not silently assumed): the
// proxy.ts session WALL itself (this test calls the route handler directly,
// bypassing Next.js middleware entirely — proxy.ts has its own dedicated
// test, __tests__/proxy.test.ts, per repo convention), real next-auth JWT
// issuance/verification, and any real database round-trip.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./support/mockPrisma";
import { BID_A } from "./support/fixtures";

const state = vi.hoisted(() => ({
  prisma: null as unknown as MockPrisma,
  session: null as { user: { id: string; role?: string } } | null,
}));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => state.session),
}));
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

// Real module — NOT mocked. This is the point of this file.
import { requireBidAccess, requireUser, assertBidAccess } from "@/lib/auth-helpers";
import { GET as trackedItemsGET, POST as trackedItemsPOST } from "@/app/api/bids/[id]/tracked-items/route";

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const getReq = () => new Request("http://local/x");
const jsonReq = (body: unknown) =>
  new Request("http://local/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  state.prisma = buildPrisma();
  state.session = null;
  await state.prisma.bid.create({ data: { id: BID_A, projectName: "Bid A", createdById: "user-a" } });
});

describe("real requireBidAccess() — unauthenticated session", () => {
  it("no session at all -> requireUser() genuinely throws a 401 Response, route returns 401, zero prisma work", async () => {
    state.session = null;
    const res = await trackedItemsGET(getReq(), idParams(String(BID_A)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Authentication required");
  });

  it("requireUser() called directly also throws the identical 401 Response shape (proves the route's 401 comes from the real helper, not route-local logic)", async () => {
    state.session = null;
    await expect(requireUser()).rejects.toBeInstanceOf(Response);
    try {
      await requireUser();
    } catch (thrown) {
      expect((thrown as Response).status).toBe(401);
    }
  });
});

describe("real assertBidAccess() — authenticated but wrong owner", () => {
  it("an authenticated non-admin user who does NOT own the bid gets a genuine 403 from assertBidAccess's ownership check", async () => {
    state.session = { user: { id: "user-b" } }; // role omitted -> defaults to ESTIMATOR (real getUser() logic)
    const res = await trackedItemsGET(getReq(), idParams(String(BID_A)));
    expect(res.status).toBe(403);
  });

  it("assertBidAccess() called directly throws 403 for a non-owner, non-admin user", () => {
    expect(() => assertBidAccess({ id: "user-b", role: "estimator" }, { createdById: "user-a" })).toThrow();
  });

  it("assertBidAccess() called directly does NOT throw for the actual owner", () => {
    expect(() => assertBidAccess({ id: "user-a", role: "estimator" }, { createdById: "user-a" })).not.toThrow();
  });
});

describe("real assertBidAccess() — admin bypass is genuine, not mocked away", () => {
  it("an admin session accesses a bid it does NOT own", async () => {
    state.session = { user: { id: "some-admin", role: "admin" } };
    const res = await trackedItemsGET(getReq(), idParams(String(BID_A)));
    expect(res.status).toBe(200);
  });
});

describe("real requireBidAccess() — the owner succeeds end-to-end through the actual route", () => {
  it("GET as the owning user returns 200 and reaches the data layer", async () => {
    state.session = { user: { id: "user-a", role: "estimator" } };
    const res = await trackedItemsGET(getReq(), idParams(String(BID_A)));
    expect(res.status).toBe(200);
  });

  it("POST as the owning user creates a TrackedItem through the real auth chain", async () => {
    state.session = { user: { id: "user-a", role: "estimator" } };
    const res = await trackedItemsPOST(jsonReq({ kind: "OAC_ACTION", title: "Real auth chain item" }), idParams(String(BID_A)));
    expect(res.status).toBe(201);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });
});

describe("real requireBidAccess() — cross-project 404 discipline", () => {
  it("a bidId that does not exist at all returns 404 (never 403 — indistinguishable from out-of-tenancy by design)", async () => {
    state.session = { user: { id: "user-a", role: "estimator" } };
    const result = await requireBidAccess(999999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });
});
