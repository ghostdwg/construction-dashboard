import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline, mock-only tests for the N3 Option-A credential migration of
// organizeSubmittalsWithAi (docs/architecture/adr/0001-ai-credential-resolution.md).
//
// Before this migration the function read `process.env.ANTHROPIC_API_KEY`
// directly and built its own `new Anthropic()` client, bypassing both the
// getSetting() DB-first/env-fallback resolver and the sanctioned gateway.ts
// relay. These tests prove the migrated call: (1) resolves the credential
// exclusively via getSetting(), (2) forwards it verbatim to gateway.ts's
// createMessage(), (3) never leaks it anywhere else, and (4) fails closed
// with a controlled error when no credential is configured — all without
// any real Prisma/DB/network/provider call.

const SENTINEL = "sk-test-sentinel-do-not-use-12345";

const VALID_TABLE = [
  "| Package ID | Trade | Package Name | Description | Type | Priority | Release Phase | Spec Refs |",
  "|---|---|---|---|---|---|---|---|",
  "| PKG-HVAC-01 | HVAC | HVAC Equipment Package | Test submittal package | Product Data | High | Preconstruction | 23 00 00 |",
].join("\n");

const h = vi.hoisted(() => ({
  findManyItems: vi.fn(),
  findManySpecSections: vi.fn(),
  deleteManyItems: vi.fn(),
  findManyPackages: vi.fn(),
  deleteManyPackages: vi.fn(),
  createPackage: vi.fn(),
  createManyItems: vi.fn(),
  getSetting: vi.fn(),
  createMessage: vi.fn(),
  getMaxTokens: vi.fn(),
  logAiUsage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    submittalItem: {
      findMany: h.findManyItems,
      deleteMany: h.deleteManyItems,
      createMany: h.createManyItems,
    },
    specSection: {
      findMany: h.findManySpecSections,
    },
    submittalPackage: {
      findMany: h.findManyPackages,
      deleteMany: h.deleteManyPackages,
      create: h.createPackage,
    },
  },
}));
vi.mock("@/lib/services/settings/appSettingsService", () => ({ getSetting: h.getSetting }));
vi.mock("@/lib/services/ai/gateway", () => ({ createMessage: h.createMessage }));
vi.mock("@/lib/services/ai/aiTokenConfig", () => ({ getMaxTokens: h.getMaxTokens }));
vi.mock("@/lib/services/ai/aiUsageLog", () => ({
  logAiUsage: h.logAiUsage,
  computeCallCost: vi.fn(() => 0.01),
  classifyAiFailure: vi.fn(() => "unknown"),
}));

import { organizeSubmittalsWithAi } from "../organizeWithAi";

function fakeRawMessage(text: string, input = 100, output = 50) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: input, output_tokens: output },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findManyItems.mockResolvedValue([
    {
      id: 1,
      bidId: 1,
      title: "Test Submittal",
      description: "A test item",
      type: "OTHER",
      specSection: { csiNumber: "23 00 00", csiTitle: "HVAC" },
    },
  ]);
  h.findManySpecSections.mockResolvedValue([{ id: 5, csiNumber: "23 00 00" }]);
  h.deleteManyItems.mockResolvedValue({ count: 1 });
  h.findManyPackages.mockResolvedValue([]);
  h.deleteManyPackages.mockResolvedValue({});
  h.createPackage.mockResolvedValue({ id: 10 });
  h.createManyItems.mockResolvedValue({});
  h.getMaxTokens.mockResolvedValue(4096);
  h.logAiUsage.mockResolvedValue(undefined);
});

describe("organizeSubmittalsWithAi — N3 Option-A credential migration", () => {
  it("1. sentinel credential resolved via getSetting() traverses verbatim into gateway.createMessage's apiKey", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    h.createMessage.mockResolvedValue({ raw: fakeRawMessage(VALID_TABLE) });

    await organizeSubmittalsWithAi(1);

    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(h.createMessage).toHaveBeenCalledTimes(1);
    const call = h.createMessage.mock.calls[0][0];
    expect(call.apiKey).toBe(SENTINEL);
    // Never passes a `client` override in production — the real-vs-stub
    // detection signal (req.client ?? new Anthropic(...)) inside gateway.ts
    // is untouched by this migration; this call always takes the "real"
    // branch exactly as the pre-migration `new Anthropic()` call always did.
    expect(call.client).toBeUndefined();
  });

  it("2. sentinel never leaks into the returned result, prisma writes, logAiUsage, thrown errors, or console output", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    h.createMessage.mockResolvedValue({ raw: fakeRawMessage(VALID_TABLE) });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let thrown: unknown = null;
    let result: Awaited<ReturnType<typeof organizeSubmittalsWithAi>> | null = null;
    try {
      result = await organizeSubmittalsWithAi(1);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(JSON.stringify(result)).not.toContain(SENTINEL);

    // No Prisma write call anywhere received the sentinel value.
    const allPrismaCalls = [
      ...h.createPackage.mock.calls,
      ...h.createManyItems.mock.calls,
      ...h.deleteManyItems.mock.calls,
      ...h.deleteManyPackages.mock.calls,
      ...h.findManyPackages.mock.calls,
      ...h.findManySpecSections.mock.calls,
      ...h.findManyItems.mock.calls,
    ];
    expect(JSON.stringify(allPrismaCalls)).not.toContain(SENTINEL);

    // logAiUsage (persistence) never received the credential.
    expect(JSON.stringify(h.logAiUsage.mock.calls)).not.toContain(SENTINEL);

    // Nothing printed the credential to stdout/stderr.
    for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(SENTINEL);
    }

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("3. fails closed with a controlled, typed error when getSetting() resolves to null — never calls the gateway", async () => {
    h.getSetting.mockResolvedValue(null);

    await expect(organizeSubmittalsWithAi(1)).rejects.toThrow(
      /ANTHROPIC_API_KEY is not set/
    );
    expect(h.createMessage).not.toHaveBeenCalled();
  });

  it("4. stub-mode / real-call signal is unaffected: createMessage is invoked with no client override (same as pre-migration always-real behavior)", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    h.createMessage.mockResolvedValue({ raw: fakeRawMessage(VALID_TABLE) });

    await organizeSubmittalsWithAi(1);

    const call = h.createMessage.mock.calls[0][0];
    expect("client" in call).toBe(false);
  });
});
