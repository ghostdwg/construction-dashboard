#!/usr/bin/env -S node --import=tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/specbook-legacy-fixture.ts
//
//  Staging-only CLI: creates and later cleans up ONE exact, disposable,
//  production-shaped Spec Book fixture (one SpecBook + one SpecSection row,
//  each pointing at a real BlobStore-backed synthetic PDF, laid out under the
//  storage root exactly the way production's upload route + sidecar splitter
//  actually write — see lib/services/specbook/storagePath.ts's
//  "legacy-storage-root" shape). Built to let the staging reconciliation
//  rehearsal exercise the full sequence:
//
//      inventory -> apply -> reversal -> compatibility read/serve (via the
//      existing Spec Book routes) -> delete -> cleanup
//
//  against a real, disposable row, without ever touching a real bid's data.
//
//  FUTURE DEPLOYMENT (this file ships inside the staging app container image;
//  it is not runnable from a developer's own machine against staging):
//
//    docker exec neuroglitch-staging-app-1 npx tsx scripts/specbook-legacy-fixture.ts \
//      --seed --bid-id <n> --confirm "I UNDERSTAND THIS WRITES A SPEC BOOK FIXTURE"
//
//    docker exec neuroglitch-staging-app-1 npx tsx scripts/specbook-legacy-fixture.ts \
//      --cleanup --bid-id <n> --confirm "I UNDERSTAND THIS WRITES A SPEC BOOK FIXTURE"
//
//  THIS IS NOT A PRODUCTION TOOL. It refuses to run unless process.env.APP_ENV
//  is exactly "staging" (checked at runtime, below) and unless the target Bid
//  is the one specific, unmistakable fixture Bid (see FIXTURE_BID_NAME). It
//  must NEVER be run against a production APP_ENV or database.
//
//  Modes:
//    (default / --dry-run)   Print a plan. Zero Prisma/BlobStore calls, ever.
//    --seed --bid-id <n> --confirm "<phrase>"     Create the fixture rows.
//    --cleanup --bid-id <n> --confirm "<phrase>"  Remove the fixture rows.
//
//  Exit codes:
//    0   dry-run / success
//    1   bad inputs / gate refusal (no mutation attempted or completed)
//    2   unexpected failure mid-action
//
//  Output discipline: never prints document bytes/text, raw storage paths
//  (absolute or relative — not even in the dry-run plan), credentials, or the
//  actual value of process.env.APP_ENV. Safe numeric ids/counts only.
//
//  Imports beyond Node builtins: @/lib/prisma, @/lib/storage/blobStore (incl.
//  its safeBlobFileName export), and @/lib/services/specbook/storagePath
//  (classifyStoragePath — the existing, already-reviewed classifier, reused
//  as-is for --cleanup's shape check; never reimplemented here). Nothing
//  under app/api/** is imported or referenced anywhere in this file, no
//  fetch/sidecar/provider/job-creation code path is reachable.
// ──────────────────────────────────────────────────────────────────────────────

import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/prisma";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { classifyStoragePath } from "@/lib/services/specbook/storagePath";

/**
 * The one specific, unmistakable Bid this tool will ever touch. Deliberately
 * exact-match only (no trimming, no case-insensitivity) — a near-miss is
 * refused, not coerced.
 */
export const FIXTURE_BID_NAME = "FIXTURE PROD-SHAPE — DELETE ME";

/**
 * The exact confirmation phrase this tool's --seed/--cleanup gate requires.
 * Deliberately distinct from the storage-inventory tool's own phrase
 * ("I UNDERSTAND THIS WRITES TO THE DATABASE" — see
 * lib/services/storageInventory/types.ts's CONFIRM_PHRASE) so an operator
 * running either tool can never satisfy the wrong one's gate by copy/paste
 * mistake.
 */
export const CONFIRM_PHRASE = "I UNDERSTAND THIS WRITES A SPEC BOOK FIXTURE";

const PREFIX = "[specbook-legacy-fixture]";

function log(msg: string): void {
  console.log(`${PREFIX} ${msg}`);
}

function err(msg: string): void {
  console.error(`${PREFIX} ${msg}`);
}

export type ParsedArgs = {
  seed: boolean;
  cleanup: boolean;
  dryRun: boolean;
  bidId?: number;
  confirm?: string;
  help: boolean;
};

const HELP_TEXT = `
specbook-legacy-fixture — staging-only CLI to seed/clean up one disposable,
production-shaped Spec Book fixture row.

Usage:
  tsx scripts/specbook-legacy-fixture.ts
      Default: print a plan. Cannot write anything.

  tsx scripts/specbook-legacy-fixture.ts --seed --bid-id <n> --confirm "${CONFIRM_PHRASE}"
      Create one SpecBook + one SpecSection row (and their synthetic PDF
      blobs) for the fixture Bid.

  tsx scripts/specbook-legacy-fixture.ts --cleanup --bid-id <n> --confirm "${CONFIRM_PHRASE}"
      Remove the fixture rows/blobs this tool created for the fixture Bid.

Flags:
  --seed                  Seed action flag.
  --cleanup               Cleanup action flag.
  --dry-run               Force plan-only mode even if an action flag is set.
  --bid-id <n>            Required for --seed/--cleanup. Positive integer.
  --confirm "<phrase>"    Required for --seed/--cleanup — must match exactly.
  --help, -h              Print this text and exit.

Requires process.env.APP_ENV === "staging" and the target Bid's projectName
to equal exactly "${FIXTURE_BID_NAME}". Never run against production.
`;

export function parseArgv(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { seed: false, cleanup: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") {
      args.seed = true;
      continue;
    }
    if (a === "--cleanup") {
      args.cleanup = true;
      continue;
    }
    if (a === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (a === "--bid-id") {
      const raw = argv[++i];
      const n = Number(raw);
      args.bidId = raw !== undefined ? n : undefined;
      continue;
    }
    if (a === "--confirm") {
      args.confirm = argv[++i];
      continue;
    }
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
  }
  return args;
}

function printPlan(args: ParsedArgs): void {
  log("DRY RUN — no Prisma or BlobStore calls will be made.");
  const requested = args.seed ? "--seed" : args.cleanup ? "--cleanup" : "(none)";
  log(`  action requested: ${requested}`);
  log(
    "  --seed would: create one SpecBook + one SpecSection row for --bid-id, and write two blobs " +
      "under the uploads/specbooks/{bidId}/... namespace (original + a /sections/ sub-key)."
  );
  log(
    "  --cleanup would: locate SpecBook/SpecSection rows for --bid-id, refuse unless every row " +
      "classifies as legacy-storage-root, then delete their blobs and DB rows."
  );
  log(
    `  To perform a real mutation: pass --seed or --cleanup, --bid-id <n>, --confirm "${CONFIRM_PHRASE}", ` +
      "with APP_ENV=staging and the fixture Bid already in place."
  );
}

type GateResult = { ok: true; bidId: number } | { ok: false; reason: string };

/**
 * All mutation gates, checked cheapest-first, entirely before any Prisma
 * read. Any single failure refuses the whole action.
 */
async function checkGates(args: ParsedArgs, action: "seed" | "cleanup"): Promise<GateResult> {
  if (!args.confirm || args.confirm !== CONFIRM_PHRASE) {
    return { ok: false, reason: "Confirmation phrase missing or incorrect. Refusing to proceed." };
  }

  if (args.bidId === undefined || !Number.isInteger(args.bidId) || args.bidId <= 0) {
    return { ok: false, reason: "A positive integer --bid-id is required." };
  }

  if (process.env.APP_ENV !== "staging") {
    return { ok: false, reason: "APP_ENV check: FAILED (expected staging). Refusing." };
  }
  log("APP_ENV check: PASS");

  const bid = await prisma.bid.findUnique({ where: { id: args.bidId } });
  if (!bid || bid.projectName !== FIXTURE_BID_NAME) {
    return {
      ok: false,
      reason: "Target Bid does not exist or its projectName does not exactly match the required fixture Bid name. Refusing.",
    };
  }

  if (action === "seed") {
    const existing = await prisma.specBook.count({ where: { bidId: args.bidId } });
    if (existing > 0) {
      return {
        ok: false,
        reason: "Target Bid already has existing SpecBook row(s). Refusing to double-seed.",
      };
    }
  }

  return { ok: true, bidId: args.bidId };
}

/** Minimal-but-valid, synthetic, disposable PDF content — never real document bytes. */
function buildSyntheticPdfBuffer(marker: string): Buffer {
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 12 Tf 72 720 Td (${marker}) Tj ET`;
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let body = header;
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + xref + trailer, "latin1");
}

async function doSeed(bidId: number): Promise<void> {
  const storageRoot = process.env.STORAGE_LOCAL_PATH || "/storage";

  const originalSafeName = safeBlobFileName("fixture-original.pdf");
  const originalKey = path.posix.join("uploads", "specbooks", String(bidId), originalSafeName);
  const originalBuffer = buildSyntheticPdfBuffer("FIXTURE SPEC BOOK - SYNTHETIC - DISPOSABLE");

  const blobStore = getBlobStore();
  await blobStore.put(originalKey, originalBuffer);

  const specBook = await prisma.specBook.create({
    data: {
      bidId,
      fileName: originalSafeName,
      filePath: `${storageRoot}/${originalKey}`,
      status: "ready",
    },
  });

  const sectionSafeName = safeBlobFileName("fixture-section.pdf");
  const sectionKey = path.posix.join("uploads", "specbooks", String(bidId), "sections", sectionSafeName);
  const sectionBuffer = buildSyntheticPdfBuffer("FIXTURE SPEC SECTION - SYNTHETIC - DISPOSABLE");

  await blobStore.put(sectionKey, sectionBuffer);

  const specSection = await prisma.specSection.create({
    data: {
      specBookId: specBook.id,
      csiNumber: "00 00 00",
      csiTitle: "Fixture Section",
      pdfPath: `${storageRoot}/${sectionKey}`,
      pdfFileName: sectionSafeName,
    },
  });

  log(`Seed complete. bidId=${bidId} specBookId=${specBook.id} specSectionId=${specSection.id}`);
}

type SpecSectionForCleanup = { id: number; pdfPath: string | null };
type SpecBookForCleanup = { id: number; filePath: string; sections: SpecSectionForCleanup[] };

async function doCleanup(bidId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const specBooks = (await prisma.specBook.findMany({
    where: { bidId },
    include: { sections: true },
  })) as unknown as SpecBookForCleanup[];

  if (specBooks.length === 0) {
    log("No SpecBook rows found for this bidId. Nothing to clean up.");
    return { ok: true };
  }

  // Up-front, whole-cleanup gate: EVERY row this action would touch — the
  // SpecBook itself AND every non-null SpecSection.pdfPath — must classify as
  // legacy-storage-root for this exact bidId. A single mismatch (canonical,
  // legacy-cwd, or invalid) refuses the entire cleanup before any Prisma
  // delete or BlobStore delete call is made — no partial mutation.
  for (const book of specBooks) {
    const classifiedBook = classifyStoragePath(book.filePath, bidId);
    if (classifiedBook.kind !== "legacy-storage-root") {
      return {
        ok: false,
        reason:
          "This Bid does not contain a fixture-shaped SpecBook row — refusing to touch it.",
      };
    }

    for (const section of book.sections) {
      if (section.pdfPath === null) continue;
      const classifiedSection = classifyStoragePath(section.pdfPath, bidId);
      if (classifiedSection.kind !== "legacy-storage-root") {
        return {
          ok: false,
          reason:
            "This Bid does not contain a fixture-shaped SpecSection row — refusing to touch it.",
        };
      }
    }
  }

  const blobStore = getBlobStore();
  let sectionBlobsDeleted = 0;
  let sectionRowsDeleted = 0;
  let bookBlobsDeleted = 0;
  let bookRowsDeleted = 0;

  for (const book of specBooks) {
    for (const section of book.sections) {
      if (section.pdfPath) {
        // Already verified legacy-storage-root above — never a "canonical"
        // (or any other) key. A canonical-key section blob must never be
        // deleted by this tool.
        const classified = classifyStoragePath(section.pdfPath, bidId) as {
          kind: "legacy-storage-root";
          canonicalKey: string;
        };
        await blobStore.delete(classified.canonicalKey);
        sectionBlobsDeleted += 1;
      }
      await prisma.specSection.delete({ where: { id: section.id } });
      sectionRowsDeleted += 1;
    }

    // Already verified legacy-storage-root above.
    const classified = classifyStoragePath(book.filePath, bidId) as { kind: "legacy-storage-root"; canonicalKey: string };
    await blobStore.delete(classified.canonicalKey);
    bookBlobsDeleted += 1;

    await prisma.specBook.delete({ where: { id: book.id } });
    bookRowsDeleted += 1;
  }

  log(
    `Cleanup complete. specBooks=${bookRowsDeleted} specBookBlobs=${bookBlobsDeleted} ` +
      `specSections=${sectionRowsDeleted} specSectionBlobs=${sectionBlobsDeleted}`
  );
  return { ok: true };
}

const MAX_ERROR_DESCRIPTOR_LENGTH = 64;
const ERRNO_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Bounded, path-free failure descriptor: an errno `code` (e.g. "ENOENT"),
 * shape-checked against the standard Node errno-code convention (all
 * uppercase, no path-shaped content possible), or else the thrown value's
 * Error constructor name, or else its `typeof` (a fixed, closed set of
 * strings — "string", "number", "object", etc. — never derived from the
 * value's own content). Never `e.message`, never a stack, never `String(e)` —
 * none of those are safe against an underlying fs/BlobStore error embedding
 * an absolute storage path.
 */
function sanitizeErrorDescriptor(e: unknown): string {
  const code = e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined;
  if (typeof code === "string" && ERRNO_CODE_PATTERN.test(code)) {
    return code.slice(0, MAX_ERROR_DESCRIPTOR_LENGTH);
  }
  if (e instanceof Error) {
    return e.constructor.name.slice(0, MAX_ERROR_DESCRIPTOR_LENGTH);
  }
  return typeof e;
}

export async function runMain(argv: string[]): Promise<number> {
  const args = parseArgv(argv);

  if (args.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  const actionCount = Number(args.seed) + Number(args.cleanup);
  const isDryRun = args.dryRun || actionCount === 0;

  if (isDryRun) {
    printPlan(args);
    return 0;
  }

  if (actionCount !== 1) {
    err("Exactly one of --seed or --cleanup is required (not both).");
    return 1;
  }

  const action: "seed" | "cleanup" = args.seed ? "seed" : "cleanup";

  const gate = await checkGates(args, action);
  if (!gate.ok) {
    err(gate.reason);
    return 1;
  }

  try {
    if (action === "seed") {
      await doSeed(gate.bidId);
      return 0;
    }
    const result = await doCleanup(gate.bidId);
    if (!result.ok) {
      err(result.reason);
      return 1;
    }
    return 0;
  } catch (e) {
    err(`Unexpected failure: ${sanitizeErrorDescriptor(e)}`);
    return 2;
  }
}

// Auto-run when invoked as a script (not when imported by tests) — same
// guard convention as scripts/storage-inventory-backfill.ts.
const invokedAsScript =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  runMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      err(`Unexpected bootstrap failure: ${sanitizeErrorDescriptor(e)}`);
      process.exitCode = 2;
    });
}
