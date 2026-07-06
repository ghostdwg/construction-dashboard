// Storage inventory / journaled path backfill tool — public API.
//
// PURPOSE: a NEW layer on top of the five already-reviewed, independently
// shipped storage-path compatibility classifiers (specbook/drawings/
// estimates/addendums/meetings `storagePath.ts`, built on the shared
// factory lib/services/storage/legacyPathCompat.ts). This tool never
// reimplements path-shape recognition — see classify.ts, which dispatches to
// each domain's existing `classify*StoragePath()` pure function.
//
// SCOPE (verified true of every file in this directory):
//   - No BlobStore call anywhere: nothing here imports
//     `@/lib/storage/blobStore` at all, directly or transitively through its
//     own exports — the domain storagePath.ts modules import
//     getBlobStore/localPathForKey for their I/O helpers
//     (resolveLocalPath/readBuffer/deletePath/storagePathExists), but THIS
//     tool only ever imports the pure, synchronous `classify*` functions
//     from those modules, never the I/O helpers.
//   - No fetch/http/https/network call anywhere.
//   - No real database connection FROM THIS FILE OR ANY OTHER MODULE IN THIS
//     DIRECTORY EXCEPT prismaAdapter.ts: all DB access goes through
//     `StorageInventoryDbAdapter` (see types.ts). The real Prisma-backed
//     implementation lives in lib/services/storageInventory/prismaAdapter.ts
//     — the ONE sanctioned DB boundary — and is never imported from here (or
//     from classify/report/apply/journal/reversal), only lazily `import()`ed
//     by the CLI's real (invoked-as-script) execution path (see
//     scripts/storage-inventory-backfill.ts). Tests inject an in-memory
//     fake adapter, never a live/file-based DB.
//   - Inventory mode (buildInventoryReport) never calls
//     `adapter.updateField` — structurally incapable of writing anything.
//   - Apply mode (runApply) calls `adapter.updateField` ONLY for rows
//     classified "legacy-storage-root" on one of the 4 transformable
//     models, and ONLY when both the `apply` flag and the exact
//     CONFIRM_PHRASE are supplied together.
//   - AddendumUpload/Meeting are inventory-only in every mode, full stop —
//     `adapter.updateField` is never called for them anywhere in this tool.

export * from "@/lib/services/storageInventory/types";
export { classifyInventoryRow } from "@/lib/services/storageInventory/classify";
export { buildInventoryReport, formatReport } from "@/lib/services/storageInventory/report";
export { assertJournalWritable, appendJournalEntries, readJournalEntries } from "@/lib/services/storageInventory/journal";
export { runApply, type ApplyOptions, type ApplyResult } from "@/lib/services/storageInventory/apply";
export { runReversal, type ReversalResult } from "@/lib/services/storageInventory/reversal";
