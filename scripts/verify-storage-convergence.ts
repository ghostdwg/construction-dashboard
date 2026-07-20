#!/usr/bin/env tsx

import { pathToFileURL } from "node:url";

type Domain = "drawing" | "addendum" | "meeting";
type Args = {
  execute: boolean;
  domain?: Domain;
  bidId?: number;
  recordId?: number;
};

export function parseArgs(argv: string[]): Args {
  const result: Args = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") result.execute = true;
    else if (arg === "--domain") result.domain = argv[++index] as Domain;
    else if (arg === "--bid-id") result.bidId = Number(argv[++index]);
    else if (arg === "--record-id") result.recordId = Number(argv[++index]);
    else if (arg === "--help") return result;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function usage(): string {
  return [
    "Durable storage convergence verifier (read-only; dry-run by default)",
    "",
    "npm run storage:verify-convergence -- --domain <drawing|addendum|meeting> --bid-id <id> --record-id <id>",
    "npm run storage:verify-convergence -- --execute --domain drawing --bid-id 1 --record-id 9",
    "",
    "--execute performs only scoped database reads and BlobStore get/stat/exists calls.",
    "It never uploads, deletes, migrates, contacts a provider, or recreates a container.",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 2;
  }

  if (
    !args.execute ||
    !args.domain ||
    !Number.isInteger(args.bidId) ||
    !Number.isInteger(args.recordId) ||
    args.bidId! <= 0 ||
    args.recordId! <= 0
  ) {
    console.log(usage());
    console.log("\nDRY RUN — no Prisma or BlobStore calls were made.");
    return args.execute ? 2 : 0;
  }

  const [{ prisma }, blob, drawings, addenda, meetings] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/storage/blobStore"),
    import("@/lib/services/drawings/storagePath"),
    import("@/lib/services/addendums/storagePath"),
    import("@/lib/services/meetings/storagePath"),
  ]);

  const bidId = args.bidId!;
  const recordId = args.recordId!;
  let storageRef: string | null = null;
  let kind: string = "invalid";
  let canonicalKey: string | null = null;

  if (args.domain === "drawing") {
    const row = await prisma.drawingUpload.findFirst({
      where: { id: recordId, bidId },
      select: { filePath: true },
    });
    storageRef = row?.filePath ?? null;
    if (storageRef) {
      const classified = drawings.classifyDrawingStoragePath(storageRef, bidId);
      kind = classified.kind;
      if (classified.kind === "canonical" || classified.kind === "legacy-storage-root") {
        canonicalKey = classified.canonicalKey;
      }
    }
  } else if (args.domain === "addendum") {
    const row = await prisma.addendumUpload.findFirst({
      where: { id: recordId, bidId },
      select: { storageKey: true },
    });
    storageRef = row?.storageKey ?? null;
    if (storageRef) {
      const classified = addenda.classifyAddendumStoragePath(storageRef, bidId);
      kind = classified.kind;
      if (classified.kind === "canonical" || classified.kind === "legacy-storage-root") {
        canonicalKey = classified.canonicalKey;
      }
    }
  } else {
    const row = await prisma.meeting.findFirst({
      where: { id: recordId, bidId },
      select: { audioStorageKey: true },
    });
    storageRef = row?.audioStorageKey ?? null;
    if (storageRef) {
      const classified = meetings.classifyMeetingStoragePath(storageRef, bidId, recordId);
      kind = classified.kind;
      if (classified.kind === "canonical" || classified.kind === "legacy-storage-root") {
        canonicalKey = classified.canonicalKey;
      }
    }
  }

  if (!storageRef || !canonicalKey) {
    console.log(JSON.stringify({ recordFound: Boolean(storageRef), keyShapeValid: false, kind }, null, 2));
    return 1;
  }

  const expectedPrefix =
    args.domain === "drawing"
      ? `plan-room/jobs/${bidId}/drawings/`
      : args.domain === "addendum"
        ? `plan-room/jobs/${bidId}/addenda/`
        : `plan-room/jobs/${bidId}/meetings/${recordId}/`;
  const keyShapeValid = canonicalKey.startsWith(expectedPrefix);
  const before = blob.getBlobStore();
  const existsBeforeRestart = await before.exists(canonicalKey);
  const stat = await before.stat(canonicalKey);
  if (existsBeforeRestart) await before.get(canonicalKey);

  // Process-local singleton recreation only. The durable root/provider and
  // database are untouched; this is safe to run without container churn.
  blob.resetBlobStoreSingleton();
  const after = blob.getBlobStore();
  const existsAfterRestart = await after.exists(canonicalKey);
  if (existsAfterRestart) await after.get(canonicalKey);

  console.log(
    JSON.stringify(
      {
        recordFound: true,
        keyShapeValid,
        kind,
        byteSize: stat?.size ?? null,
        contentType: stat?.contentType ?? null,
        existsBeforeRestart,
        existsAfterRestart,
      },
      null,
      2,
    ),
  );
  return keyShapeValid && existsBeforeRestart && existsAfterRestart ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
