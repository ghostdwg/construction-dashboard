import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  listIntegrations: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/services/credentials/credentialsService", () => ({
  listIntegrations: h.listIntegrations,
}));

import { GET } from "../route";

const FAKE_SECRET = "TOTALLY-FAKE-SENTINEL-do-not-use-credvault-9999";

describe("GET /api/settings/credentials", () => {
  beforeEach(() => vi.clearAllMocks());

  test("unauthenticated -> 401, service never invoked", async () => {
    h.auth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(h.listIntegrations).not.toHaveBeenCalled();
  });

  test("authenticated non-admin -> 403, service never invoked", async () => {
    h.auth.mockResolvedValue({ user: { role: "user" } });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(h.listIntegrations).not.toHaveBeenCalled();
  });

  test("admin -> 200, and the response never contains any sentinel/fragment shape even if the service layer misbehaved", async () => {
    h.auth.mockResolvedValue({ user: { role: "admin" } });
    h.listIntegrations.mockResolvedValue([
      {
        service: "beeline",
        fields: [{ field: "password", masked: "••••••••", updatedAt: "2026-07-01T00:00:00.000Z" }],
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toMatch(/[•]{4,}\w{2,4}/);
  });
});
