import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline, mock-only fidelity test for the migrated gap-analysis caller (P1B-2).
// All dependencies are mocked (no network, no DB, no real provider). Two trades
// are analyzed: the first returns valid JSON, the second returns non-JSON so the
// caller's existing per-trade `continue` path runs unchanged behind the gateway.

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  specCount: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  createMessage: vi.fn(),
  assembleGapPrompt: vi.fn(),
  getMaxTokens: vi.fn(),
  logAiUsage: vi.fn(),
  classifyAiFailure: vi.fn(() => "unknown"),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bidTrade: { findMany: h.findMany },
    specSection: { count: h.specCount },
    aiGapFinding: { deleteMany: h.deleteMany, create: h.create },
    $transaction: h.transaction,
  },
}));
vi.mock("@/lib/services/ai/gateway", () => ({ createMessage: h.createMessage }));
vi.mock("@/lib/services/ai/assembleGapPrompt", () => ({ assembleGapPrompt: h.assembleGapPrompt }));
vi.mock("@/lib/services/ai/aiTokenConfig", () => ({ getMaxTokens: h.getMaxTokens }));
vi.mock("@/lib/services/ai/aiUsageLog", () => ({
  logAiUsage: h.logAiUsage,
  classifyAiFailure: h.classifyAiFailure,
}));
vi.mock("@/lib/services/settings/appSettingsService", () => ({ getSetting: h.getSetting }));

import { runGapAnalysis } from "../runGapAnalysis";

const VALID = '[{"severity":"CRITICAL","title":"T1","description":"d","foundIn":"SPEC_BOOK"}]';

describe("runGapAnalysis — gateway migration fidelity (P1B-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GAP_STUB_MODE; // force LIVE mode
    h.getSetting.mockResolvedValue("sk-key");
    h.getMaxTokens.mockResolvedValue(4096);
    h.logAiUsage.mockResolvedValue(undefined);
    h.assembleGapPrompt.mockResolvedValue({
      systemPrompt: "SYS",
      userPrompt: "USER",
      estimateCount: 5,
    });
    h.findMany.mockResolvedValue([
      { trade: { id: 1, name: "Electrical" } },
      { trade: { id: 2, name: "Drywall" } },
    ]);
    h.deleteMany.mockResolvedValue({});
    h.create.mockReturnValue({});
    h.transaction.mockImplementation(async (ops: unknown[]) => ops);
    // Trade 1 → valid JSON array; Trade 2 → non-JSON (must be skipped via continue).
    h.createMessage
      .mockResolvedValueOnce({ raw: { usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: VALID }] } })
      .mockResolvedValueOnce({ raw: { usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "not json" }] } });
  });

  it("routes each trade through the gateway with identical request fields", async () => {
    await runGapAnalysis(1);

    expect(h.createMessage).toHaveBeenCalledTimes(2);
    expect(h.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        maxTokens: 4096,
        system: "SYS",
        messages: [{ role: "user", content: "USER" }],
        apiKey: "sk-key",
      })
    );
  });

  it("preserves per-trade continue: bad-JSON trade is skipped, good trade persists", async () => {
    const result = await runGapAnalysis(1);

    // Only the valid-JSON trade produced findings and was counted.
    expect(result).toEqual({ totalFindings: 1, tradesAnalyzed: 1 });
    // saveFindingsForTrade (deleteMany) reached exactly once — the bad trade
    // hit `continue` before any persistence.
    expect(h.deleteMany).toHaveBeenCalledTimes(1);
  });
});
