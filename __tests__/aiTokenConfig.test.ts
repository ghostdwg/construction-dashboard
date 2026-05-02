import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "file:./dev.db";

describe("ai token config helpers", async () => {
  const { getMaxTokens } = await import("../lib/services/ai/aiTokenConfig");
  const { computeCallCost } = await import("../lib/services/ai/aiUsageLog");

  it("returns a positive default for an unknown call key without a DB override", async () => {
    await expect(getMaxTokens("__vitest_missing_call_key__")).resolves.toBeGreaterThan(0);
  });

  it("computes a positive call cost for non-zero token counts", () => {
    expect(computeCallCost("claude-sonnet-4-6", 1000, 500)).toBeGreaterThan(0);
  });
});
