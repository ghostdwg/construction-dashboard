// Storage inventory / journaled path backfill — shared types.
//
// This tool is a NEW layer ON TOP of the five already-reviewed, independently
// shipped "storage-path compatibility" modules:
//   - lib/services/specbook/storagePath.ts      (SpecBook.filePath, SpecSection.pdfPath — scoped by bidId)
//   - lib/services/drawings/storagePath.ts       (DrawingUpload.filePath — scoped by bidId)
//   - lib/services/estimates/storagePath.ts      (EstimateUpload.rawFilePath — scoped by bidId+subcontractorId)
//   - lib/services/addendums/storagePath.ts      (AddendumUpload.storageKey — scoped by bidId)
//   - lib/services/meetings/storagePath.ts       (Meeting.audioStorageKey — scoped by meetingId)
// It never reimplements path-shape recognition — see classify.ts, which
// dispatches to each domain's existing `classify*StoragePath()` pure
// function. This module only defines the shared vocabulary: model/field
// identity, the DB adapter interface, row/report/journal shapes.
//
// IMPORTANT SCOPE NOTE: this tool never imports or calls BlobStore
// (getBlobStore/localPathForKey), never performs network/provider calls, and
// never connects to a real database. See lib/services/storageInventory/index.ts
// for the full "why" and grep-verifiable proof of this.

/** The six model/field pairs this tool knows how to inventory. */
export type ModelName =
  | "SpecBook"
  | "SpecSection"
  | "DrawingUpload"
  | "EstimateUpload"
  | "AddendumUpload"
  | "Meeting";

/**
 * The 4 fields whose "legacy-storage-root" rows are eligible for a future
 * (or this tool's gated) DB-only conversion to their derived canonical key.
 */
export const TRANSFORMABLE_MODELS: readonly ModelName[] = [
  "SpecBook",
  "SpecSection",
  "DrawingUpload",
  "EstimateUpload",
] as const;

/**
 * The 2 fields this tool only ever reports on — never converts, in any mode,
 * full stop. Most existing rows are null today (the columns are newly added).
 */
export const INVENTORY_ONLY_MODELS: readonly ModelName[] = ["AddendumUpload", "Meeting"] as const;

/** The exact DB column each model's classifiable field lives in. */
export const MODEL_FIELD: Record<ModelName, string> = {
  SpecBook: "filePath",
  SpecSection: "pdfPath",
  DrawingUpload: "filePath",
  EstimateUpload: "rawFilePath",
  AddendumUpload: "storageKey",
  Meeting: "audioStorageKey",
};

export function isTransformableModel(model: ModelName): boolean {
  return (TRANSFORMABLE_MODELS as ModelName[]).includes(model);
}

/**
 * One DB row's classifiable value, plus whatever scope identifiers its
 * domain's classify function needs. A given adapter implementation only ever
 * needs to populate the fields relevant to the model it's returning rows
 * for:
 *   - SpecBook, SpecSection, DrawingUpload, AddendumUpload: `bidId`
 *   - EstimateUpload: `bidId` AND `subcontractorId`
 *   - Meeting: none — the row's own `id` IS the scope (see
 *     lib/services/meetings/storagePath.ts's module header)
 *
 * `value` is `string | null` uniformly (rather than only for the two
 * inventory-only fields) because SpecSection.pdfPath is ALSO nullable in the
 * real schema today (a section that hasn't been split/paginated yet has no
 * pdfPath) — every existing SpecSection.pdfPath consumer in this codebase
 * (see app/api/bids/[id]/specbook/gaps/route.ts, .../submittals/packages/route.ts)
 * already filters on `pdfPath !== null` before treating it as a storage
 * reference. Rather than special-case that one field, every model uniformly
 * reports a `null` bucket; for SpecBook/DrawingUpload/EstimateUpload (whose
 * columns are non-nullable in the schema) that bucket is simply always 0.
 */
export type StorageInventoryRow = {
  id: number;
  value: string | null;
  bidId?: number;
  subcontractorId?: number;
};

/**
 * Adapter seam between this tool's pure logic and a real data source.
 * Production code can wire a thin real-Prisma implementation of this
 * interface later (not built here — see index.ts's header note); tests
 * inject an in-memory fake with fixture rows, never a live/file-based DB.
 */
export type StorageInventoryDbAdapter = {
  findRows(model: ModelName): Promise<StorageInventoryRow[]>;
  updateField(model: ModelName, rowId: number, field: string, value: string): Promise<void>;
};

/** One row's classification bucket, mirroring the four shapes the underlying classifiers recognize, plus "null" for a missing/not-yet-populated value. */
export type ClassificationBucket = "canonical" | "legacy-cwd" | "legacy-storage-root" | "invalid" | "null";

export type RowClassification = {
  model: ModelName;
  rowId: number;
  bucket: ClassificationBucket;
  /**
   * True iff this row is BOTH a transformable-model row AND classified
   * "legacy-storage-root" — i.e. the only condition under which this tool's
   * apply mode will ever touch it. Always false for AddendumUpload/Meeting,
   * even when their own classifier independently reports
   * "legacy-storage-root" — those two fields are inventory-only in this
   * tool, full stop, in every mode.
   */
  convertible: boolean;
  /** Present only when bucket is "canonical" or "legacy-storage-root". Never surfaced in the aggregate report — journal-only. */
  canonicalKey?: string;
};

/** Per-model aggregate counts. No raw paths, filenames, or record content — counts and labels only. */
export type AggregateModelBucket = {
  total: number;
  canonical: number;
  legacyCwd: number;
  /** Total rows classified "legacy-storage-root" by the domain classifier, regardless of whether this tool treats them as convertible. */
  legacyStorageRoot: number;
  /**
   * Subset of `legacyStorageRoot` this tool would convert in apply mode.
   * Always equal to `legacyStorageRoot` for the 4 transformable models
   * (every "legacy-storage-root" classification already proves the exact,
   * bid/record-scoped production shape — see classify.ts) and always 0 for
   * AddendumUpload/Meeting (inventory-only, never converted).
   */
  legacyStorageRootConvertible: number;
  invalid: number;
  /** Rows whose value is null (missing key / not yet populated). */
  null: number;
};

export type InventoryReport = {
  generatedAt: string;
  models: Record<ModelName, AggregateModelBucket>;
};

/** One journal entry per mutation actually performed in apply mode. Operator-facing audit artifact — the ONLY place before/after path values are ever written by this tool (never to stdout/aggregate report). */
export type JournalEntry = {
  model: string;
  rowId: number;
  field: string;
  before: string;
  after: string;
  timestamp: string;
  toolVersion: string;
};

/** Fixed tool version stamped into every journal entry. */
export const TOOL_VERSION = "1.0.0";

/**
 * The exact confirmation phrase apply mode requires IN ADDITION TO --apply
 * before it will perform any write. Deliberately long, shouty, and specific
 * to this operation so it can't be pasted/typed accidentally — chosen so a
 * plain "--apply" (or "--apply --confirm yes") never satisfies the gate.
 */
export const CONFIRM_PHRASE = "I UNDERSTAND THIS WRITES TO THE DATABASE";
