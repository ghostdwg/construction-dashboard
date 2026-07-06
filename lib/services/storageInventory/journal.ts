// Journal — the ONLY place before/after path values are ever written by this
// tool. Written as one JSON-lines file (one JSON object per line) to a
// destination path the caller specifies. Local disk only — no BlobStore, no
// network, no database. This is an operator-facing audit artifact required
// for reversal, distinct from the aggregate report (which never contains raw
// paths).

import fs from "fs/promises";
import path from "path";
import type { JournalEntry } from "@/lib/services/storageInventory/types";

/**
 * Refuse to proceed at all if the journal destination isn't writable. Called
 * BEFORE any DB write in apply mode (see apply.ts) — fails closed with a
 * clear error rather than performing conversions with nowhere safe to record
 * them. Ensures the parent directory exists and that the file itself can be
 * opened for append (creating it if absent) WITHOUT truncating any existing
 * journal content.
 */
export async function assertJournalWritable(journalPath: string): Promise<void> {
  const resolved = path.resolve(journalPath);
  const dir = path.dirname(resolved);
  try {
    await fs.mkdir(dir, { recursive: true });
    const handle = await fs.open(resolved, "a");
    await handle.close();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[storage-inventory] Journal destination is not writable: ${resolved} (${detail}). Refusing to perform any conversion.`
    );
  }
}

/** Append entries to the journal file, one JSON object per line. No-op for an empty list — never creates/touches the file if there is nothing to write. */
export async function appendJournalEntries(journalPath: string, entries: JournalEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await fs.appendFile(path.resolve(journalPath), lines, "utf8");
}

/** Read and parse a JSON-lines journal file, in file order. Blank lines are skipped. */
export async function readJournalEntries(journalPath: string): Promise<JournalEntry[]> {
  const content = await fs.readFile(path.resolve(journalPath), "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalEntry);
}
