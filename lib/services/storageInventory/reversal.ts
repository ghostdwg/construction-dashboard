// Reversal mode — given a journal file, undo each conversion it recorded by
// writing `field = before` back. DB-only, no BlobStore/network call.
//
// Idempotency contract (documented here since it's a judgment call): for
// each journal entry, this reads the row's CURRENT value before writing —
// never blindly overwrites based on journal content alone — and:
//   - skips (no write, no error) if the current value already equals
//     `entry.before` — nothing to undo, already reverted (or never
//     converted in the first place);
//   - otherwise, only proceeds to write `entry.before` if the current value
//     equals `entry.after` exactly — i.e. the row is still in the exact
//     post-conversion state this journal entry describes;
//   - otherwise (current value is neither `before` nor `after`) skips —
//     something else changed this row since the conversion; reversal must
//     never stomp on an unrelated, later change based solely on a stale
//     journal entry.
// Running reversal twice against the same journal is therefore always safe:
// the second pass finds every row already at `entry.before` and skips all of
// them.

import { readJournalEntries } from "@/lib/services/storageInventory/journal";
import {
  TRANSFORMABLE_MODELS,
  type ModelName,
  type StorageInventoryDbAdapter,
} from "@/lib/services/storageInventory/types";

export type ReversalResult = {
  reverted: number;
  skipped: number;
};

export async function runReversal(
  adapter: StorageInventoryDbAdapter,
  journalPath: string
): Promise<ReversalResult> {
  const entries = await readJournalEntries(journalPath);
  let reverted = 0;
  let skipped = 0;

  // Cache one findRows() call per model per reversal run (a journal may
  // contain many entries for the same model) — re-fetched fresh for each
  // reversal invocation so a second run always sees the true current state.
  const rowsByModel = new Map<ModelName, Awaited<ReturnType<StorageInventoryDbAdapter["findRows"]>>>();

  for (const entry of entries) {
    const model = entry.model as ModelName;

    // Defense in depth: this tool never journals AddendumUpload/Meeting
    // entries in the first place (they are inventory-only, never converted),
    // but reversal still refuses to act on them even if a journal were
    // hand-edited to include one.
    if (!(TRANSFORMABLE_MODELS as ModelName[]).includes(model)) {
      skipped += 1;
      continue;
    }

    if (!rowsByModel.has(model)) {
      rowsByModel.set(model, await adapter.findRows(model));
    }
    const rows = rowsByModel.get(model)!;
    const row = rows.find((r) => r.id === entry.rowId);

    if (!row) {
      skipped += 1; // row no longer exists — nothing to revert
      continue;
    }

    if (row.value === entry.before) {
      skipped += 1; // already reverted (or never converted) — idempotent no-op
      continue;
    }

    if (row.value !== entry.after) {
      skipped += 1; // something else changed this row since conversion — never overwrite blindly
      continue;
    }

    await adapter.updateField(model, entry.rowId, entry.field, entry.before);
    // Reflect the write in our local cache so a later entry in the SAME
    // reversal run for the same row (shouldn't normally happen, but is safe
    // to handle) sees the updated value rather than a stale cached one.
    row.value = entry.before;
    reverted += 1;
  }

  return { reverted, skipped };
}
