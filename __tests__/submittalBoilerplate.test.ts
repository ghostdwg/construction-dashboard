import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "file:./dev.db";

describe("submittal boilerplate detection", () => {
  it("flags Product Data as generic boilerplate", async () => {
    const { isGenericBoilerplate } = await import("../lib/services/submittal/generateFromAiAnalysis");

    expect(isGenericBoilerplate("Product Data")).toBe(true);
  });

  it("keeps specific shop drawing descriptions", async () => {
    const { isGenericBoilerplate } = await import("../lib/services/submittal/generateFromAiAnalysis");

    expect(isGenericBoilerplate("Mechanical Equipment Shop Drawings")).toBe(false);
  });

  it("flags single-word inputs as generic boilerplate", async () => {
    const { isGenericBoilerplate } = await import("../lib/services/submittal/generateFromAiAnalysis");

    expect(isGenericBoilerplate("Warranty")).toBe(true);
  });
});
