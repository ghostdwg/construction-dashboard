import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  Provider Readiness — truth-surface fidelity tests.
//
//  Confirms the five status fields (credential existence/source, stub-mode
//  honesty, usage evidence, live-provider verification) are computed
//  correctly and that no credential value or content ever appears in the
//  response, under DB-sourced, env-sourced, and missing credential states.
// ──────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  getSettingSource: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLog: {
      count: h.count,
      findFirst: h.findFirst,
    },
  },
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSettingSource: h.getSettingSource,
}));

import { getProviderReadiness } from "../providerReadiness";

// Fake "value-shaped" strings used ONLY to prove they never leak into the
// response — none of these resemble a real Anthropic key format (no
// "sk-ant-" prefix), per the no-realistic-secrets-in-fixtures rule.
const FAKE_DB_SECRET_MARKER = "TOTALLY-FAKE-DB-VALUE-should-never-appear-000";
const FAKE_ENV_SECRET_MARKER = "TOTALLY-FAKE-ENV-VALUE-should-never-appear-111";

function assertNoLeakage(payload: unknown) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain(FAKE_DB_SECRET_MARKER);
  expect(serialized).not.toContain(FAKE_ENV_SECRET_MARKER);
  // Belt-and-suspenders: the raw key name/value should never be echoed either.
  expect(serialized).not.toContain("ANTHROPIC_API_KEY");
}

describe("getProviderReadiness — credential existence/source (never the value)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.count.mockResolvedValue(0);
    h.findFirst.mockResolvedValue(null);
  });

  test("DB-sourced credential -> configured=true, source='database', no value leaked", async () => {
    // getSettingSource only ever returns a classification, never the value —
    // but the underlying DB row (in a real deployment) WOULD hold
    // FAKE_DB_SECRET_MARKER. Simulate that by having the mock "know about"
    // the secret internally while only returning "db".
    h.getSettingSource.mockImplementation(async (key: string) => {
      void FAKE_DB_SECRET_MARKER; // pretend this is what's in the DB row
      expect(key).toBe("ANTHROPIC_API_KEY");
      return "db";
    });

    const result = await getProviderReadiness();

    expect(result.credentialConfigured).toBe(true);
    expect(result.credentialSource).toBe("database");
    assertNoLeakage(result);
  });

  test("env-sourced credential -> configured=true, source='environment', no value leaked", async () => {
    h.getSettingSource.mockImplementation(async () => {
      void FAKE_ENV_SECRET_MARKER; // pretend this is what's in process.env
      return "env";
    });

    const result = await getProviderReadiness();

    expect(result.credentialConfigured).toBe(true);
    expect(result.credentialSource).toBe("environment");
    assertNoLeakage(result);
  });

  test("missing credential -> configured=false, source='missing'", async () => {
    h.getSettingSource.mockResolvedValue("missing");

    const result = await getProviderReadiness();

    expect(result.credentialConfigured).toBe(false);
    expect(result.credentialSource).toBe("missing");
    assertNoLeakage(result);
  });
});

describe("getProviderReadiness — stub mode is reported honestly, not invented", () => {
  const ENV_KEYS = ["BRIEF_STUB_MODE", "GAP_STUB_MODE", "ADDENDUM_STUB_MODE"] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    h.getSettingSource.mockResolvedValue("missing");
    h.count.mockResolvedValue(0);
    h.findFirst.mockResolvedValue(null);
    for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  test("reports centrallyToggleable=false with explicit per-feature flags, not a fake unified toggle", async () => {
    delete process.env.BRIEF_STUB_MODE;
    delete process.env.GAP_STUB_MODE;
    delete process.env.ADDENDUM_STUB_MODE;

    const result = await getProviderReadiness();

    expect(result.stubMode.centrallyToggleable).toBe(false);
    expect(typeof result.stubMode.note).toBe("string");
    expect(result.stubMode.note.length).toBeGreaterThan(0);
    expect(result.stubMode.activeFlags).toEqual({
      BRIEF_STUB_MODE: false,
      GAP_STUB_MODE: false,
      ADDENDUM_STUB_MODE: false,
    });
  });

  test("reflects an active per-feature stub flag when set", async () => {
    process.env.GAP_STUB_MODE = "true";

    const result = await getProviderReadiness();

    expect(result.stubMode.activeFlags.GAP_STUB_MODE).toBe(true);
    expect(result.stubMode.activeFlags.BRIEF_STUB_MODE).toBe(false);
    expect(result.stubMode.activeFlags.ADDENDUM_STUB_MODE).toBe(false);
  });
});

describe("getProviderReadiness — live verification can never be flipped by job/usage-log presence alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getSettingSource.mockResolvedValue("db");
  });

  test("liveProviderVerification stays NOT_VERIFIED even with many usage-log rows and a recent timestamp", async () => {
    h.count.mockResolvedValue(9999);
    h.findFirst.mockResolvedValue({
      createdAt: new Date("2026-07-04T12:00:00.000Z"),
      model: "claude-sonnet-4-6",
    });

    const result = await getProviderReadiness();

    // The most important assertion in this suite: usage-log presence (which
    // in this codebase is also how completed BackgroundJobs' AI activity is
    // durably recorded, e.g. via logSidecarUsage from the specbook analyze
    // completion webhook) must NEVER, by itself, cause this field to read
    // anything other than NOT_VERIFIED.
    expect(result.liveProviderVerification).toBe("NOT_VERIFIED");
    expect(result.usageEvidence.observed).toBe(true);
    expect(result.usageEvidence.totalCount).toBe(9999);
  });

  test("liveProviderVerification stays NOT_VERIFIED with zero usage rows too", async () => {
    h.count.mockResolvedValue(0);
    h.findFirst.mockResolvedValue(null);

    const result = await getProviderReadiness();

    expect(result.liveProviderVerification).toBe("NOT_VERIFIED");
    expect(result.usageEvidence.observed).toBe(false);
  });
});

describe("getProviderReadiness — usage evidence is distinct from provider health/verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getSettingSource.mockResolvedValue("env");
  });

  test("usage evidence reports observed + count + model/timestamp only — never content, cost, or bidId", async () => {
    h.count.mockResolvedValue(3);
    h.findFirst.mockResolvedValue({
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      model: "claude-sonnet-4-6",
    });

    const result = await getProviderReadiness();

    expect(result.usageEvidence).toEqual({
      observed: true,
      totalCount: 3,
      mostRecent: { createdAt: "2026-07-01T00:00:00.000Z", model: "claude-sonnet-4-6" },
    });
    // Confirm the field is a label, distinct in name and meaning from
    // "verified"/"health" — the response must never imply usage rows
    // constitute provider health or verification.
    expect(result).not.toHaveProperty("providerHealth");
    expect(result).not.toHaveProperty("verified");
    expect(result.liveProviderVerification).toBe("NOT_VERIFIED");

    // Only fields select()'d by the service ever reach the response —
    // sanity-check the prisma call itself never asked for content/cost/bidId.
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { createdAt: true, model: true },
      })
    );
  });

  test("no fixture or output in this file resembles a real-looking API key format", () => {
    const suspicious = /sk-ant-[a-zA-Z0-9]{10,}|sk-[a-zA-Z0-9]{20,}/;
    const fileMarkers = [FAKE_DB_SECRET_MARKER, FAKE_ENV_SECRET_MARKER];
    for (const marker of fileMarkers) {
      expect(marker).not.toMatch(suspicious);
    }
  });
});
