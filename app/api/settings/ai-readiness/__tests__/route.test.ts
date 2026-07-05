import { beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  GET /api/settings/ai-readiness — auth gate + response-shape smoke test.
//
//  Mirrors the existing isAdminAuthorized() convention used by sibling
//  settings routes (e.g. /api/settings/ai-usage, /api/settings/ai-forecast):
//  unauthenticated -> 401, authenticated-non-admin -> 403, admin -> 200.
// ──────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  getProviderReadiness: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ isAdminAuthorized: h.isAdminAuthorized }));
vi.mock("@/lib/services/ai/providerReadiness", () => ({
  getProviderReadiness: h.getProviderReadiness,
}));

import { GET } from "../route";

describe("GET /api/settings/ai-readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("unauthenticated request is rejected with 401, using the existing protection convention", async () => {
    h.isAdminAuthorized.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Authentication required",
    });

    const res = await GET();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
    // The service must never even be invoked for an unauthorized caller.
    expect(h.getProviderReadiness).not.toHaveBeenCalled();
  });

  test("authenticated non-admin request is rejected with 403", async () => {
    h.isAdminAuthorized.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Admin access required",
    });

    const res = await GET();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Admin access required" });
    expect(h.getProviderReadiness).not.toHaveBeenCalled();
  });

  test("admin request returns 200 with the readiness payload, untouched", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    const fakeReadiness = {
      credentialConfigured: true,
      credentialSource: "database" as const,
      stubMode: {
        centrallyToggleable: false as const,
        note: "no central toggle",
        activeFlags: { BRIEF_STUB_MODE: false, GAP_STUB_MODE: false, ADDENDUM_STUB_MODE: false },
      },
      usageEvidence: { observed: true, totalCount: 2, mostRecent: { createdAt: "2026-07-01T00:00:00.000Z", model: "claude-sonnet-4-6" } },
      // Updated for Work Package "provider-invocation-evidence": the
      // permanent "NOT_VERIFIED" literal no longer exists — this route is a
      // pure pass-through of whatever getProviderReadiness() returns, so any
      // of the 5 real states exercises the same pass-through behavior.
      liveProviderVerification: "LAST_REAL_SUCCESS" as const,
    };
    h.getProviderReadiness.mockResolvedValue(fakeReadiness);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeReadiness);
    expect(body.liveProviderVerification).toBe("LAST_REAL_SUCCESS");
  });
});
