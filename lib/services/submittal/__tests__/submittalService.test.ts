// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/submittal/__tests__/submittalService.test.ts
//
//  Guards against a cross-tenant write-path bug: createSubmittal() and
//  updateSubmittal() previously accepted a caller-supplied specSectionId with
//  NO validation that it belongs to the same bid as the SubmittalItem being
//  written. A SpecSection only reaches its owning Bid transitively via
//  SpecSection.specBookId -> SpecBook.bidId (no direct SpecSection.bidId
//  column), so the fix queries `specSection.findFirst({ where: { id, specBook:
//  { bidId } } })` before ever touching submittalItem.create/update.
//
//  Prisma is fully mocked (vi.hoisted + vi.mock("@/lib/prisma", ...)) — this
//  mirrors the sibling test lib/services/submittal/__tests__/organizeWithAi.test.ts,
//  the established convention in this repo for unit-testing a Prisma-backed
//  service function without a real DB.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  findUniqueItem: vi.fn(),
  findFirstSpecSection: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    submittalItem: {
      create: h.createItem,
      update: h.updateItem,
      findUnique: h.findUniqueItem,
    },
    specSection: {
      findFirst: h.findFirstSpecSection,
    },
  },
}));

import { createSubmittal, updateSubmittal } from "../submittalService";

const BID = 1;
const OTHER_BID = 2;
const ITEM_ID = 100;
const SECTION_ID = 42;

beforeEach(() => {
  vi.clearAllMocks();
  h.createItem.mockResolvedValue({ id: ITEM_ID });
  h.updateItem.mockResolvedValue({ id: ITEM_ID });
});

describe("createSubmittal — bid-scoped specSectionId enforcement", () => {
  it("rejects a specSectionId that does not exist at all", async () => {
    h.findFirstSpecSection.mockResolvedValue(null);

    const result = await createSubmittal(BID, {
      title: "Test submittal",
      specSectionId: SECTION_ID,
    });

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(h.findFirstSpecSection).toHaveBeenCalledWith({
      where: { id: SECTION_ID, specBook: { bidId: BID } },
      select: { id: true },
    });
    expect(h.createItem).not.toHaveBeenCalled();
  });

  it("rejects a specSectionId that exists but belongs to a different bid", async () => {
    // findFirst is scoped by bidId in the where clause, so a section that
    // belongs to a different bid also resolves to null here.
    h.findFirstSpecSection.mockResolvedValue(null);

    const result = await createSubmittal(BID, {
      title: "Test submittal",
      specSectionId: SECTION_ID,
    });

    expect(result.ok).toBe(false);
    expect(h.findFirstSpecSection).toHaveBeenCalledWith({
      where: { id: SECTION_ID, specBook: { bidId: BID } },
      select: { id: true },
    });
    expect(h.createItem).not.toHaveBeenCalled();
    void OTHER_BID; // documents intent: the section "belongs" to OTHER_BID conceptually
  });

  it("accepts a specSectionId that exists and belongs to the same bid", async () => {
    h.findFirstSpecSection.mockResolvedValue({ id: SECTION_ID });

    const result = await createSubmittal(BID, {
      title: "Test submittal",
      specSectionId: SECTION_ID,
    });

    expect(result).toEqual({ ok: true, id: ITEM_ID });
    expect(h.createItem).toHaveBeenCalledTimes(1);
    const call = h.createItem.mock.calls[0][0];
    expect(call.data.specSectionId).toBe(SECTION_ID);
  });

  it("omitted specSectionId: no lookup at all, created with specSectionId: null", async () => {
    const result = await createSubmittal(BID, { title: "Test submittal" });

    expect(result).toEqual({ ok: true, id: ITEM_ID });
    expect(h.findFirstSpecSection).not.toHaveBeenCalled();
    expect(h.createItem).toHaveBeenCalledTimes(1);
    const call = h.createItem.mock.calls[0][0];
    expect(call.data.specSectionId).toBeNull();
  });

  it("explicit specSectionId: null — no lookup at all, created with specSectionId: null", async () => {
    const result = await createSubmittal(BID, {
      title: "Test submittal",
      specSectionId: null,
    });

    expect(result).toEqual({ ok: true, id: ITEM_ID });
    expect(h.findFirstSpecSection).not.toHaveBeenCalled();
    expect(h.createItem).toHaveBeenCalledTimes(1);
    const call = h.createItem.mock.calls[0][0];
    expect(call.data.specSectionId).toBeNull();
  });
});

describe("updateSubmittal — bid-scoped specSectionId enforcement", () => {
  beforeEach(() => {
    // source: "manual" — these tests are about the cross-tenant check, not
    // provenance; giving them an already-manual row keeps the WP1a
    // promote-on-edit logic (below) a no-op here, so it can't interfere.
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "manual" });
  });

  it("rejects a specSectionId that does not exist at all — whole update is never applied", async () => {
    h.findFirstSpecSection.mockResolvedValue(null);

    const result = await updateSubmittal(BID, ITEM_ID, { specSectionId: SECTION_ID });

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(h.findFirstSpecSection).toHaveBeenCalledWith({
      where: { id: SECTION_ID, specBook: { bidId: BID } },
      select: { id: true },
    });
    expect(h.updateItem).not.toHaveBeenCalled();
  });

  it("rejects a specSectionId that exists but belongs to a different bid — whole update is never applied", async () => {
    h.findFirstSpecSection.mockResolvedValue(null);

    const result = await updateSubmittal(BID, ITEM_ID, {
      title: "Should not be persisted",
      specSectionId: SECTION_ID,
    });

    expect(result.ok).toBe(false);
    expect(h.updateItem).not.toHaveBeenCalled();
  });

  it("accepts a specSectionId that exists and belongs to the same bid", async () => {
    h.findFirstSpecSection.mockResolvedValue({ id: SECTION_ID });

    const result = await updateSubmittal(BID, ITEM_ID, { specSectionId: SECTION_ID });

    expect(result).toEqual({ ok: true });
    expect(h.updateItem).toHaveBeenCalledTimes(1);
    const call = h.updateItem.mock.calls[0][0];
    expect(call.data.specSectionId).toBe(SECTION_ID);
  });

  it("omitted specSectionId (not in input): no lookup at all, update proceeds untouched", async () => {
    const result = await updateSubmittal(BID, ITEM_ID, { title: "New title" });

    expect(result).toEqual({ ok: true });
    expect(h.findFirstSpecSection).not.toHaveBeenCalled();
    expect(h.updateItem).toHaveBeenCalledTimes(1);
    const call = h.updateItem.mock.calls[0][0];
    expect("specSectionId" in call.data).toBe(false);
  });

  it("explicit specSectionId: null (clearing the link): no lookup at all, update proceeds with null", async () => {
    const result = await updateSubmittal(BID, ITEM_ID, { specSectionId: null });

    expect(result).toEqual({ ok: true });
    expect(h.findFirstSpecSection).not.toHaveBeenCalled();
    expect(h.updateItem).toHaveBeenCalledTimes(1);
    const call = h.updateItem.mock.calls[0][0];
    expect(call.data.specSectionId).toBeNull();
  });

  it("regression: pre-existing check still rejects when the submittal itself belongs to a different bid", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: OTHER_BID, status: "PENDING" });

    const result = await updateSubmittal(BID, ITEM_ID, { title: "New title" });

    expect(result).toEqual({ ok: false, error: "Submittal does not belong to this bid" });
    expect(h.findFirstSpecSection).not.toHaveBeenCalled();
    expect(h.updateItem).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// WP1a — promote-on-edit. updateSubmittal is only ever reached from a
// user-driven API call (the seeder/AI paths write via
// prisma.submittalItem.create directly, never through here) — so any
// material change applied to a still-auto row means a human just took
// ownership of it, and it must be protected from a later AI wipe by being
// stamped "manual". Genuinely manual rows must not be touched by this at all.
// ──────────────────────────────────────────────────────────────────────────────
describe("updateSubmittal — promote-on-edit provenance", () => {
  it("editing a regex_seed row promotes it to manual", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "regex_seed" });

    const result = await updateSubmittal(BID, ITEM_ID, { title: "Corrected title" });

    expect(result).toEqual({ ok: true });
    expect(h.updateItem).toHaveBeenCalledTimes(1);
    const call = h.updateItem.mock.calls[0][0];
    expect(call.data.title).toBe("Corrected title");
    expect(call.data.source).toBe("manual");
  });

  it("editing an ai_extraction row promotes it to manual", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "ai_extraction" });

    await updateSubmittal(BID, ITEM_ID, { description: "Corrected description" });

    const call = h.updateItem.mock.calls[0][0];
    expect(call.data.source).toBe("manual");
  });

  it("editing an ai_organized row promotes it to manual", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "ai_organized" });

    await updateSubmittal(BID, ITEM_ID, { responsibleSubId: 7 });

    const call = h.updateItem.mock.calls[0][0];
    expect(call.data.source).toBe("manual");
  });

  it("a genuinely manual row stays manual and the promotion path is a no-op", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "manual" });

    const result = await updateSubmittal(BID, ITEM_ID, { title: "Another edit" });

    expect(result).toEqual({ ok: true });
    const call = h.updateItem.mock.calls[0][0];
    expect(call.data.title).toBe("Another edit");
    // "manual" was already the value — promotion logic must not even need to
    // set it again, but if it does, it must never set anything else.
    expect(call.data.source === undefined || call.data.source === "manual").toBe(true);
  });

  it("an update with no actual field changes does not promote (nothing to protect)", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "regex_seed" });

    // Empty input object: no fields in `data` at all after processing.
    const result = await updateSubmittal(BID, ITEM_ID, {});

    expect(result).toEqual({ ok: true });
    const call = h.updateItem.mock.calls[0][0];
    expect("source" in call.data).toBe(false);
  });

  it("a rejected update (bad specSectionId) never reaches the promotion logic", async () => {
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING", source: "regex_seed" });
    h.findFirstSpecSection.mockResolvedValue(null);

    const result = await updateSubmittal(BID, ITEM_ID, {
      title: "Should not persist",
      specSectionId: SECTION_ID,
    });

    expect(result.ok).toBe(false);
    expect(h.updateItem).not.toHaveBeenCalled();
  });
});
