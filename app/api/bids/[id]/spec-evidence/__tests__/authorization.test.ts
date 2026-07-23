import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  access: {
    ok: true,
    user: { id: "owner-1", role: "pm" },
  } as
    | { ok: true; user: { id: string; role: string } }
    | { ok: false; response: Response },
  specFindMany: vi.fn(),
  addendumFindMany: vi.fn(),
  citationFindFirst: vi.fn(),
  publish: vi.fn(),
  listSets: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => h.access),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: { findMany: h.specFindMany },
    addendumUpload: { findMany: h.addendumFindMany },
    specCitation: { findFirst: h.citationFindFirst },
  },
}));
vi.mock("@/lib/services/specEvidence/effectiveSets", () => ({
  publishEffectiveSet: h.publish,
  listEffectiveSets: h.listSets,
}));
vi.mock("@/lib/services/specbook/storagePath", () => ({
  storagePathExists: vi.fn(async () => true),
}));

const versionsParams = { params: Promise.resolve({ id: "7" }) };

describe("Spec evidence authorization and cross-bid isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access = { ok: true, user: { id: "owner-1", role: "pm" } };
    h.specFindMany.mockResolvedValue([]);
    h.addendumFindMany.mockResolvedValue([]);
    h.listSets.mockResolvedValue([]);
    h.publish.mockResolvedValue({ id: 1 });
    h.citationFindFirst.mockResolvedValue(null);
  });

  test("rejects an anonymous manifest publish before parsing JSON or writing", async () => {
    h.access = {
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    };
    const request = new Request("http://localhost/api/bids/7/spec-evidence/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseSpecBookId: 1, addendumUploadIds: [] }),
    });
    const jsonSpy = vi.spyOn(request, "json");
    const { POST } = await import("../versions/route");
    const response = await POST(request, versionsParams);

    expect(response.status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  test("rejects a non-owner before any version query", async () => {
    h.access = {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
    const { GET } = await import("../versions/route");
    const response = await GET(
      new Request("http://localhost/api/bids/7/spec-evidence/versions"),
      versionsParams,
    );

    expect(response.status).toBe(403);
    expect(h.specFindMany).not.toHaveBeenCalled();
    expect(h.addendumFindMany).not.toHaveBeenCalled();
  });

  test("scopes citation lookup by child id and parent bid, cloaking substitution as 404", async () => {
    const { GET } = await import("../citations/[citationId]/route");
    const response = await GET(
      new Request("http://localhost/api/bids/7/spec-evidence/citations/91"),
      { params: Promise.resolve({ id: "7", citationId: "91" }) },
    );

    expect(response.status).toBe(404);
    expect(h.citationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 91, bidId: 7 } }),
    );
  });

  test("passes the authorized actor and explicit addendum order to publication", async () => {
    const { POST } = await import("../versions/route");
    const response = await POST(
      new Request("http://localhost/api/bids/7/spec-evidence/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseSpecBookId: 4, addendumUploadIds: [9, 3] }),
      }),
      versionsParams,
    );

    expect(response.status).toBe(201);
    expect(h.publish).toHaveBeenCalledWith({
      bidId: 7,
      baseSpecBookId: 4,
      addendumUploadIds: [9, 3],
      actorUserId: "owner-1",
    });
  });
});
