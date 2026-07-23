import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireBidAccess: vi.fn(),
  sectionFindFirst: vi.fn(),
  sectionUpdate: vi.fn(),
  bidTradeFindUnique: vi.fn(),
  bidTradeCreate: vi.fn(),
  autoPopulateBidSubs: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: h.requireBidAccess,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specSection: {
      findFirst: h.sectionFindFirst,
      update: h.sectionUpdate,
    },
    bidTrade: {
      findUnique: h.bidTradeFindUnique,
      create: h.bidTradeCreate,
    },
  },
}));

vi.mock("@/lib/services/autoPopulateBidSubs", () => ({
  autoPopulateBidSubs: h.autoPopulateBidSubs,
}));

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
  },
}));

import { PATCH } from "../route";

const routeParams = (bidId: number, sectionId: number) => ({
  params: Promise.resolve({ id: String(bidId), sectionId: String(sectionId) }),
});

describe("Spec section authorization and child isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireBidAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner", role: "pm" },
    });
    h.sectionFindFirst.mockResolvedValue({ id: 9 });
    h.sectionUpdate.mockResolvedValue({
      id: 9,
      tradeId: null,
      matchedTradeId: null,
      covered: false,
      trade: null,
      matchedTrade: null,
    });
  });

  test("anonymous mutation is rejected before child lookup or body parsing", async () => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    const json = vi.fn();

    const response = await PATCH({ json } as unknown as Request, routeParams(7, 9));

    expect(response.status).toBe(401);
    expect(h.sectionFindFirst).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(h.sectionUpdate).not.toHaveBeenCalled();
  });

  test("cross-bid section substitution is concealed before parsing or mutation", async () => {
    h.sectionFindFirst.mockResolvedValue(null);
    const json = vi.fn();

    const response = await PATCH({ json } as unknown as Request, routeParams(7, 999));

    expect(response.status).toBe(404);
    expect(h.sectionFindFirst).toHaveBeenCalledWith({
      where: { id: 999, specBook: { bidId: 7 } },
      select: { id: true },
    });
    expect(json).not.toHaveBeenCalled();
    expect(h.bidTradeCreate).not.toHaveBeenCalled();
    expect(h.autoPopulateBidSubs).not.toHaveBeenCalled();
    expect(h.sectionUpdate).not.toHaveBeenCalled();
  });

  test("authorized section update preserves the existing response", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/bids/7/specbook/sections/9", {
        method: "PATCH",
        body: JSON.stringify({ tradeId: null }),
      }),
      routeParams(7, 9),
    );

    expect(response.status).toBe(200);
    expect(h.sectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9 },
      data: { tradeId: null, matchedTradeId: null, covered: false },
    }));
    await expect(response.json()).resolves.toMatchObject({ id: 9, covered: false });
  });
});
