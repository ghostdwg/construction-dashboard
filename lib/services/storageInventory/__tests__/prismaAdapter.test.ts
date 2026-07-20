// ──────────────────────────────────────────────────────────────────────────
//  lib/services/storageInventory/__tests__/prismaAdapter.test.ts
//
//  Coverage for the real Prisma-backed adapter — the ONE sanctioned DB
//  boundary for the storage inventory tool. Every test here mocks
//  "@/lib/prisma" (vi.mock) — this suite never constructs, connects to, or
//  queries a real database, matching the convention used throughout this
//  repo's other prisma-adapter tests (e.g.
//  lib/services/credentials/__tests__/credentialsService.test.ts).
//
//  Proves:
//    1. Importing the module / constructing the adapter has zero side
//       effects — no mocked prisma method is called until an adapter method
//       is explicitly invoked.
//    2. findRows() maps all 6 model/field pairs correctly (model, field name,
//       bidId/subcontractorId scope) per lib/services/storageInventory/
//       types.ts's MODEL_FIELD + StorageInventoryRow contract.
//    3. updateField() writes the correct field for the 4 transformable
//       models, and refuses (throws, never calls prisma's update) for
//       AddendumUpload/Meeting and for any unexpected field name.
//    4. Wiring this adapter into the real (pure) buildInventoryReport()
//       proves updateField is structurally unreachable in inventory mode.
// ──────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  specBookFindMany: vi.fn(),
  specBookUpdate: vi.fn(),
  specSectionFindMany: vi.fn(),
  specSectionUpdate: vi.fn(),
  drawingUploadFindMany: vi.fn(),
  drawingUploadUpdate: vi.fn(),
  estimateUploadFindMany: vi.fn(),
  estimateUploadUpdate: vi.fn(),
  addendumUploadFindMany: vi.fn(),
  addendumUploadUpdate: vi.fn(),
  meetingFindMany: vi.fn(),
  meetingUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: { findMany: h.specBookFindMany, update: h.specBookUpdate },
    specSection: { findMany: h.specSectionFindMany, update: h.specSectionUpdate },
    drawingUpload: { findMany: h.drawingUploadFindMany, update: h.drawingUploadUpdate },
    estimateUpload: { findMany: h.estimateUploadFindMany, update: h.estimateUploadUpdate },
    addendumUpload: { findMany: h.addendumUploadFindMany, update: h.addendumUploadUpdate },
    meeting: { findMany: h.meetingFindMany, update: h.meetingUpdate },
  },
}));

// Import happens AFTER vi.mock (hoisted above regardless of position) —
// the very first test below asserts this import + adapter construction
// alone never touched any mocked prisma method.
import { createPrismaStorageInventoryAdapter } from "@/lib/services/storageInventory/prismaAdapter";
import { buildInventoryReport } from "@/lib/services/storageInventory/report";

function allMockFns() {
  return Object.values(h);
}

beforeEach(() => {
  for (const fn of allMockFns()) fn.mockReset();
});

describe("createPrismaStorageInventoryAdapter — no top-level side effects", () => {
  test("importing the module and constructing the adapter never queries or connects to prisma", () => {
    const adapter = createPrismaStorageInventoryAdapter();
    expect(adapter).toBeDefined();
    for (const fn of allMockFns()) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("findRows — correct model/field mapping (all 6 pairs)", () => {
  test("SpecBook: filePath -> value, scoped by bidId", async () => {
    h.specBookFindMany.mockResolvedValue([{ id: 1, bidId: 501, filePath: "plan-room/jobs/501/spec/original.pdf" }]);
    const adapter = createPrismaStorageInventoryAdapter();
    const rows = await adapter.findRows("SpecBook");
    expect(rows).toEqual([{ id: 1, bidId: 501, value: "plan-room/jobs/501/spec/original.pdf" }]);
    expect(h.specBookFindMany).toHaveBeenCalledWith({ select: { id: true, bidId: true, filePath: true } });
  });

  test("SpecSection: pdfPath -> value, scoped by parent SpecBook.bidId", async () => {
    h.specSectionFindMany.mockResolvedValue([
      { id: 11, pdfPath: "plan-room/jobs/501/spec/sections/09-91-00.pdf", specBook: { bidId: 501 } },
      { id: 15, pdfPath: null, specBook: { bidId: 501 } },
    ]);
    const adapter = createPrismaStorageInventoryAdapter();
    const rows = await adapter.findRows("SpecSection");
    expect(rows).toEqual([
      { id: 11, bidId: 501, value: "plan-room/jobs/501/spec/sections/09-91-00.pdf" },
      { id: 15, bidId: 501, value: null },
    ]);
    expect(h.specSectionFindMany).toHaveBeenCalledWith({
      select: { id: true, pdfPath: true, specBook: { select: { bidId: true } } },
    });
  });

  test("DrawingUpload: filePath -> value, scoped by bidId", async () => {
    h.drawingUploadFindMany.mockResolvedValue([{ id: 21, bidId: 502, filePath: "uploads/drawings/502/floor-plan.pdf" }]);
    const adapter = createPrismaStorageInventoryAdapter();
    const rows = await adapter.findRows("DrawingUpload");
    expect(rows).toEqual([{ id: 21, bidId: 502, value: "uploads/drawings/502/floor-plan.pdf" }]);
    expect(h.drawingUploadFindMany).toHaveBeenCalledWith({ select: { id: true, bidId: true, filePath: true } });
  });

  test("EstimateUpload: rawFilePath -> value, scoped by bidId AND subcontractorId", async () => {
    h.estimateUploadFindMany.mockResolvedValue([
      { id: 31, bidId: 503, subcontractorId: 9001, rawFilePath: "uploads/estimates/503/9001/bid-estimate.pdf" },
    ]);
    const adapter = createPrismaStorageInventoryAdapter();
    const rows = await adapter.findRows("EstimateUpload");
    expect(rows).toEqual([
      { id: 31, bidId: 503, subcontractorId: 9001, value: "uploads/estimates/503/9001/bid-estimate.pdf" },
    ]);
    expect(h.estimateUploadFindMany).toHaveBeenCalledWith({
      select: { id: true, bidId: true, subcontractorId: true, rawFilePath: true },
    });
  });

  test("AddendumUpload: storageKey -> value, scoped by bidId (inventory-only)", async () => {
    h.addendumUploadFindMany.mockResolvedValue([{ id: 41, bidId: 504, storageKey: "uploads/addendums/504/addendum-1.pdf" }]);
    const adapter = createPrismaStorageInventoryAdapter();
    const rows = await adapter.findRows("AddendumUpload");
    expect(rows).toEqual([{ id: 41, bidId: 504, value: "uploads/addendums/504/addendum-1.pdf" }]);
    expect(h.addendumUploadFindMany).toHaveBeenCalledWith({ select: { id: true, bidId: true, storageKey: true } });
  });

  test("Meeting: audioStorageKey -> value, scoped by the row's own id (inventory-only)", async () => {
    h.meetingFindMany.mockResolvedValue([{ id: 701, bidId: 505, audioStorageKey: "uploads/meetings/701/audio.mp3" }]);
    const adapter = createPrismaStorageInventoryAdapter();
    const rows = await adapter.findRows("Meeting");
    expect(rows).toEqual([{ id: 701, bidId: 505, value: "uploads/meetings/701/audio.mp3" }]);
    expect(h.meetingFindMany).toHaveBeenCalledWith({ select: { id: true, bidId: true, audioStorageKey: true } });
  });
});

describe("updateField — writes the correct field for the 4 transformable models", () => {
  test("SpecBook -> filePath", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await adapter.updateField("SpecBook", 1, "filePath", "plan-room/jobs/501/spec/original.pdf");
    expect(h.specBookUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { filePath: "plan-room/jobs/501/spec/original.pdf" },
    });
  });

  test("SpecSection -> pdfPath", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await adapter.updateField("SpecSection", 13, "pdfPath", "plan-room/jobs/501/spec/sections/09-91-00.pdf");
    expect(h.specSectionUpdate).toHaveBeenCalledWith({
      where: { id: 13 },
      data: { pdfPath: "plan-room/jobs/501/spec/sections/09-91-00.pdf" },
    });
  });

  test("DrawingUpload -> filePath", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await adapter.updateField("DrawingUpload", 23, "filePath", "uploads/drawings/502/floor-plan.pdf");
    expect(h.drawingUploadUpdate).toHaveBeenCalledWith({
      where: { id: 23 },
      data: { filePath: "uploads/drawings/502/floor-plan.pdf" },
    });
  });

  test("EstimateUpload -> rawFilePath", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await adapter.updateField("EstimateUpload", 33, "rawFilePath", "uploads/estimates/503/9001/bid-estimate.pdf");
    expect(h.estimateUploadUpdate).toHaveBeenCalledWith({
      where: { id: 33 },
      data: { rawFilePath: "uploads/estimates/503/9001/bid-estimate.pdf" },
    });
  });
});

describe("updateField — refuses the 2 inventory-only models unconditionally", () => {
  test("refuses AddendumUpload even with its own correct field name", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await expect(adapter.updateField("AddendumUpload", 41, "storageKey", "x")).rejects.toThrow(/inventory-only/);
    expect(h.addendumUploadUpdate).not.toHaveBeenCalled();
  });

  test("refuses Meeting even with its own correct field name", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await expect(adapter.updateField("Meeting", 701, "audioStorageKey", "x")).rejects.toThrow(/inventory-only/);
    expect(h.meetingUpdate).not.toHaveBeenCalled();
  });
});

describe("updateField — refuses an unexpected field name for a transformable model", () => {
  test("refuses a mismatched field for SpecBook", async () => {
    const adapter = createPrismaStorageInventoryAdapter();
    await expect(adapter.updateField("SpecBook", 1, "notARealColumn", "x")).rejects.toThrow(/expected field/);
    expect(h.specBookUpdate).not.toHaveBeenCalled();
  });
});

describe("wired into the real (pure) inventory report — updateField is unreachable in inventory mode", () => {
  test("buildInventoryReport() never calls any prisma update, only findMany, across all 6 models", async () => {
    h.specBookFindMany.mockResolvedValue([]);
    h.specSectionFindMany.mockResolvedValue([]);
    h.drawingUploadFindMany.mockResolvedValue([]);
    h.estimateUploadFindMany.mockResolvedValue([]);
    h.addendumUploadFindMany.mockResolvedValue([]);
    h.meetingFindMany.mockResolvedValue([]);

    const adapter = createPrismaStorageInventoryAdapter();
    const report = await buildInventoryReport(adapter, "2026-01-01T00:00:00.000Z");

    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(h.specBookFindMany).toHaveBeenCalledTimes(1);
    expect(h.specSectionFindMany).toHaveBeenCalledTimes(1);
    expect(h.drawingUploadFindMany).toHaveBeenCalledTimes(1);
    expect(h.estimateUploadFindMany).toHaveBeenCalledTimes(1);
    expect(h.addendumUploadFindMany).toHaveBeenCalledTimes(1);
    expect(h.meetingFindMany).toHaveBeenCalledTimes(1);

    expect(h.specBookUpdate).not.toHaveBeenCalled();
    expect(h.specSectionUpdate).not.toHaveBeenCalled();
    expect(h.drawingUploadUpdate).not.toHaveBeenCalled();
    expect(h.estimateUploadUpdate).not.toHaveBeenCalled();
    expect(h.addendumUploadUpdate).not.toHaveBeenCalled();
    expect(h.meetingUpdate).not.toHaveBeenCalled();
  });
});
