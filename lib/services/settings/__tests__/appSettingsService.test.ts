import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  Security hotfix (provider-readiness-secret-redaction) — proves the fixed
//  loadSettingsByCategory() never returns any fragment of a secret's real
//  value (previously it leaked the last 4 characters via maskSecret()).
// ──────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findMany: h.findMany,
      update: h.update,
    },
  },
}));

import {
  loadSettingsByCategory,
  clearAppSettingsCache,
} from "../appSettingsService";

// Deliberately NOT shaped like a real Anthropic key (no "sk-ant-" prefix) —
// a fake, obviously-sentinel value used only to prove it never leaks.
const FAKE_DB_KEY_VALUE = "TOTALLY-FAKE-SENTINEL-VALUE-DO-NOT-USE-abcd1234wxyz";
const FAKE_ENV_KEY_VALUE = "TOTALLY-FAKE-ENV-SENTINEL-VALUE-DO-NOT-USE-9876zyxw";

function assertNoLeakage(payload: unknown, sentinel: string) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain(sentinel);
  // Also assert no trailing-4-chars fragment (the old maskSecret() bug shape)
  // ever appears, even partially, alongside a bullet run.
  expect(serialized).not.toMatch(/[•]{4,}\w{4}/);
}

describe("loadSettingsByCategory — secret redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAppSettingsCache();
    h.update.mockResolvedValue({});
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    clearAppSettingsCache();
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("DB-sourced secret: displayValue is always empty, sentinel never present anywhere in the result", async () => {
    h.findMany.mockResolvedValue([{ key: "ANTHROPIC_API_KEY", value: FAKE_DB_KEY_VALUE }]);

    const items = await loadSettingsByCategory("ai");
    const item = items.find((i) => i.key === "ANTHROPIC_API_KEY");

    expect(item).toBeDefined();
    expect(item!.secret).toBe(true);
    expect(item!.hasValue).toBe(true);
    expect(item!.source).toBe("db");
    expect(item!.displayValue).toBe("");
    assertNoLeakage(items, FAKE_DB_KEY_VALUE);
  });

  test("env-sourced secret: displayValue is always empty, sentinel never present anywhere in the result", async () => {
    h.findMany.mockResolvedValue([]);
    process.env.ANTHROPIC_API_KEY = FAKE_ENV_KEY_VALUE;

    const items = await loadSettingsByCategory("ai");
    const item = items.find((i) => i.key === "ANTHROPIC_API_KEY");

    expect(item).toBeDefined();
    expect(item!.hasValue).toBe(true);
    expect(item!.source).toBe("env");
    expect(item!.displayValue).toBe("");
    assertNoLeakage(items, FAKE_ENV_KEY_VALUE);
  });

  test("missing secret: hasValue=false, source='missing', displayValue empty", async () => {
    h.findMany.mockResolvedValue([]);

    const items = await loadSettingsByCategory("ai");
    const item = items.find((i) => i.key === "ANTHROPIC_API_KEY");

    expect(item).toBeDefined();
    expect(item!.hasValue).toBe(false);
    expect(item!.source).toBe("missing");
    expect(item!.displayValue).toBe("");
  });

  test("non-secret settings still show their real (non-sensitive) value — redaction only applies to secret: true", async () => {
    h.findMany.mockResolvedValue([{ key: "RESEND_FROM_EMAIL", value: "hello@example.com" }]);

    const items = await loadSettingsByCategory("email");
    const item = items.find((i) => i.key === "RESEND_FROM_EMAIL");

    expect(item).toBeDefined();
    expect(item!.secret).toBe(false);
    expect(item!.displayValue).toBe("hello@example.com");
  });

  test("maskSecret is no longer exported — the vulnerable helper was removed, not neutered", async () => {
    const mod = await import("../appSettingsService");
    expect((mod as Record<string, unknown>).maskSecret).toBeUndefined();
  });
});
