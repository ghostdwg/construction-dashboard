// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/submittal/__tests__/seedSubmittalRegister.test.ts
//
//  WP1a — GWX-H3 provenance bug. seedSubmittalRegister() previously created
//  every row with NO `source` field, silently falling to the schema default
//  "manual" — indistinguishable from a genuinely hand-entered row, and
//  invisible to generateFromAiAnalysis's/organizeWithAi's wipe-non-manual-rows
//  logic (both filter on source in [...auto values], which never matched
//  "manual"). This locks the fix: every created row must carry
//  source: "regex_seed", and idempotency (the whole point of the existing
//  dedup-by-key check) must be unaffected by adding the field.
//
//  Prisma is fully mocked (vi.hoisted + vi.mock("@/lib/prisma", ...)), same
//  convention as submittalService.test.ts / organizeWithAi.test.ts.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findManySpecSection: vi.fn(),
  findManyBidTrade: vi.fn(),
  findManyBidInviteSelection: vi.fn(),
  findManySubmittalItem: vi.fn(),
  createSubmittalItem: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specSection: { findMany: h.findManySpecSection },
    bidTrade: { findMany: h.findManyBidTrade },
    bidInviteSelection: { findMany: h.findManyBidInviteSelection },
    submittalItem: {
      findMany: h.findManySubmittalItem,
      create: h.createSubmittalItem,
    },
  },
}));

import { seedSubmittalRegister } from "../seedSubmittalRegister";

const BID = 1;
const SECTION_ID = 42;

const SUBMITTALS_SECTION = {
  id: SECTION_ID,
  csiNumber: "07 21 00",
  csiTitle: "Thermal Insulation",
  rawText: [
    "1.3 SUBMITTALS:",
    "A. Submit shop drawings for review.",
    "B. Submit product data sheets.",
  ].join("\n"),
  tradeId: 5,
  matchedTradeId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findManyBidTrade.mockResolvedValue([]);
  h.findManyBidInviteSelection.mockResolvedValue([]);
  h.findManySubmittalItem.mockResolvedValue([]); // no pre-existing items
  h.createSubmittalItem.mockResolvedValue({ id: 999 });
});

describe("seedSubmittalRegister — provenance stamp", () => {
  it("stamps every created row with source: \"regex_seed\"", async () => {
    h.findManySpecSection.mockResolvedValue([SUBMITTALS_SECTION]);

    const result = await seedSubmittalRegister(BID);

    expect(result.itemsCreated).toBeGreaterThan(0);
    expect(h.createSubmittalItem).toHaveBeenCalled();
    for (const call of h.createSubmittalItem.mock.calls) {
      expect(call[0].data.source).toBe("regex_seed");
    }
  });

  it("never falls back to the schema default by omitting the field", async () => {
    h.findManySpecSection.mockResolvedValue([SUBMITTALS_SECTION]);

    await seedSubmittalRegister(BID);

    for (const call of h.createSubmittalItem.mock.calls) {
      expect("source" in call[0].data).toBe(true);
      expect(call[0].data.source).not.toBe("manual");
    }
  });
});

describe("seedSubmittalRegister — idempotency preserved", () => {
  it("re-running against sections whose items already exist creates nothing new", async () => {
    h.findManySpecSection.mockResolvedValue([SUBMITTALS_SECTION]);
    // Simulate a prior run: both parsed titles already exist for this section.
    h.findManySubmittalItem.mockResolvedValue([
      { specSectionId: SECTION_ID, title: "Submit shop drawings for review" },
      { specSectionId: SECTION_ID, title: "Submit product data sheets" },
    ]);

    const result = await seedSubmittalRegister(BID);

    expect(result.itemsCreated).toBe(0);
    expect(result.itemsSkipped).toBeGreaterThan(0);
    expect(h.createSubmittalItem).not.toHaveBeenCalled();
  });

  it("first run creates items, and a second run against the same DB state creates none of the same items again", async () => {
    h.findManySpecSection.mockResolvedValue([SUBMITTALS_SECTION]);

    const first = await seedSubmittalRegister(BID);
    expect(first.itemsCreated).toBeGreaterThan(0);
    const createdTitles = h.createSubmittalItem.mock.calls.map((c) => c[0].data.title);

    // Simulate the DB now containing what run 1 created.
    h.findManySubmittalItem.mockResolvedValue(
      createdTitles.map((title) => ({ specSectionId: SECTION_ID, title }))
    );
    h.createSubmittalItem.mockClear();

    const second = await seedSubmittalRegister(BID);

    expect(second.itemsCreated).toBe(0);
    expect(h.createSubmittalItem).not.toHaveBeenCalled();
  });
});
