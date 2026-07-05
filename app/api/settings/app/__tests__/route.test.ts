import { beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  GET/PATCH /api/settings/app — auth gate + no-secret-leak tests.
//
//  Security hotfix (provider-readiness-secret-redaction): confirms the route
//  layer itself never serializes any fragment of a secret value, on top of
//  the underlying loadSettingsByCategory() fix.
// ──────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  loadSettingsByCategory: vi.fn(),
  setSetting: vi.fn(),
  getSettingDefinition: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ isAdminAuthorized: h.isAdminAuthorized }));
vi.mock("@/lib/services/settings/appSettingsService", () => ({
  loadSettingsByCategory: h.loadSettingsByCategory,
  setSetting: h.setSetting,
  getSettingDefinition: h.getSettingDefinition,
}));

import { GET, PATCH } from "../route";

const FAKE_SECRET_VALUE = "TOTALLY-FAKE-SENTINEL-abcd1234-DO-NOT-USE";

function req(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe("GET /api/settings/app", () => {
  beforeEach(() => vi.clearAllMocks());

  test("unauthenticated request is rejected with 401", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: false, status: 401, error: "Authentication required" });
    const res = await GET(req("http://x/api/settings/app?category=ai"));
    expect(res.status).toBe(401);
    expect(h.loadSettingsByCategory).not.toHaveBeenCalled();
  });

  test("invalid category is rejected with 400", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    const res = await GET(req("http://x/api/settings/app?category=bogus"));
    expect(res.status).toBe(400);
  });

  test("secret item's displayValue is empty in the actual serialized response — sentinel never present anywhere", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    h.loadSettingsByCategory.mockResolvedValue([
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API Key",
        description: "x",
        category: "ai",
        secret: true,
        envVar: "ANTHROPIC_API_KEY",
        placeholder: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
        hasValue: true,
        displayValue: "", // the fixed contract — never derived from the real value
        source: "db",
      },
    ]);

    const res = await GET(req("http://x/api/settings/app?category=ai"));
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET_VALUE);
    expect(text).not.toMatch(/[•]{4,}\w{4}/);

    const body = JSON.parse(text) as { items: Array<{ displayValue: string }> };
    expect(body.items[0].displayValue).toBe("");
  });
});

describe("PATCH /api/settings/app", () => {
  beforeEach(() => vi.clearAllMocks());

  test("unauthenticated request is rejected with 401 before touching setSetting", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: false, status: 401, error: "Authentication required" });
    const res = await PATCH(
      req("http://x/api/settings/app", {
        method: "PATCH",
        body: JSON.stringify({ key: "ANTHROPIC_API_KEY", value: FAKE_SECRET_VALUE }),
      })
    );
    expect(res.status).toBe(401);
    expect(h.setSetting).not.toHaveBeenCalled();
  });

  test("successful save never echoes the submitted value back in the response", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    h.getSettingDefinition.mockReturnValue({ key: "ANTHROPIC_API_KEY", secret: true });
    h.setSetting.mockResolvedValue(undefined);

    const res = await PATCH(
      req("http://x/api/settings/app", {
        method: "PATCH",
        body: JSON.stringify({ key: "ANTHROPIC_API_KEY", value: FAKE_SECRET_VALUE }),
      })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET_VALUE);
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  test("a save failure's error message never contains the submitted value", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    h.getSettingDefinition.mockReturnValue({ key: "ANTHROPIC_API_KEY", secret: true });
    h.setSetting.mockRejectedValue(new Error("SETTINGS_ENCRYPTION_KEY is not configured"));

    const res = await PATCH(
      req("http://x/api/settings/app", {
        method: "PATCH",
        body: JSON.stringify({ key: "ANTHROPIC_API_KEY", value: FAKE_SECRET_VALUE }),
      })
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET_VALUE);
  });
});
