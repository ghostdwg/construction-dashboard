// Apply (conversion) mode — gated behind TWO things: an explicit `apply`
// flag AND the exact CONFIRM_PHRASE. Without BOTH, this behaves exactly like
// inventory mode: it still computes and returns the same read-only report,
// but performs zero `adapter.updateField` calls and never touches the
// journal, regardless of what else is passed.
//
// When gated, this processes ONLY rows classified "legacy-storage-root" on
// one of the 4 transformable models (SpecBook, SpecSection, DrawingUpload,
// EstimateUpload) — never legacy-cwd, invalid, or already-canonical rows,
// and never AddendumUpload/Meeting at all. It is a pure DB-value rewrite:
// `UPDATE <model> SET <field> = <canonicalKey> WHERE id = <rowId>` via the
// adapter — no BlobStore call, no filesystem move, no network call. The
// underlying domain classifier already proved the file is physically located
// at the path the canonical key addresses; this only corrects the DB's
// address for it.

import { classifyInventoryRow } from "@/lib/services/storageInventory/classify";
import { buildInventoryReport } from "@/lib/services/storageInventory/report";
import { assertJournalWritable, appendJournalEntries } from "@/lib/services/storageInventory/journal";
import {
  CONFIRM_PHRASE,
  TOOL_VERSION,
  TRANSFORMABLE_MODELS,
  MODEL_FIELD,
  type InventoryReport,
  type JournalEntry,
  type StorageInventoryDbAdapter,
} from "@/lib/services/storageInventory/types";

export type ApplyOptions = {
  /** Explicit mutation flag. Not sufficient on its own — see confirmPhrase. */
  apply: boolean;
  /** Must equal CONFIRM_PHRASE exactly for any write to occur. */
  confirmPhrase?: string;
  /** Destination path for the JSON-lines journal. Required whenever a write could occur. */
  journalPath: string;
  /** Caller-supplied ISO timestamp — never Date.now()/new Date() inside this module, so tests can supply a fixed value. */
  now: string;
};

export type ApplyResult = {
  /** True iff both gates (apply flag + exact confirm phrase) were satisfied. */
  gated: boolean;
  /** The same read-only aggregate report inventory mode would have produced — computed either way. */
  report: InventoryReport;
  /** Journal entries for conversions actually performed. Empty when not gated. */
  applied: JournalEntry[];
};

/**
 * Run apply mode. When the two gates are not BOTH satisfied, this is
 * provably a no-write inventory run: it returns the same report inventory
 * mode would, with `applied: []`, and never calls `adapter.updateField` or
 * touches the journal at all.
 */
export async function runApply(adapter: StorageInventoryDbAdapter, options: ApplyOptions): Promise<ApplyResult> {
  const gated = options.apply === true && options.confirmPhrase === CONFIRM_PHRASE;

  if (!gated) {
    // Exactly inventory mode: read-only report, zero writes, journal never touched.
    const report = await buildInventoryReport(adapter, options.now);
    return { gated: false, report, applied: [] };
  }

  // Fail closed BEFORE any row conversion if the journal destination isn't writable.
  await assertJournalWritable(options.journalPath);

  const applied: JournalEntry[] = [];

  for (const model of TRANSFORMABLE_MODELS) {
    const rows = await adapter.findRows(model);
    for (const row of rows) {
      const classification = classifyInventoryRow(model, row);
      if (!classification.convertible) continue; // never touches legacy-cwd, invalid, canonical, or non-transformable rows

      const field = MODEL_FIELD[model];
      const before = row.value as string; // convertible implies a non-null string value
      const after = classification.canonicalKey as string;

      // Defensive no-op guard: a row already at its canonical value would
      // have classified "canonical", not "legacy-storage-root", so this
      // should be unreachable in practice — kept as a belt-and-suspenders
      // idempotency check, never a silent overwrite of identical values.
      if (before === after) continue;

      await adapter.updateField(model, row.id, field, after);
      applied.push({
        model,
        rowId: row.id,
        field,
        before,
        after,
        timestamp: options.now,
        toolVersion: TOOL_VERSION,
      });
    }
  }

  await appendJournalEntries(options.journalPath, applied);

  // Build the report AFTER conversions so the returned report reflects
  // post-apply state (previously-convertible rows now show as canonical).
  const report = await buildInventoryReport(adapter, options.now);

  return { gated: true, report, applied };
}
