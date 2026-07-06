// Per-row classification — dispatches to each domain's EXISTING, already-
// reviewed, pure `classify*StoragePath()` function. This module deliberately
// contains zero path-shape recognition of its own: it only picks the right
// classifier + scope for a given model and translates its `ClassifyResult`
// into this tool's `RowClassification`.
//
// None of the five imports below reach into I/O helpers (resolveLocalPath /
// storagePathExists / readBuffer / deletePath) — only the synchronous,
// I/O-free classify functions are used, so this file (and everything that
// imports it) never touches BlobStore, the filesystem, or the network.

import { classifyStoragePath } from "@/lib/services/specbook/storagePath";
import { classifyDrawingStoragePath } from "@/lib/services/drawings/storagePath";
import { classifyEstimateStoragePath } from "@/lib/services/estimates/storagePath";
import { classifyAddendumStoragePath } from "@/lib/services/addendums/storagePath";
import { classifyMeetingStoragePath } from "@/lib/services/meetings/storagePath";
import {
  isTransformableModel,
  type ModelName,
  type RowClassification,
  type StorageInventoryRow,
} from "@/lib/services/storageInventory/types";

function requireBidId(model: ModelName, row: StorageInventoryRow): number {
  if (row.bidId === undefined || row.bidId === null) {
    throw new Error(`storageInventory: row ${row.id} for model ${model} is missing required bidId scope`);
  }
  return row.bidId;
}

function requireSubcontractorId(row: StorageInventoryRow): number {
  if (row.subcontractorId === undefined || row.subcontractorId === null) {
    throw new Error(`storageInventory: EstimateUpload row ${row.id} is missing required subcontractorId scope`);
  }
  return row.subcontractorId;
}

/**
 * Classify a single row using the correct existing classifier + scope for
 * its model. Pure and synchronous — never touches the filesystem, BlobStore,
 * or the network (matches every underlying classify*StoragePath()'s own
 * contract).
 */
export function classifyInventoryRow(model: ModelName, row: StorageInventoryRow): RowClassification {
  if (row.value === null || row.value === undefined) {
    return { model, rowId: row.id, bucket: "null", convertible: false };
  }

  const value = row.value;
  let result:
    | ReturnType<typeof classifyStoragePath>
    | ReturnType<typeof classifyDrawingStoragePath>
    | ReturnType<typeof classifyEstimateStoragePath>
    | ReturnType<typeof classifyAddendumStoragePath>
    | ReturnType<typeof classifyMeetingStoragePath>;

  switch (model) {
    case "SpecBook":
    case "SpecSection":
      result = classifyStoragePath(value, requireBidId(model, row));
      break;
    case "DrawingUpload":
      result = classifyDrawingStoragePath(value, requireBidId(model, row));
      break;
    case "EstimateUpload":
      result = classifyEstimateStoragePath(value, requireBidId(model, row), requireSubcontractorId(row));
      break;
    case "AddendumUpload":
      result = classifyAddendumStoragePath(value, requireBidId(model, row));
      break;
    case "Meeting":
      // Scoped by the MEETING id itself, not a bidId — see
      // lib/services/meetings/storagePath.ts's module header.
      result = classifyMeetingStoragePath(value, row.id);
      break;
    default: {
      const _exhaustive: never = model;
      throw new Error(`storageInventory: unknown model ${_exhaustive as string}`);
    }
  }

  // Only a "legacy-storage-root" row on one of the 4 transformable models is
  // ever eligible for this tool's apply mode — AddendumUpload/Meeting are
  // inventory-only in this tool, full stop, regardless of what their own
  // classifier reports.
  const convertible = isTransformableModel(model) && result.kind === "legacy-storage-root";

  return {
    model,
    rowId: row.id,
    bucket: result.kind,
    convertible,
    canonicalKey:
      result.kind === "canonical" || result.kind === "legacy-storage-root" ? result.canonicalKey : undefined,
  };
}
