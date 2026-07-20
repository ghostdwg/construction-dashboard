import { beforeEach, describe, expect, test, vi } from "vitest";

type SessionUser = {
  id: string;
  role: string;
  email: string;
};

const h = vi.hoisted(() => ({
  session: { current: null as { user: SessionUser } | null },
  auth: vi.fn(),
  create: vi.fn(),
  processNewMarketLead: vi.fn(),
  fireAndForgetIngest: vi.fn(),
}));

// Keep session resolution and the estimator/admin policy real. Only the
// Auth.js boundary is replaced, matching the promotion service test posture.
vi.mock("@/lib/auth", () => ({ auth: h.auth }));

vi.mock("@/lib/prisma", () => ({
  prisma: { marketLead: { create: h.create } },
}));

vi.mock("@/lib/services/liveIngestion", () => ({
  processNewMarketLead: h.processNewMarketLead,
  fireAndForgetIngest: h.fireAndForgetIngest,
}));

import * as route from "../route";

const ESTIMATOR: SessionUser = {
  id: "user_estimator",
  role: "estimator",
  email: "estimator@example.com",
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/market-intelligence/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function malformedRequest(): Request {
  return new Request("http://localhost/api/market-intelligence/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_DISABLED = "false";
  h.session.current = { user: ESTIMATOR };
  h.auth.mockImplementation(async () => h.session.current);
  h.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "lead_1",
    status: "NEW",
    confidence: "MEDIUM",
    promotedToBidId: null,
    ...data,
  }));
  h.processNewMarketLead.mockResolvedValue({ ok: true });
});

describe("POST /api/market-intelligence/leads — authentication and authorization", () => {
  test("anonymous requests return 401 before any MarketLead write", async () => {
    h.session.current = null;

    const response = await route.POST(request({ title: "Private lead" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.processNewMarketLead).not.toHaveBeenCalled();
    expect(h.fireAndForgetIngest).not.toHaveBeenCalled();
  });

  test("malformed JSON is authenticated before it is parsed", async () => {
    h.session.current = null;

    const response = await route.POST(malformedRequest());

    expect(response.status).toBe(401);
    expect(h.create).not.toHaveBeenCalled();
  });

  test("authenticated PMs return 403 before parsing or writing", async () => {
    h.session.current = {
      user: { id: "user_pm", role: "pm", email: "pm@example.com" },
    };

    const response = await route.POST(malformedRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.processNewMarketLead).not.toHaveBeenCalled();
  });
});

describe("POST /api/market-intelligence/leads — authorized creation", () => {
  test("an estimator can create a manual lead", async () => {
    const response = await route.POST(request({
      title: "  Riverside Medical Office  ",
      leadType: "MANUAL",
      estimatedValue: "8400000",
      location: "Tulsa, OK",
    }));

    expect(response.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith({
      data: {
        title: "Riverside Medical Office",
        leadType: "MANUAL",
        source: null,
        sourceUrl: null,
        location: "Tulsa, OK",
        jurisdiction: null,
        projectType: null,
        estimatedValue: 8_400_000,
        notes: null,
      },
    });
  });

  test("actor identity is derived from the session and protected fields are ignored", async () => {
    await route.POST(request({
      title: "Legitimate lead",
      actor: { userId: "spoofed_actor", email: "spoofed@example.com" },
      createdById: "spoofed_creator",
      promotedToBidId: 991,
      promotedAt: "2026-07-20T00:00:00.000Z",
      status: "PROMOTED",
      confidence: "HIGH",
      aiScore: 100,
      sourceDocId: "private_doc",
      detectedAt: "2020-01-01T00:00:00.000Z",
      rawText: "system-only raw text",
      aiSummary: "system-only summary",
      aiInsights: "system-only insights",
    }));

    const createData = h.create.mock.calls[0][0].data;
    expect(createData).not.toHaveProperty("actor");
    expect(createData).not.toHaveProperty("createdById");
    expect(createData).not.toHaveProperty("promotedToBidId");
    expect(createData).not.toHaveProperty("promotedAt");
    expect(createData).not.toHaveProperty("status");
    expect(createData).not.toHaveProperty("confidence");
    expect(createData).not.toHaveProperty("aiScore");
    expect(createData).not.toHaveProperty("sourceDocId");
    expect(createData).not.toHaveProperty("detectedAt");
    expect(createData).not.toHaveProperty("rawText");
    expect(createData).not.toHaveProperty("aiSummary");
    expect(createData).not.toHaveProperty("aiInsights");

    expect(h.processNewMarketLead).toHaveBeenCalledWith("lead_1", {
      actor: {
        userId: ESTIMATOR.id,
        email: ESTIMATOR.email,
      },
    });
  });

  test("validation failures neither write nor echo protected input", async () => {
    const response = await route.POST(request({
      title: "",
      promotedToBidId: 991,
      sourceDocId: "private_doc_identifier",
    }));
    const raw = await response.text();

    expect(response.status).toBe(400);
    expect(raw).toBe('{"error":"title is required"}');
    expect(raw).not.toContain("991");
    expect(raw).not.toContain("private_doc_identifier");
    expect(h.create).not.toHaveBeenCalled();
  });

  test("malformed JSON fails validation without writing", async () => {
    const response = await route.POST(malformedRequest());

    expect(response.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/market-intelligence/leads", () => {
  test("remains unimplemented so the route stays POST-only", () => {
    expect(route).not.toHaveProperty("GET");
  });
});
