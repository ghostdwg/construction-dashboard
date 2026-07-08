// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/submittal/__tests__/generateFromAiAnalysis.test.ts
//
//  WP1a wipe-interaction regression. This file does NOT change
//  generateFromAiAnalysis.ts — its deleteMany where-clause
//  (source: { in: ["ai_extraction", "regex_seed", "csi_baseline",
//  "ai_organized"] }) already targeted "regex_seed" rows. The bug was that
//  seedSubmittalRegister() never actually wrote that value (see
//  seedSubmittalRegister.test.ts), so regex-seeded rows silently fell to
//  "manual" and were skipped by this exact filter, surviving as duplicates
//  instead of being replaced. This test locks the OTHER half of the fix: now
//  that the seeder stamps correctly, a regex-seeded row genuinely falls
//  within this wipe's target set.
//
//  Prisma is fully mocked. specBook.findFirst is mocked to a book with zero
//  AI-extraction sections, which is a real, valid early-return path in the
//  source (generateFromAiAnalysis.ts ~:185-198) — this exercises the actual
//  deleteMany call without needing to mock the full AI-extraction pipeline,
//  which is out of scope for this WP.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteManySubmittalItem: vi.fn(),
  deleteManySubmittalPackage: vi.fn(),
  findFirstSpecBook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    submittalItem: { deleteMany: h.deleteManySubmittalItem },
    submittalPackage: { deleteMany: h.deleteManySubmittalPackage },
    specBook: { findFirst: h.findFirstSpecBook },
  },
}));

import { generateSubmittalsFromAiAnalysis } from "../generateFromAiAnalysis";

const BID = 1;

beforeEach(() => {
  vi.clearAllMocks();
  h.deleteManySubmittalItem.mockResolvedValue({ count: 1 });
  h.deleteManySubmittalPackage.mockResolvedValue({ count: 0 });
  // Real early-return path: a spec book exists but has no sections with AI
  // extractions yet — the function returns right after the wipe.
  h.findFirstSpecBook.mockResolvedValue({ sections: [] });
});

describe("generateSubmittalsFromAiAnalysis — wipe targets regex_seed rows", () => {
  it("the wipe's source filter includes \"regex_seed\" — a correctly-stamped seeded row is now in scope", async () => {
    const result = await generateSubmittalsFromAiAnalysis(BID);

    expect(h.deleteManySubmittalItem).toHaveBeenCalledTimes(1);
    const call = h.deleteManySubmittalItem.mock.calls[0][0];
    expect(call.where.bidId).toBe(BID);
    expect(call.where.source.in).toContain("regex_seed");
    // "manual" must never be in the wipe target — that's the whole point.
    expect(call.where.source.in).not.toContain("manual");
    expect(result.previousAutoItemsRemoved).toBe(1);
  });

  it("does not touch package rows that still have items (only empty auto-packages)", async () => {
    await generateSubmittalsFromAiAnalysis(BID);

    const call = h.deleteManySubmittalPackage.mock.calls[0][0];
    expect(call.where.bidId).toBe(BID);
    expect(call.where.items).toEqual({ none: {} });
  });
});
