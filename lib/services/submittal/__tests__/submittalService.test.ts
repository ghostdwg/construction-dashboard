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
    h.findUniqueItem.mockResolvedValue({ id: ITEM_ID, bidId: BID, status: "PENDING" });
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
