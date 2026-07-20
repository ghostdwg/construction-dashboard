// The real Prisma-backed implementation of StorageInventoryDbAdapter — the
// ONLY sanctioned DB boundary for this tool.
//
// Nothing else in lib/services/storageInventory/ imports Prisma (or any
// other network/DB client): types.ts, classify.ts, report.ts, apply.ts,
// journal.ts, reversal.ts, and index.ts all remain pure and DB-agnostic,
// operating only through the StorageInventoryDbAdapter interface. This file
// is the thin, boring mapping from that interface onto the real schema for
// the 6 model/field pairs the tool inventories:
//   SpecBook.filePath, SpecSection.pdfPath, DrawingUpload.filePath,
//   EstimateUpload.rawFilePath, AddendumUpload.storageKey,
//   Meeting.audioStorageKey
// (see types.ts's MODEL_FIELD for the authoritative list this matches).
//
// SAFETY CONTRACT:
//   - `updateField()` REFUSES AddendumUpload and Meeting unconditionally —
//     those two are inventory-only in this tool in every mode, full stop.
//     This is enforced here too (not just upstream in apply.ts/reversal.ts)
//     so this adapter is safe even if some future/other caller invoked it
//     directly.
//   - `updateField()` also refuses any field name other than the exact
//     column this tool knows about for the given model (defense in depth —
//     apply.ts/reversal.ts already only ever pass the correct field, but this
//     adapter never trusts that blindly).
//   - No caching, batching, retries, or transactions beyond Prisma's own
//     per-call defaults — a deliberately thin, auditable mapping.
//   - Nothing here is imported by the CLI at module-load time: see
//     scripts/storage-inventory-backfill.ts, which only reaches this file
//     via a dynamic `import()` on its real (invoked-as-script) execution
//     path, never as a static import — so merely importing the script (as
//     tests do) never pulls in Prisma or constructs a live connection.

import { prisma } from "@/lib/prisma";
import {
  INVENTORY_ONLY_MODELS,
  MODEL_FIELD,
  type ModelName,
  type StorageInventoryDbAdapter,
  type StorageInventoryRow,
} from "@/lib/services/storageInventory/types";

function isInventoryOnlyModel(model: ModelName): boolean {
  return (INVENTORY_ONLY_MODELS as ModelName[]).includes(model);
}

async function findRowsForModel(model: ModelName): Promise<StorageInventoryRow[]> {
  switch (model) {
    case "SpecBook": {
      const rows = await prisma.specBook.findMany({
        select: { id: true, bidId: true, filePath: true },
      });
      return rows.map((r) => ({ id: r.id, bidId: r.bidId, value: r.filePath }));
    }
    case "SpecSection": {
      // SpecSection has no bidId column of its own — it's scoped via its
      // parent SpecBook, exactly as classify.ts's requireBidId() expects.
      const rows = await prisma.specSection.findMany({
        select: { id: true, pdfPath: true, specBook: { select: { bidId: true } } },
      });
      return rows.map((r) => ({ id: r.id, bidId: r.specBook.bidId, value: r.pdfPath }));
    }
    case "DrawingUpload": {
      const rows = await prisma.drawingUpload.findMany({
        select: { id: true, bidId: true, filePath: true },
      });
      return rows.map((r) => ({ id: r.id, bidId: r.bidId, value: r.filePath }));
    }
    case "EstimateUpload": {
      const rows = await prisma.estimateUpload.findMany({
        select: { id: true, bidId: true, subcontractorId: true, rawFilePath: true },
      });
      return rows.map((r) => ({
        id: r.id,
        bidId: r.bidId,
        subcontractorId: r.subcontractorId,
        value: r.rawFilePath,
      }));
    }
    case "AddendumUpload": {
      const rows = await prisma.addendumUpload.findMany({
        select: { id: true, bidId: true, storageKey: true },
      });
      return rows.map((r) => ({ id: r.id, bidId: r.bidId, value: r.storageKey }));
    }
    case "Meeting": {
      const rows = await prisma.meeting.findMany({
        select: { id: true, bidId: true, audioStorageKey: true },
      });
      return rows.map((r) => ({ id: r.id, bidId: r.bidId, value: r.audioStorageKey }));
    }
    default: {
      const _exhaustive: never = model;
      throw new Error(`storageInventory prismaAdapter: unknown model ${_exhaustive as string}`);
    }
  }
}

async function updateFieldForModel(model: ModelName, rowId: number, field: string, value: string): Promise<void> {
  // Defensive gate #1: the two inventory-only models are NEVER written by
  // this tool, in any mode — refuse unconditionally, regardless of caller.
  if (isInventoryOnlyModel(model)) {
    throw new Error(
      `storageInventory prismaAdapter: refusing to update ${model}.${field} — ${model} is inventory-only ` +
        `in this tool and is never converted, in any mode.`
    );
  }

  // Defensive gate #2: only the exact known column for this model may be
  // written — never trust the caller-supplied field name blindly.
  const expectedField = MODEL_FIELD[model];
  if (field !== expectedField) {
    throw new Error(
      `storageInventory prismaAdapter: refusing to update ${model}.${field} — expected field "${expectedField}" ` +
        `for this model.`
    );
  }

  switch (model) {
    case "SpecBook":
      await prisma.specBook.update({ where: { id: rowId }, data: { filePath: value } });
      return;
    case "SpecSection":
      await prisma.specSection.update({ where: { id: rowId }, data: { pdfPath: value } });
      return;
    case "DrawingUpload":
      await prisma.drawingUpload.update({ where: { id: rowId }, data: { filePath: value } });
      return;
    case "EstimateUpload":
      await prisma.estimateUpload.update({ where: { id: rowId }, data: { rawFilePath: value } });
      return;
    case "AddendumUpload":
    case "Meeting":
      // Unreachable — already refused above. Kept as an explicit case
      // (rather than falling into `default`) so this switch documents, right
      // next to the transformable cases, exactly which models are excluded
      // and why.
      throw new Error(`storageInventory prismaAdapter: unreachable — ${model} is inventory-only.`);
    default: {
      const _exhaustive: never = model;
      throw new Error(`storageInventory prismaAdapter: unknown model ${_exhaustive as string}`);
    }
  }
}

/**
 * Construct the real, Prisma-backed StorageInventoryDbAdapter. A plain
 * factory function with no top-level side effects of its own — importing
 * this module (e.g. in a test with `@/lib/prisma` mocked) never queries or
 * connects; only calling the returned adapter's methods does.
 */
export function createPrismaStorageInventoryAdapter(): StorageInventoryDbAdapter {
  return {
    findRows: (model: ModelName) => findRowsForModel(model),
    updateField: (model: ModelName, rowId: number, field: string, value: string) =>
      updateFieldForModel(model, rowId, field, value),
  };
}
