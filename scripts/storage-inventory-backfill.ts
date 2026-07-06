#!/usr/bin/env -S node --import=tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/storage-inventory-backfill.ts
//
//  Inventory + journaled, gated conversion CLI for the storage-path
//  compatibility classifiers (SpecBook.filePath, SpecSection.pdfPath,
//  DrawingUpload.filePath, EstimateUpload.rawFilePath, AddendumUpload.storageKey,
//  Meeting.audioStorageKey). See lib/services/storageInventory/index.ts for
//  the full design and scope guarantees (no BlobStore call, no network call,
//  no real DB connection built into this tool).
//
//  Modes:
//    (default)                     Inventory report. ALWAYS safe — cannot
//                                  write anything, regardless of other flags.
//    --apply --confirm "<phrase>"  Convert "legacy-storage-root" rows on the
//      --journal <path>            4 transformable models to their canonical
//                                  key. BOTH --apply and the exact phrase
//                                  (see CONFIRM_PHRASE in types.ts) are
//                                  required — --apply alone behaves exactly
//                                  like inventory mode (report-only, zero
//                                  writes). --journal is required whenever
//                                  --apply is passed (even if the phrase is
//                                  wrong) since apply.ts's gate check needs
//                                  a destination to reason about.
//    --reverse --journal <path>    Read a journal file and undo its
//                                  conversions (idempotent — safe to re-run).
//
//  Real-DB wiring: when this file is actually invoked as a script (the
//  `invokedAsScript` guard at the bottom of this file), it lazily
//  `import()`s the real Prisma-backed adapter
//  (lib/services/storageInventory/prismaAdapter.ts) and passes it into
//  runMain() — that dynamic import is the ONLY path by which this tool ever
//  touches Prisma or a real database. Statically importing this module (as
//  every test does) never reaches Prisma: nothing above this point imports
//  `@/lib/prisma` or the adapter module. Every code path is exercised in
//  tests via an injected in-memory fake adapter (see scripts/__tests__/
//  storage-inventory-backfill.test.ts), never a live/file-based DB.
// ──────────────────────────────────────────────────────────────────────────────

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInventoryReport,
  formatReport,
  runApply,
  runReversal,
  CONFIRM_PHRASE,
  type StorageInventoryDbAdapter,
} from "@/lib/services/storageInventory";

export type ParsedArgs = {
  apply: boolean;
  reverse: boolean;
  confirm?: string;
  journalPath?: string;
  help: boolean;
};

const HELP_TEXT = `
storage-inventory-backfill — inventory + gated conversion for storage-path
compatibility classifiers.

Usage:
  tsx scripts/storage-inventory-backfill.ts
      Default: inventory report only. Cannot write anything.

  tsx scripts/storage-inventory-backfill.ts --apply --confirm "${CONFIRM_PHRASE}" --journal <path>
      Convert eligible ("legacy-storage-root") rows on the 4 transformable
      models to their canonical key. Requires BOTH --apply and the exact
      confirmation phrase above, plus a writable --journal destination.
      Missing the phrase (or passing --apply alone) performs zero writes and
      behaves exactly like inventory mode.

  tsx scripts/storage-inventory-backfill.ts --reverse --journal <path>
      Undo conversions recorded in a journal file. Idempotent — safe to
      run more than once against the same journal.

Flags:
  --apply                 Explicit mutation flag (not sufficient alone).
  --confirm "<phrase>"    Required alongside --apply — must match exactly.
  --reverse               Reversal mode.
  --journal <path>        Journal file path (required for --apply/--reverse).
  --help, -h              Print this text and exit.
`;

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { apply: false, reverse: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      args.apply = true;
      continue;
    }
    if (a === "--reverse") {
      args.reverse = true;
      continue;
    }
    if (a === "--confirm") {
      args.confirm = argv[++i];
      continue;
    }
    if (a === "--journal") {
      args.journalPath = argv[++i];
      continue;
    }
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
  }
  return args;
}

/**
 * Fallback used only when `runMain()` is called directly with no adapter
 * injected and NOT via this file's real (invoked-as-script) execution path —
 * i.e. a caller bypassed both the test convention (inject a fake adapter)
 * and the real CLI entrypoint (which lazily wires the real Prisma-backed
 * adapter — see prismaAdapter.ts and the `invokedAsScript` block below).
 * Throws immediately rather than silently doing nothing or attempting a
 * real connection from here.
 */
function unimplementedAdapter(): StorageInventoryDbAdapter {
  const fail = (): never => {
    throw new Error(
      "[storage-inventory] No production database adapter is wired up automatically for a direct " +
        "runMain() call. Either pass one via runMain(argv, { adapter }) (tests: inject a fake adapter; " +
        "real runs: invoke this file as a script, which lazily wires " +
        "lib/services/storageInventory/prismaAdapter.ts)."
    );
  };
  return {
    findRows: () => fail(),
    updateField: () => fail(),
  };
}

export type RunMainDeps = {
  adapter?: StorageInventoryDbAdapter;
  /** Injectable clock — defaults to the real ISO timestamp. Tests pass a fixed value. */
  now?: () => string;
};

export async function runMain(argv: string[] = process.argv.slice(2), deps: RunMainDeps = {}): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const adapter = deps.adapter ?? unimplementedAdapter();
  const now = deps.now ?? (() => new Date().toISOString());

  if (args.reverse) {
    if (!args.journalPath) {
      console.error("[storage-inventory] --journal <path> is required with --reverse.");
      process.exitCode = 1;
      return;
    }
    const result = await runReversal(adapter, args.journalPath);
    console.log(
      `[storage-inventory] Reversal complete: ${result.reverted} reverted, ${result.skipped} skipped (already at target state or unrelated).`
    );
    return;
  }

  if (args.apply) {
    if (!args.journalPath) {
      console.error("[storage-inventory] --journal <path> is required with --apply.");
      process.exitCode = 1;
      return;
    }
    const gateSatisfied = args.confirm === CONFIRM_PHRASE;
    if (!gateSatisfied) {
      console.log(
        `[storage-inventory] --apply requires --confirm "${CONFIRM_PHRASE}" exactly — refusing to write. Running in inventory (report-only) mode instead.`
      );
    }
    const result = await runApply(adapter, {
      apply: args.apply,
      confirmPhrase: args.confirm,
      journalPath: args.journalPath,
      now: now(),
    });
    console.log(formatReport(result.report));
    if (result.applied.length > 0) {
      console.log(`\n[storage-inventory] Applied ${result.applied.length} conversion(s). Journal: ${args.journalPath}`);
    } else if (gateSatisfied) {
      console.log("\n[storage-inventory] Nothing to convert — no eligible (legacy-storage-root) rows found.");
    }
    return;
  }

  // Default: inventory mode. Cannot write anything.
  const report = await buildInventoryReport(adapter, now());
  console.log(formatReport(report));
}

// Auto-run when invoked as a script (not when imported by tests) — same
// guard convention as scripts/specbook-staging-smoke.mjs / scripts/cron-loop.mjs.
const invokedAsScript =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  // Real execution path ONLY: lazily `import()` the real Prisma-backed
  // adapter and inject it explicitly, rather than letting runMain() fall
  // back to unimplementedAdapter(). This dynamic import is the single place
  // in this whole tool where Prisma (or any DB connection) is ever reached —
  // it never executes when this module is merely imported (by tests or
  // anything else), only when the file is invoked directly as a script.
  (async () => {
    const { createPrismaStorageInventoryAdapter } = await import(
      "@/lib/services/storageInventory/prismaAdapter"
    );
    await runMain(process.argv.slice(2), { adapter: createPrismaStorageInventoryAdapter() });
  })().catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
}
