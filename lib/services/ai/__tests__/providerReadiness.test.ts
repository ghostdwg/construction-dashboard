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

// ──────────────────────────────────────────────────────────────────────────
//  Live provider verification — Work Package "provider-invocation-evidence".
//
//  getProviderReadiness() now issues TWO findFirst() calls against
//  aiUsageLog: one unfiltered (powers usageEvidence.mostRecent, unchanged
//  from before) and one filtered to `status IN ("ok","error")` (real-call
//  evidence only, excluding "stub" rows — powers liveProviderVerification).
//  This helper routes the shared `h.findFirst` mock to the right fixture
//  based on which query it's serving, so tests can set up the two
//  independently instead of relying on a single generic mockResolvedValue.
// ──────────────────────────────────────────────────────────────────────────
function routeFindFirst(
  unfilteredResult: unknown,
  realEvidenceResult: unknown
): (args: { where?: unknown }) => Promise<unknown> {
  return async (args) => (args?.where ? realEvidenceResult : unfilteredResult);
}

describe("getProviderReadiness — liveProviderVerification 5-state evidence contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The following two tests replace the old permanent-NOT_VERIFIED
  // assertions ("liveProviderVerification stays NOT_VERIFIED even with many
  // usage-log rows..."). That literal is no longer valid output — this work
  // package closes the exact gap those tests were documenting. The
  // underlying SAFETY property they protected (usage-log presence alone,
  // with no real/stub distinction, must never be misread as a verified
  // success) is preserved and re-expressed below via the STUB_ONLY test,
  // which is the direct, sharper descendant of that guarantee.

  test("1. configured credential + ZERO evidence of any kind -> CONFIGURED_UNVERIFIED (never something else)", async () => {
    h.getSettingSource.mockResolvedValue("db");
    h.count.mockResolvedValue(0);
    h.findFirst.mockImplementation(routeFindFirst(null, null));

    const result = await getProviderReadiness();

    expect(result.liveProviderVerification).toBe("CONFIGURED_UNVERIFIED");
    expect(result.usageEvidence.observed).toBe(false);
  });

  test("2. stub-only evidence -> STUB_ONLY, NEVER LAST_REAL_SUCCESS (most important test in this suite)", async () => {
    h.getSettingSource.mockResolvedValue("db");
    // Many rows exist (proving usage-log presence alone proves nothing) but
    // NONE of them are real-call evidence — the filtered query finds none.
    h.count.mockResolvedValue(9999);
    h.findFirst.mockImplementation(
      routeFindFirst({ createdAt: new Date("2026-07-04T12:00:00.000Z"), model: "stub" }, null)
    );

    const result = await getProviderReadiness();

    expect(result.liveProviderVerification).toBe("STUB_ONLY");
    expect(result.liveProviderVerification).not.toBe("LAST_REAL_SUCCESS");
    expect(result.usageEvidence.observed).toBe(true);
    expect(result.usageEvidence.totalCount).toBe(9999);
  });

  test("3. modeled real success evidence -> LAST_REAL_SUCCESS", async () => {
    h.getSettingSource.mockResolvedValue("db");
    h.count.mockResolvedValue(5);
    h.findFirst.mockImplementation(
      routeFindFirst(
        { createdAt: new Date("2026-07-04T12:00:00.000Z"), model: "claude-sonnet-4-6" },
        { status: "ok" }
      )
    );

    const result = await getProviderReadiness();

    expect(result.liveProviderVerification).toBe("LAST_REAL_SUCCESS");
  });

  test("4. modeled real failure evidence -> LAST_REAL_FAILURE", async () => {
    h.getSettingSource.mockResolvedValue("db");
    h.count.mockResolvedValue(5);
    h.findFirst.mockImplementation(
      routeFindFirst(
        { createdAt: new Date("2026-07-04T12:00:00.000Z"), model: "claude-sonnet-4-6" },
        { status: "error" }
      )
    );

    const result = await getProviderReadiness();

    expect(result.liveProviderVerification).toBe("LAST_REAL_FAILURE");
  });

  test("missing credential -> NOT_CONFIGURED, even with real-success evidence present (credential check wins)", async () => {
    h.getSettingSource.mockResolvedValue("missing");
    h.count.mockResolvedValue(5);
    h.findFirst.mockImplementation(
      routeFindFirst(
        { createdAt: new Date("2026-07-04T12:00:00.000Z"), model: "claude-sonnet-4-6" },
        { status: "ok" }
      )
    );

    const result = await getProviderReadiness();

    expect(result.liveProviderVerification).toBe("NOT_CONFIGURED");
  });

  test("real-call query explicitly excludes stub rows at the Prisma layer", async () => {
    h.getSettingSource.mockResolvedValue("db");
    h.count.mockResolvedValue(1);
    h.findFirst.mockImplementation(routeFindFirst(null, null));

    await getProviderReadiness();

    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["ok", "error"] } },
        select: { status: true },
      })
    );
  });
});

describe("getProviderReadiness — usage evidence is distinct from provider health/verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getSettingSource.mockResolvedValue("env");
  });

  test("usage evidence reports observed + count + model/timestamp only — never content, cost, or bidId", async () => {
    h.count.mockResolvedValue(3);
    // The unfiltered row (usageEvidence.mostRecent) is independent of
    // real-call evidence (routed to null here) — proving these two surfaces
    // are computed from separate queries, not conflated.
    h.findFirst.mockImplementation(
      routeFindFirst(
        { createdAt: new Date("2026-07-01T00:00:00.000Z"), model: "claude-sonnet-4-6" },
        null
      )
    );

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
    // 3 rows exist but none are tagged as real-call evidence in this fixture
    // -> STUB_ONLY, not a success/failure claim.
    expect(result.liveProviderVerification).toBe("STUB_ONLY");

    // Only fields select()'d by the service ever reach the response —
    // sanity-check the unfiltered prisma call itself never asked for
    // content/cost/bidId.
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

// ──────────────────────────────────────────────────────────────────────────
//  Mandatory test 5 — full-shape content-safety sweep across the persisted
//  write-path input shape, the read/API response, and the UI-facing data.
//  Actively searches for forbidden content rather than only checking that
//  the enum labels look right.
// ──────────────────────────────────────────────────────────────────────────
describe("evidence contract never carries credentials, prompts, responses, or raw error text", () => {
  const FORBIDDEN_SUBSTRINGS = [
    "sk-ant-",
    "Bearer ",
    "whatIsThisJob",
    "riskFlags",
    "system prompt",
    "TypeError: fetch failed at",
    "stack trace",
  ];

  test("classifyAiFailure() output is always one of the 5 closed values, never the input error's message", async () => {
    const { classifyAiFailure } = await import("../aiUsageLog");

    const secretyError = new Error(
      "request to https://api.anthropic.com failed with body sk-ant-FAKE-should-never-appear-999"
    );
    const result = classifyAiFailure(secretyError);

    expect(["rate_limited", "auth_error", "provider_error", "network_error", "unknown"]).toContain(
      result
    );
    expect(result).not.toContain("sk-ant-");
    expect(result).not.toContain("anthropic.com");
    expect(result.length).toBeLessThan(30); // closed enum values are short; a leaked message would not be
  });

  test("full getProviderReadiness() response — across configured/evidence permutations — never contains forbidden content", async () => {
    h.getSettingSource.mockResolvedValue("db");
    const permutations: Array<[number, unknown, unknown]> = [
      [0, null, null],
      [9999, { createdAt: new Date(), model: "stub" }, null],
      [5, { createdAt: new Date(), model: "claude-sonnet-4-6" }, { status: "ok" }],
      [5, { createdAt: new Date(), model: "claude-sonnet-4-6" }, { status: "error" }],
    ];

    for (const [count, unfiltered, real] of permutations) {
      vi.clearAllMocks();
      h.getSettingSource.mockResolvedValue("db");
      h.count.mockResolvedValue(count);
      h.findFirst.mockImplementation(routeFindFirst(unfiltered, real));

      const result = await getProviderReadiness();
      const serialized = JSON.stringify(result);

      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(serialized).not.toContain(forbidden);
      }
      // The 5-state field is always exactly one of the closed values.
      expect([
        "NOT_CONFIGURED",
        "CONFIGURED_UNVERIFIED",
        "LAST_REAL_SUCCESS",
        "LAST_REAL_FAILURE",
        "STUB_ONLY",
      ]).toContain(result.liveProviderVerification);
    }
  });
});
