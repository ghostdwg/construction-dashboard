// Shared test fixtures for the storage inventory tool's test suite. Every
// value below is synthetic (fake bid/subcontractor/meeting ids, made-up
// filenames) — never anything resembling a real project document, path, or
// credential, matching every other test file in this repo.
//
// No real filesystem or BlobStore I/O anywhere here: these are plain string
// values assigned to an in-memory fixture object. `classifyInventoryRow()`
// (and everything it calls) never touches disk — it is pure string/path
// arithmetic — so building these fixtures requires no directories, no real
// files, and no database of any kind.

import path from "path";
import type { ModelName, StorageInventoryDbAdapter, StorageInventoryRow } from "@/lib/services/storageInventory/types";

/** Matches the classifiers' `getStorageRoot()` fallback shape but is set explicitly by the test file — never a real path. */
export const SYNTHETIC_STORAGE_ROOT = "/synthetic-storage-root";

function legacyCwd(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

function legacyRoot(...segments: string[]): string {
  return path.join(SYNTHETIC_STORAGE_ROOT, ...segments);
}

/**
 * One row per recognized shape (canonical / legacy-cwd / legacy-storage-root
 * / invalid), for every one of the 6 model/field pairs, plus explicit
 * null/missing-key rows for SpecSection (whose pdfPath is genuinely nullable
 * in the real schema pre-split) and for the two inventory-only models
 * (AddendumUpload/Meeting), where most existing rows are null today.
 *
 * Returns a FRESH object every call (no shared mutable state across tests) —
 * apply/reversal tests mutate `.value` on these rows via the fake adapter's
 * updateField, so each test must start from its own copy.
 */
export function buildFixtureData(): Record<ModelName, StorageInventoryRow[]> {
  return {
    SpecBook: [
      { id: 1, bidId: 501, value: "plan-room/jobs/501/spec/original.pdf" }, // canonical
      { id: 2, bidId: 501, value: legacyCwd("uploads", "specbooks", "501", "original.pdf") }, // legacy-cwd
      { id: 3, bidId: 501, value: legacyRoot("uploads", "specbooks", "501", "original.pdf") }, // legacy-storage-root, convertible
      { id: 4, bidId: 501, value: legacyRoot("uploads", "specbooks", "999", "original.pdf") }, // invalid (wrong bidId segment)
    ],
    SpecSection: [
      { id: 11, bidId: 501, value: "plan-room/jobs/501/spec/sections/09-91-00.pdf" }, // canonical
      { id: 12, bidId: 501, value: legacyCwd("uploads", "specbooks", "501", "sections", "09-91-00.pdf") }, // legacy-cwd
      { id: 13, bidId: 501, value: legacyRoot("uploads", "specbooks", "501", "sections", "09-91-00.pdf") }, // legacy-storage-root, convertible
      { id: 14, bidId: 501, value: legacyRoot("uploads", "specbooks", "999", "sections", "09-91-00.pdf") }, // invalid
      { id: 15, bidId: 501, value: null }, // not yet split — genuinely nullable in schema
    ],
    DrawingUpload: [
      { id: 21, bidId: 502, value: "uploads/drawings/502/floor-plan.pdf" }, // canonical
      { id: 22, bidId: 502, value: legacyCwd("uploads", "drawings", "502", "floor-plan.pdf") }, // legacy-cwd
      { id: 23, bidId: 502, value: legacyRoot("uploads", "drawings", "502", "floor-plan.pdf") }, // legacy-storage-root, convertible
      { id: 24, bidId: 502, value: legacyRoot("uploads", "drawings", "999", "floor-plan.pdf") }, // invalid
    ],
    EstimateUpload: [
      { id: 31, bidId: 503, subcontractorId: 9001, value: "uploads/estimates/503/9001/bid-estimate.pdf" }, // canonical
      { id: 32, bidId: 503, subcontractorId: 9001, value: legacyCwd("uploads", "estimates", "503", "9001", "bid-estimate.pdf") }, // legacy-cwd
      { id: 33, bidId: 503, subcontractorId: 9001, value: legacyRoot("uploads", "estimates", "503", "9001", "bid-estimate.pdf") }, // legacy-storage-root, convertible
      { id: 34, bidId: 503, subcontractorId: 9001, value: legacyRoot("uploads", "estimates", "503", "9999", "bid-estimate.pdf") }, // invalid (wrong subcontractorId)
    ],
    AddendumUpload: [
      { id: 41, bidId: 504, value: "uploads/addendums/504/addendum-1.pdf" }, // canonical
      { id: 42, bidId: 504, value: legacyCwd("uploads", "addendums", "504", "addendum-1.pdf") }, // legacy-cwd
      { id: 43, bidId: 504, value: legacyRoot("uploads", "addendums", "504", "addendum-1.pdf") }, // legacy-storage-root (reported, NOT convertible — inventory-only model)
      { id: 44, bidId: 504, value: legacyRoot("uploads", "addendums", "999", "addendum-1.pdf") }, // invalid
      { id: 45, bidId: 504, value: null }, // null — column newly added, most existing rows null
      { id: 46, bidId: 504, value: null },
    ],
    Meeting: [
      { id: 701, bidId: 505, value: "uploads/meetings/701/audio.mp3" },
      { id: 702, bidId: 505, value: legacyCwd("uploads", "meetings", "702", "audio.mp3") },
      { id: 703, bidId: 505, value: legacyRoot("uploads", "meetings", "703", "audio.mp3") },
      { id: 704, bidId: 505, value: legacyRoot("uploads", "meetings", "999", "audio.mp3") },
      { id: 705, bidId: 505, value: null },
      { id: 706, bidId: 505, value: null },
    ],
  };
}

/** Every row id classified "legacy-cwd" across the fixture set — used to assert these are never passed to updateField. */
export const LEGACY_CWD_ROW_IDS = [2, 12, 22, 32, 42, 702];

/** Every row id classified "invalid" across the fixture set — used to assert these are never passed to updateField. */
export const INVALID_ROW_IDS = [4, 14, 24, 34, 44, 704];

/** The row ids expected to convert in apply mode (one legacy-storage-root row per transformable model). */
export const CONVERTIBLE_ROW_IDS = [3, 13, 23, 33];

/**
 * In-memory fake DB adapter. No real SQLite/libSQL file, no network
 * connection — `findRows` returns (a live reference into) the fixture
 * arrays passed at construction, and `updateField` mutates `.value` on the
 * matching row in place, exactly mimicking a real UPDATE's effect on
 * subsequent reads without ever touching a real database.
 */
export class FakeStorageInventoryDbAdapter implements StorageInventoryDbAdapter {
  readonly calls: Array<{ model: ModelName; rowId: number; field: string; value: string }> = [];

  constructor(private readonly data: Record<ModelName, StorageInventoryRow[]>) {}

  async findRows(model: ModelName): Promise<StorageInventoryRow[]> {
    return this.data[model] ?? [];
  }

  async updateField(model: ModelName, rowId: number, field: string, value: string): Promise<void> {
    this.calls.push({ model, rowId, field, value });
    const row = (this.data[model] ?? []).find((r) => r.id === rowId);
    if (row) row.value = value;
  }
}
