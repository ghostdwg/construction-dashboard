import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "file:/tmp/gwx-env-auth-fence.db",
  DATABASE_AUTH_TOKEN: "",
  AUTH_DISABLED: "false",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  ANTHROPIC_API_KEY: "sk-ant-synthetic-test-key",
  SIDECAR_API_KEY: "",
  LEGACY_TRANSCRIPTION_ENABLED: "false",
  LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED: "false",
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

describe("legacy transcription deployment fence", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults both permissions off when they are absent", async () => {
    const envWithoutLegacyFlags = { ...validEnv } as Record<string, string>;
    delete envWithoutLegacyFlags.LEGACY_TRANSCRIPTION_ENABLED;
    delete envWithoutLegacyFlags.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED;
    vi.resetModules();
    for (const [key, value] of Object.entries(envWithoutLegacyFlags)) {
      vi.stubEnv(key, value);
    }
    delete process.env.LEGACY_TRANSCRIPTION_ENABLED;
    delete process.env.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED;

    const loaded = await import("../env");

    expect(loaded.env.LEGACY_TRANSCRIPTION_ENABLED).toBe("false");
    expect(loaded.env.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED).toBe("false");
  });

  it("rejects malformed permission values at startup", async () => {
    await expect(
      loadEnv({ LEGACY_TRANSCRIPTION_ENABLED: "TRUE" }),
    ).rejects.toThrow();
  });

  it("rejects external permission without the legacy gate", async () => {
    await expect(
      loadEnv({
        LEGACY_TRANSCRIPTION_ENABLED: "false",
        LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED: "true",
      }),
    ).rejects.toThrow(
      "LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED=true requires LEGACY_TRANSCRIPTION_ENABLED=true",
    );
  });
});
