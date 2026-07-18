import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "file:/tmp/gwx-env-auth-fence.db",
  DATABASE_AUTH_TOKEN: "",
  AUTH_DISABLED: "false",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  ANTHROPIC_API_KEY: "sk-ant-synthetic-test-key",
  SIDECAR_API_KEY: "",
  NEXTAUTH_URL: "http://localhost:3000",
  ALLOW_PROD_DB: "",
} as const;

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...validEnv, ...overrides })) {
    vi.stubEnv(key, value);
  }
  return import("../env");
}

describe("AUTH_DISABLED deployment fence", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows the explicit solo-local bypass", async () => {
    const loaded = await loadEnv({ APP_ENV: "local", AUTH_DISABLED: "true" });
    expect(loaded.env.AUTH_DISABLED).toBe("true");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("rejects the bypass in staging at import/startup", async () => {
    await expect(
      loadEnv({ APP_ENV: "staging", AUTH_DISABLED: "true", SIDECAR_API_KEY: "synthetic" }),
    ).rejects.toThrow("AUTH_DISABLED=true is permitted only when APP_ENV=local");
  });

  it("rejects the bypass in production at import/startup", async () => {
    await expect(
      loadEnv({ APP_ENV: "production", AUTH_DISABLED: "true", SIDECAR_API_KEY: "synthetic" }),
    ).rejects.toThrow("AUTH_DISABLED=true is permitted only when APP_ENV=local");
  });

  it("allows authenticated shared-tier startup", async () => {
    const loaded = await loadEnv({
      APP_ENV: "staging",
      AUTH_DISABLED: "false",
      SIDECAR_API_KEY: "synthetic",
    });
    expect(loaded.env.APP_ENV).toBe("staging");
  });
});
