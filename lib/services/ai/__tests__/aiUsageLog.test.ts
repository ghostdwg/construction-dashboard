import { describe, it, expect, vi, beforeEach } from "vitest";

// Work Package N5 — Sidecar AI usage evidence persistence contract.
//
// logSidecarUsage() is the write path for AI usage reported by the Python
// sidecar (spec_intelligence.py) for the Spec Book analysis pipeline. It
// must persist model id(s)/tokens/cost/bidId into AiUsageLog and must never
// be able to smuggle prompt text, document text, or credentials into the row
// — the input type only accepts numeric counters, a bidId, and a list of
// model id strings, so there's no field to abuse for that.

const h = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLog: { create: h.create },
  },
}));

import { logSidecarUsage } from "../aiUsageLog";

describe("logSidecarUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.create.mockResolvedValue({});
  });

  it("persists model(s), token counts, cost, and bidId — nothing else", async () => {
    await logSidecarUsage({
      callKey: "spec_analysis_sidecar",
      models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
      inputTokens: 12000,
      outputTokens: 3400,
      costUsd: 0.1872,
      bidId: 42,
    });

    expect(h.create).toHaveBeenCalledTimes(1);
    const { data } = h.create.mock.calls[0][0];

    expect(data).toEqual({
      callKey: "spec_analysis_sidecar",
      model: "claude-haiku-4-5-20251001, claude-sonnet-4-6",
      inputTokens: 12000,
      outputTokens: 3400,
      costUsd: 0.1872,
      bidId: 42,
      status: "ok",
      errorMessage: null,
    });

    // Explicitly confirm no forbidden keys ever reach the persisted row.
    const forbidden = ["prompt", "system", "messages", "text", "rawText", "apiKey", "document"];
    for (const key of forbidden) {
      expect(Object.keys(data)).not.toContain(key);
    }
  });

  it("joins multiple model ids into a single column value", async () => {
    await logSidecarUsage({
      callKey: "spec_analysis_sidecar",
      models: ["model-a"],
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      bidId: 1,
    });
    expect(h.create.mock.calls[0][0].data.model).toBe("model-a");
  });

  it("falls back to 'unknown' rather than persisting an empty model string", async () => {
    await logSidecarUsage({
      callKey: "spec_analysis_sidecar",
      models: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      bidId: null,
    });
    expect(h.create.mock.calls[0][0].data.model).toBe("unknown");
    expect(h.create.mock.calls[0][0].data.bidId).toBeNull();
  });

  it("never throws — a DB failure is swallowed so the caller's webhook can't break", async () => {
    h.create.mockRejectedValueOnce(new Error("db unavailable"));
    await expect(
      logSidecarUsage({
        callKey: "spec_analysis_sidecar",
        models: ["m"],
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
        bidId: 1,
      })
    ).resolves.toBeUndefined();
  });
});
