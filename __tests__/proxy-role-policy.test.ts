import { beforeEach, describe, expect, test, vi } from "vitest";

type ProxyRequest = {
  auth: { user: { role?: unknown } } | null;
  nextUrl: URL;
};

type ProxyHandler = (request: ProxyRequest) => Response | Promise<Response>;

const h = vi.hoisted(() => ({
  handler: null as ProxyHandler | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn((handler: ProxyHandler) => {
    h.handler = handler;
    return handler;
  }),
}));
vi.mock("@/lib/env", () => ({ env: { APP_ENV: "local" } }));

import proxy from "../proxy";

function settingsRequest(role?: unknown): ProxyRequest {
  return {
    auth: { user: { role } },
    nextUrl: new URL("http://localhost/settings"),
  };
}

beforeEach(() => {
  process.env.AUTH_DISABLED = "false";
});

describe("proxy exact admin role policy", () => {
  test("allows exact lowercase admin to reach settings", async () => {
    const response = await (proxy as unknown as ProxyHandler)(settingsRequest("admin"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-app-env")).toBe("local");
  });

  test.each([
    "Admin",
    "ADMIN",
    " admin",
    "admin ",
    " admin ",
    "estimator",
    "pm",
    undefined,
    null,
    { role: "admin" },
    ["admin"],
    1,
    true,
  ])("redirects non-admin or noncanonical role %s away from settings", async (role) => {
    const response = await (proxy as unknown as ProxyHandler)(settingsRequest(role));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("x-app-env")).toBe("local");
  });
});
