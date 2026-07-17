// Field Response Certification — trade-grouping expectation tests.
//
// Validates the groupByTrade utility against the expected-trade-grouping fixture.
// TrackedItem.tradeId is the grouping key; items with null tradeId land in
// the "Unassigned" group. No DB, no network.
import { describe, expect, test, beforeEach } from "vitest";
import {
  makeTrackedItem,
  groupByTrade,
  FIXTURE_TRADES,
  tradeById,
  resetIds,
} from "@/tests/field-response-certification/unit-integration-builders";
import expectedTradeGrouping from "@/tests/field-response-certification/fixtures/expected-trade-grouping.json";

beforeEach(() => {
  resetIds(4000);
});

describe("groupByTrade", () => {
  test("empty item list returns empty groups", () => {
    expect(groupByTrade([])).toEqual([]);
  });

  test("single item with no tradeId lands in Unassigned group", () => {
    const item = makeTrackedItem({ tradeId: null });
    const groups = groupByTrade([item]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tradeName).toBe("Unassigned");
    expect(groups[0].trade).toBeNull();
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].id).toBe(item.id);
  });

  test("items with same tradeId are in the same group", () => {
    const tradeId = 7; // Steel
    const item1 = makeTrackedItem({ tradeId, title: "Anchor bolt" });
    const item2 = makeTrackedItem({ tradeId, title: "Weld inspection" });
    const groups = groupByTrade([item1, item2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tradeName).toBe("Steel");
    expect(groups[0].items).toHaveLength(2);
  });

  test("items with different tradeIds land in different groups", () => {
    const steel = makeTrackedItem({ tradeId: 7, title: "Steel item" });
    const mech = makeTrackedItem({ tradeId: 8, title: "Mechanical item" });
    const elec = makeTrackedItem({ tradeId: 9, title: "Electrical item" });
    const groups = groupByTrade([steel, mech, elec]);
    expect(groups).toHaveLength(3);
    const names = groups.map((g) => g.tradeName).sort();
    expect(names).toEqual(["Electrical", "Mechanical", "Steel"]);
  });

  test("groups are sorted alphabetically by tradeName", () => {
    const items = [
      makeTrackedItem({ tradeId: 9 }), // Electrical
      makeTrackedItem({ tradeId: 7 }), // Steel
      makeTrackedItem({ tradeId: 8 }), // Mechanical
      makeTrackedItem({ tradeId: 3 }), // Drywall
    ];
    const groups = groupByTrade(items);
    expect(groups.map((g) => g.tradeName)).toEqual([
      "Drywall",
      "Electrical",
      "Mechanical",
      "Steel",
    ]);
  });

  test("Unassigned group sorts to end", () => {
    const assigned = makeTrackedItem({ tradeId: 1, title: "Masonry item" });
    const unassigned = makeTrackedItem({ tradeId: null, title: "No trade" });
    const groups = groupByTrade([unassigned, assigned]);
    expect(groups[0].tradeName).toBe("Masonry");
    expect(groups[1].tradeName).toBe("Unassigned");
  });

  test("trade metadata is attached from FIXTURE_TRADES", () => {
    const item = makeTrackedItem({ tradeId: 7 });
    const groups = groupByTrade([item]);
    expect(groups[0].trade).not.toBeNull();
    expect(groups[0].trade?.name).toBe("Steel");
    expect(groups[0].trade?.costCode).toBe("05000");
    expect(groups[0].trade?.csiCode).toBe("05 12 00");
  });

  test("insertion order is preserved within a group", () => {
    const tradeId = 7;
    const first = makeTrackedItem({ tradeId, title: "First" });
    const second = makeTrackedItem({ tradeId, title: "Second" });
    const third = makeTrackedItem({ tradeId, title: "Third" });
    const groups = groupByTrade([first, second, third]);
    expect(groups[0].items[0].title).toBe("First");
    expect(groups[0].items[1].title).toBe("Second");
    expect(groups[0].items[2].title).toBe("Third");
  });

  test("full AFR+EFR scenario matches expected-trade-grouping fixture summary", () => {
    const expected = expectedTradeGrouping;
    // Build the items described in the fixture
    const items = expected.groups.flatMap((g) =>
      Array.from({ length: g.itemCount }, () =>
        makeTrackedItem({ tradeId: g.tradeId })
      )
    );

    const groups = groupByTrade(items);
    expect(groups).toHaveLength(expected.summary.tradeGroupCount);
    expect(items).toHaveLength(expected.summary.totalActiveItems);

    // Each expected group appears with correct item count
    for (const expectedGroup of expected.groups) {
      const found = groups.find((g) => g.tradeName === expectedGroup.tradeName);
      expect(found).toBeDefined();
      expect(found!.items).toHaveLength(expectedGroup.itemCount);
    }
  });
});

describe("FIXTURE_TRADES directory", () => {
  test("all 10 trades are defined", () => {
    expect(FIXTURE_TRADES).toHaveLength(10);
  });

  test("trade IDs are unique", () => {
    const ids = FIXTURE_TRADES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("trade names are unique", () => {
    const names = FIXTURE_TRADES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("tradeById returns correct trade", () => {
    expect(tradeById(7)?.name).toBe("Steel");
    expect(tradeById(8)?.name).toBe("Mechanical");
    expect(tradeById(9)?.name).toBe("Electrical");
    expect(tradeById(99)).toBeUndefined();
  });

  test("all active trades have costCode", () => {
    FIXTURE_TRADES.filter((t) => t.isActive).forEach((t) => {
      expect(t.costCode).toBeTruthy();
    });
  });
});
