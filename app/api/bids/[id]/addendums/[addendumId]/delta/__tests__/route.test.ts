import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline, mock-only fidelity test for the migrated addendum-delta route (P1B-3A).
// All dependencies (prisma, gateway, prompt assembly, token config, usage log,
// settings) are mocked — no network, no DB, no real provider. The tests drive the
// LIVE-mode path (ADDENDUM_STUB_MODE unset) and assert that routing the call
// through the transparent gateway preserves request/response/usage/parse/error
// semantics exactly.

const h = vi.hoisted(() => ({
  addendumFindUnique: vi.fn(),
  briefFindUnique: vi.fn(),
  addendumFindMany: vi.fn(),
  bidFindUnique: vi.fn(),
  addendumUpdate: vi.fn(),
  briefUpdate: vi.fn(),
  createMessage: vi.fn(),
  assemblePrompt: vi.fn(),
  getMaxTokens: vi.fn(),
  logAiUsage: vi.fn(),
  classifyAiFailure: vi.fn(() => "unknown"),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    addendumUpload: {
      findUnique: h.addendumFindUnique,
      findMany: h.addendumFindMany,
      update: h.addendumUpdate,
    },
    bidIntelligenceBrief: {
      findUnique: h.briefFindUnique,
      update: h.briefUpdate,
    },
    bid: { findUnique: h.bidFindUnique },
  },
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({ ok: true, user: { id: "u1", role: "admin" } })),
}));
vi.mock("@/lib/services/ai/gateway", () => ({ createMessage: h.createMessage }));
vi.mock("@/lib/services/ai/assembleAddendumDeltaPrompt", () => ({
  assembleAddendumDeltaPrompt: h.assemblePrompt,
}));
vi.mock("@/lib/services/ai/aiTokenConfig", () => ({ getMaxTokens: h.getMaxTokens }));
vi.mock("@/lib/services/ai/aiUsageLog", () => ({
  logAiUsage: h.logAiUsage,
  classifyAiFailure: h.classifyAiFailure,
}));
vi.mock("@/lib/services/settings/appSettingsService", () => ({ getSetting: h.getSetting }));

import { POST } from "../route";

const VALID_DELTA = JSON.stringify({
  addendumNumber: 5,
  dateIssued: null,
  summary: "S",
  changesIdentified: 0,
  scopeChanges: [],
  clarifications: [],
  newRisks: [],
  resolvedItems: [],
  netCostDirection: "NEUTRAL",
  netScheduleDirection: "NEUTRAL",
  actionsRequired: [],
});

function callPost() {
  return POST({} as Request, {
    params: Promise.resolve({ id: "1", addendumId: "2" }),
  });
}

function gatewayReturns(text: string) {
  return {
    raw: {
      usage: { input_tokens: 11, output_tokens: 7 },
      content: [{ type: "text", text }],
    },
  };
}

describe("addendum-delta route — gateway migration fidelity (P1B-3A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADDENDUM_STUB_MODE; // force LIVE mode
    h.addendumFindUnique.mockResolvedValue({
      id: 2, bidId: 1, addendumNumber: 5, extractedText: "addendum text", status: "ready",
    });
    h.briefFindUnique.mockResolvedValue({
      id: 9, status: "ready", whatIsThisJob: "job", riskFlags: null, addendumDeltas: null,
    });
    h.addendumFindMany.mockResolvedValue([]);
    h.bidFindUnique.mockResolvedValue({ projectType: "commercial" });
    h.assemblePrompt.mockReturnValue({ systemPrompt: "SYS", userPrompt: "USER" });
    h.getSetting.mockResolvedValue("sk-key");
    h.getMaxTokens.mockResolvedValue(3000);
    h.logAiUsage.mockResolvedValue(undefined);
    h.addendumUpdate.mockResolvedValue({});
    h.briefUpdate.mockResolvedValue({});
    h.createMessage.mockResolvedValue(gatewayReturns(VALID_DELTA));
  });

  // 1 — exact request forwarding
  it("forwards the exact request to the gateway", async () => {
    await callPost();
    expect(h.createMessage).toHaveBeenCalledTimes(1);
    expect(h.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        maxTokens: 3000,
        system: "SYS",
        messages: [{ role: "user", content: "USER" }],
        apiKey: "sk-key",
      })
    );
  });

  // 2 — raw response + usage propagation unchanged
  it("propagates raw response usage verbatim into usage logging", async () => {
    await callPost();
    expect(h.logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        callKey: "addendum-delta",
        model: "claude-sonnet-4-6",
        inputTokens: 11,
        outputTokens: 7,
        bidId: 1,
      })
    );
  });

  // 3 — valid AddendumDelta parsing unchanged
  it("parses a valid AddendumDelta and returns it (200)", async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.addendumId).toBe(2);
    expect(body.delta.summary).toBe("S");
    expect(body.delta.netCostDirection).toBe("NEUTRAL");
    // Persisted verbatim from the parsed raw text.
    const stored = JSON.parse(h.addendumUpdate.mock.calls[0][0].data.deltaJson);
    expect(stored.summary).toBe("S");
  });

  // 4a — malformed (non-JSON) text → existing 500 parse-failure semantics
  it("returns 500 with the same parse-failure body on non-JSON output", async () => {
    h.createMessage.mockResolvedValue(gatewayReturns("not json at all"));
    const res = await callPost();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/^Failed to parse AI response as JSON:/);
    // No persistence occurred on the failure path.
    expect(h.addendumUpdate).not.toHaveBeenCalled();
    expect(h.briefUpdate).not.toHaveBeenCalled();
  });

  // 4b — malformed (no text block) → existing 500 no-text semantics
  it("returns 500 'no text content' when the response has no text block", async () => {
    h.createMessage.mockResolvedValue({
      raw: { usage: { input_tokens: 1, output_tokens: 1 }, content: [] },
    });
    const res = await callPost();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("AI returned no text content");
  });

  // 4c — provider/gateway throw → unchanged opaque propagation (no route try/catch)
  it("propagates a gateway error unchanged (opaque 500 behavior preserved)", async () => {
    const err = new Error("boom");
    h.createMessage.mockRejectedValue(err);
    await expect(callPost()).rejects.toBe(err);
  });
});
