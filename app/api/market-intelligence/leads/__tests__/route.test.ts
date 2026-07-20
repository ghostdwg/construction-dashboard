import { beforeEach, describe, expect, test, vi } from "vitest";

type SessionUser = {
  id: string;
  role?: unknown;
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

function expectNoWrites() {
  expect(h.create).not.toHaveBeenCalled();
  expect(h.processNewMarketLead).not.toHaveBeenCalled();
  expect(h.fireAndForgetIngest).not.toHaveBeenCalled();
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
    const req = malformedRequest();
    const parse = vi.spyOn(req, "json");

    const response = await route.POST(req);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(parse).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test.each([
    ["a missing role", { id: "user_missing", email: "missing@example.com" }],
    [
      "an undefined role",
      { id: "user_undefined", role: undefined, email: "undefined@example.com" },
    ],
    ["a null role", { id: "user_null", role: null, email: "null@example.com" }],
    ["an empty role", { id: "user_empty", role: "", email: "empty@example.com" }],
    [
      "a whitespace-only role",
      { id: "user_space", role: "   ", email: "space@example.com" },
    ],
    ["Admin casing", { id: "user_Admin", role: "Admin", email: "Admin@example.com" }],
    ["ADMIN casing", { id: "user_ADMIN", role: "ADMIN", email: "ADMIN@example.com" }],
    [
      "Estimator casing",
      { id: "user_Estimator", role: "Estimator", email: "Estimator@example.com" },
    ],
    [
      "mixed estimator casing",
      { id: "user_mixed", role: "EsTiMaToR", email: "mixed@example.com" },
    ],
    [
      "leading whitespace",
      { id: "user_leading", role: " admin", email: "leading@example.com" },
    ],
    [
      "trailing whitespace",
      { id: "user_trailing", role: "admin ", email: "trailing@example.com" },
    ],
    [
      "surrounding whitespace",
      { id: "user_surrounding", role: " estimator ", email: "surrounding@example.com" },
    ],
    [
      "an unknown role",
      { id: "user_unknown", role: "superuser", email: "unknown@example.com" },
    ],
    [
      "an object role",
      { id: "user_object", role: { name: "admin" }, email: "object@example.com" },
    ],
    ["an array role", { id: "user_array", role: ["admin"], email: "array@example.com" }],
    ["a numeric role", { id: "user_number", role: 1, email: "number@example.com" }],
    ["a boolean role", { id: "user_boolean", role: true, email: "boolean@example.com" }],
    ["the PM role", { id: "user_pm", role: "pm", email: "pm@example.com" }],
    [
      "a project manager label",
      {
        id: "user_project_manager",
        role: "project manager",
        email: "project-manager@example.com",
      },
    ],
  ] satisfies Array<[string, SessionUser]>)(
    "authenticated session with %s returns 403 before parsing or writing",
    async (_label, user) => {
      h.session.current = { user };
      const req = malformedRequest();
      const parse = vi.spyOn(req, "json");

      const response = await route.POST(req);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
      expect(parse).not.toHaveBeenCalled();
      expectNoWrites();
    }
  );

  test("a caller-supplied admin role cannot override the session role", async () => {
    h.session.current = {
      user: { id: "user_pm", role: "pm", email: "pm@example.com" },
    };
    const req = request({ title: "Private lead", role: "admin" });
    const parse = vi.spyOn(req, "json");

    const response = await route.POST(req);

    expect(response.status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expectNoWrites();
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

  test("an admin can create a manual lead", async () => {
    h.session.current = {
      user: { id: "user_admin", role: "admin", email: "admin@example.com" },
    };

    const response = await route.POST(request({ title: "Admin lead" }));

    expect(response.status).toBe(201);
    expect(h.create).toHaveBeenCalledOnce();
  });

  test("actor identity is derived from the session and protected fields are ignored", async () => {
    await route.POST(request({
      title: "Legitimate lead",
      role: "admin",
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
    expect(createData).not.toHaveProperty("role");
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
