import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "file:./dev.db";

describe("submittal boilerplate detection", async () => {
  const { isGenericBoilerplate } = await import("../lib/services/submittal/generateFromAiAnalysis");

  it("flags Product Data as generic boilerplate", () => {
    expect(isGenericBoilerplate("Product Data")).toBe(true);
  });

  it("keeps specific shop drawing descriptions", () => {
    expect(isGenericBoilerplate("Mechanical Equipment Shop Drawings")).toBe(false);
  });

  it("flags single-word inputs as generic boilerplate", () => {
    expect(isGenericBoilerplate("Warranty")).toBe(true);
  });
});
