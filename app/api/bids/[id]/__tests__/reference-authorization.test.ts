import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireBidAccess: vi.fn(),
  specBookFindFirst: vi.fn(),
  sectionFindMany: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: h.requireBidAccess,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: { findFirst: h.specBookFindFirst },
    specSection: { findMany: h.sectionFindMany },
  },
}));

import { GET as getCloseout } from "../closeout/route";
import { GET as getInspections } from "../inspections/route";
import { GET as getTraining } from "../training/route";
import { GET as getWarranties } from "../warranties/route";

const handlers = [
  ["closeout", getCloseout],
  ["warranties", getWarranties],
  ["training", getTraining],
  ["inspections", getInspections],
] as const;

const routeParams = { params: Promise.resolve({ id: "41" }) };

describe("Lifecycle Reference read isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireBidAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner", role: "pm" },
    });
    h.specBookFindFirst.mockResolvedValue(null);
    h.sectionFindMany.mockResolvedValue([]);
  });

  test.each(handlers)("%s rejects anonymous reads before any Spec query", async (name, handler) => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });

    const response = await handler(new Request(`http://localhost/api/bids/41/${name}`), routeParams);

    expect(response.status).toBe(401);
    expect(h.requireBidAccess).toHaveBeenCalledWith(41);
    expect(h.specBookFindFirst).not.toHaveBeenCalled();
    expect(h.sectionFindMany).not.toHaveBeenCalled();
  });

  test.each(handlers)("%s rejects authenticated non-owners before any Spec query", async (name, handler) => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await handler(new Request(`http://localhost/api/bids/41/${name}`), routeParams);

    expect(response.status).toBe(403);
    expect(h.specBookFindFirst).not.toHaveBeenCalled();
    expect(h.sectionFindMany).not.toHaveBeenCalled();
  });

  test("authorized lifecycle read remains bid-scoped and preserves its empty response", async () => {
    const response = await getWarranties(
      new Request("http://localhost/api/bids/41/warranties"),
      routeParams,
    );

    expect(response.status).toBe(200);
    expect(h.specBookFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { bidId: 41, status: "ready" },
    }));
    await expect(response.json()).resolves.toEqual({
      warranties: [],
      stats: { total: 0, sectionsWithWarranties: 0, byType: {} },
    });
  });
});
