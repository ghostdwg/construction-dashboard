import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireBidAccess: vi.fn(),
  triggerSpecAnalysis: vi.fn(),
  backgroundJobFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: h.requireBidAccess,
}));

vi.mock("@/lib/services/jobs/specAnalysisAutomation", () => ({
  triggerSpecAnalysis: h.triggerSpecAnalysis,
  TriggerError: class TriggerError extends Error {
    constructor(readonly httpStatus: number, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backgroundJob: { findFirst: h.backgroundJobFindFirst },
  },
}));

import { GET, POST } from "../route";

const routeParams = { params: Promise.resolve({ id: "17" }) };

describe("Spec analysis authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireBidAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner", role: "pm" },
    });
    h.triggerSpecAnalysis.mockResolvedValue({
      status: "triggered",
      jobId: "sidecar-job",
      backgroundJobId: 22,
      specBookId: 33,
    });
    h.backgroundJobFindFirst.mockResolvedValue({ id: "db-job" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("anonymous POST is rejected before body parsing or background-job creation", async () => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    const json = vi.fn();

    const response = await POST({ json } as unknown as Request, routeParams);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(h.triggerSpecAnalysis).not.toHaveBeenCalled();
  });

  test("authenticated caller without parent Bid access is rejected before job creation", async () => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await POST(
      new Request("http://localhost/api/bids/17/specbook/analyze", {
        method: "POST",
        body: JSON.stringify({ tier: 3 }),
      }),
      routeParams,
    );

    expect(response.status).toBe(403);
    expect(h.triggerSpecAnalysis).not.toHaveBeenCalled();
  });

  test("anonymous progress read is rejected before the sidecar request", async () => {
    h.requireBidAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/bids/17/specbook/analyze?jobId=foreign-job"),
      routeParams,
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("cross-bid progress job substitution returns 404 before the sidecar request", async () => {
    h.backgroundJobFindFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/bids/17/specbook/analyze?jobId=foreign-job"),
      routeParams,
    );

    expect(response.status).toBe(404);
    expect(h.backgroundJobFindFirst).toHaveBeenCalledWith({
      where: {
        externalJobId: "foreign-job",
        bidId: 17,
        jobType: "spec_analysis",
      },
      select: { id: true },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("authorized POST preserves the existing trigger response", async () => {
    const response = await POST(
      new Request("http://localhost/api/bids/17/specbook/analyze", {
        method: "POST",
        body: JSON.stringify({ tier: 3 }),
      }),
      routeParams,
    );

    expect(response.status).toBe(200);
    expect(h.triggerSpecAnalysis).toHaveBeenCalledWith(17, {
      tier: 3,
      triggerSource: "user",
    });
    await expect(response.json()).resolves.toEqual({
      jobId: "sidecar-job",
      backgroundJobId: 22,
      specBookId: 33,
      status: "processing",
    });
  });
});
