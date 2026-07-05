import { describe, expect, test } from "vitest";
import { stubFlagRows } from "../providerReadinessDisplay";

describe("stubFlagRows — per-feature ON/OFF truth", () => {
  test("all off -> all three rows present, all OFF", () => {
    const rows = stubFlagRows({
      BRIEF_STUB_MODE: false,
      GAP_STUB_MODE: false,
      ADDENDUM_STUB_MODE: false,
    });
    expect(rows).toEqual([
      { name: "BRIEF_STUB_MODE", on: false },
      { name: "GAP_STUB_MODE", on: false },
      { name: "ADDENDUM_STUB_MODE", on: false },
    ]);
  });

  test("mixed flags -> every feature still listed, ON and OFF both visible (nothing silently omitted)", () => {
    const rows = stubFlagRows({
      BRIEF_STUB_MODE: true,
      GAP_STUB_MODE: false,
      ADDENDUM_STUB_MODE: true,
    });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.name === "BRIEF_STUB_MODE")?.on).toBe(true);
    expect(rows.find((r) => r.name === "GAP_STUB_MODE")?.on).toBe(false);
    expect(rows.find((r) => r.name === "ADDENDUM_STUB_MODE")?.on).toBe(true);
  });

  test("all on -> all three rows present, all ON", () => {
    const rows = stubFlagRows({
      BRIEF_STUB_MODE: true,
      GAP_STUB_MODE: true,
      ADDENDUM_STUB_MODE: true,
    });
    expect(rows.every((r) => r.on)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  test("no raw environment values or unrelated environment names ever appear in the row shape", () => {
    const rows = stubFlagRows({
      BRIEF_STUB_MODE: true,
      GAP_STUB_MODE: false,
      ADDENDUM_STUB_MODE: false,
    });
    const serialized = JSON.stringify(rows);
    // Only the three known, bounded feature names may appear.
    expect(serialized).toMatch(/^\[.*\]$/);
    for (const row of rows) {
      expect(["BRIEF_STUB_MODE", "GAP_STUB_MODE", "ADDENDUM_STUB_MODE"]).toContain(row.name);
      expect(typeof row.on).toBe("boolean");
    }
  });
});
