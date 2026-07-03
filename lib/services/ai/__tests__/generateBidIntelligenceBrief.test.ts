import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline, mock-only fidelity test for the migrated bid-brief caller (P1B-2).
// Every dependency (prisma, gateway, prompt assembly, token config, usage log,
// settings) is mocked, so no network, no DB, and no real provider are touched.
// The gateway is stubbed to return a *truncated* JSON body so the caller's
// existing repairTruncatedJson path runs unchanged behind the gateway.

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  createMessage: vi.fn(),
  assembleBriefPrompt: vi.fn(),
  getMaxTokens: vi.fn(),
  logAiUsage: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { bidIntelligenceBrief: { upsert: h.upsert, update: h.update } },
}));
vi.mock("../gateway", () => ({ createMessage: h.createMessage }));
vi.mock("../assembleBriefPrompt", () => ({ assembleBriefPrompt: h.assembleBriefPrompt }));
vi.mock("../aiTokenConfig", () => ({ getMaxTokens: h.getMaxTokens }));
vi.mock("../aiUsageLog", () => ({ logAiUsage: h.logAiUsage }));
vi.mock("@/lib/services/settings/appSettingsService", () => ({ getSetting: h.getSetting }));

import { generateBidIntelligenceBrief } from "../generateBidIntelligenceBrief";

// A body that JSON.parse cannot handle as-is (unterminated array) — repair
// closes the open container and yields { whatIsThisJob: "hello", riskFlags: [] }.
const TRUNCATED = '{"whatIsThisJob": "hello", "riskFlags": [';

describe("generateBidIntelligenceBrief — gateway migration fidelity (P1B-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BRIEF_STUB_MODE; // force LIVE mode
    h.getSetting.mockResolvedValue("sk-key");
    h.getMaxTokens.mockResolvedValue(4096);
    h.logAiUsage.mockResolvedValue(undefined);
    h.upsert.mockResolvedValue({});
    h.update.mockResolvedValue({});
    h.assembleBriefPrompt.mockResolvedValue({
      systemPrompt: "SYS",
      userPrompt: "USER",
      sourceContext: { addendumCount: 0 },
    });
    h.createMessage.mockResolvedValue({
      raw: {
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "text", text: TRUNCATED }],
      },
    });
  });

  it("routes the brief call through the gateway with identical request fields", async () => {
    await generateBidIntelligenceBrief(1, "manual");

    expect(h.createMessage).toHaveBeenCalledTimes(1);
    expect(h.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        maxTokens: 4096,
        system: "SYS",
        messages: [{ role: "user", content: "USER" }],
        apiKey: "sk-key",
      })
    );
  });

  it("passes P2-A0 shadow-scan audit metadata identifying the feature and bid id", async () => {
    await generateBidIntelligenceBrief(7, "manual");

    expect(h.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: { feature: "brief", bidId: "7" },
      })
    );
  });

  it("preserves repairTruncatedJson: truncated body is repaired and persisted", async () => {
    await generateBidIntelligenceBrief(1, "manual");

    // Usage is logged from the raw gateway response, verbatim.
    expect(h.logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 10, outputTokens: 5 })
    );

    // Final "ready" upsert carries the repaired, parsed field.
    const lastUpsert = h.upsert.mock.calls[h.upsert.mock.calls.length - 1][0];
    expect(lastUpsert.create.whatIsThisJob).toBe("hello");
    expect(lastUpsert.update.status).toBe("ready");
  });
});
