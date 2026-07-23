import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  classifyDrawingStoragePath,
  deleteDrawingStoragePath,
} from "@/lib/services/drawings/storagePath";
import {
  classifyAddendumStoragePath,
  deleteAddendumStoragePath,
} from "@/lib/services/addendums/storagePath";
import {
  classifyStoragePath,
  deleteStoragePath,
} from "@/lib/services/specbook/storagePath";
import {
  classifyMeetingStoragePath,
  deleteMeetingStoragePath,
} from "@/lib/services/meetings/storagePath";
import type { ClassifyResult } from "@/lib/services/storage/legacyPathCompat";

function storageIdentity(ref: string, classified: ClassifyResult): string | null {
  if (classified.kind === "invalid") return null;
  if (classified.kind === "legacy-cwd") return `file:${path.resolve(ref)}`;
  return `blob:${classified.canonicalKey}`;
}

function protectsTarget(
  rowRef: string,
  rowIdentity: string | null,
  targetRef: string,
  targetIdentity: string,
): boolean {
  // Even a malformed/cross-scope durable row is a reference. Exact equality
  // must protect data before any scoped classifier is allowed to reject it.
  if (rowRef === targetRef || rowIdentity === targetIdentity) return true;

  if (targetIdentity.startsWith("file:") && path.isAbsolute(rowRef)) {
    return `file:${path.resolve(rowRef)}` === targetIdentity;
  }
  if (targetIdentity.startsWith("blob:") && path.isAbsolute(rowRef)) {
    const root = path.resolve(process.env.STORAGE_LOCAL_PATH || "/storage");
    const resolved = path.resolve(rowRef);
    if (resolved !== root && resolved.startsWith(root + path.sep)) {
      const relativeKey = path.relative(root, resolved).split(path.sep).join("/");
      return `blob:${relativeKey}` === targetIdentity;
    }
  }
  return false;
}

/**
 * Delete only after an authoritative all-row reference scan proves that no
 * durable record still points at the same underlying object. A failed scan
 * fails closed: callers may log an orphan, but data is never removed on an
 * uncertain reference decision.
 */
export async function deleteDrawingStorageIfUnreferenced(
  ref: string,
  bidId: number,
): Promise<boolean> {
  const target = storageIdentity(ref, classifyDrawingStoragePath(ref, bidId));
  if (!target) return false;
  const references = await prisma.drawingUpload.findMany({
    select: { bidId: true, filePath: true },
  });
  if (
    references.some((row) =>
      protectsTarget(
        row.filePath,
        storageIdentity(
          row.filePath,
          classifyDrawingStoragePath(row.filePath, row.bidId),
        ),
        ref,
        target,
      ),
    )
  ) {
    return false;
  }
  await deleteDrawingStoragePath(ref, bidId);
  return true;
}

export async function deleteAddendumStorageIfUnreferenced(
  ref: string,
  bidId: number,
): Promise<boolean> {
  const target = storageIdentity(ref, classifyAddendumStoragePath(ref, bidId));
  if (!target) return false;
  const references = await prisma.addendumUpload.findMany({
    where: { storageKey: { not: null } },
    select: { bidId: true, storageKey: true },
  });
  if (
    references.some((row) =>
      row.storageKey !== null &&
      protectsTarget(
        row.storageKey,
        storageIdentity(
          row.storageKey,
          classifyAddendumStoragePath(row.storageKey, row.bidId),
        ),
        ref,
        target,
      ),
    )
  ) {
    return false;
  }
  await deleteAddendumStoragePath(ref, bidId);
  return true;
}

export async function deleteSpecStorageIfUnreferenced(
  ref: string,
  bidId: number,
): Promise<boolean> {
  const target = storageIdentity(ref, classifyStoragePath(ref, bidId));
  if (!target) return false;
  const [books, sections, evidence] = await Promise.all([
    prisma.specBook.findMany({ select: { bidId: true, filePath: true } }),
    prisma.specSection.findMany({
      where: { pdfPath: { not: null } },
      select: { pdfPath: true, specBook: { select: { bidId: true } } },
    }),
    prisma.specSectionEvidenceRevision.findMany({
      where: { pdfPath: { not: null } },
      select: { bidId: true, pdfPath: true },
    }),
  ]);
  const references = [
    ...books.map((row) => ({ bidId: row.bidId, ref: row.filePath })),
    ...sections
      .filter((row): row is typeof row & { pdfPath: string } => row.pdfPath !== null)
      .map((row) => ({ bidId: row.specBook.bidId, ref: row.pdfPath })),
    ...evidence
      .filter((row): row is typeof row & { pdfPath: string } => row.pdfPath !== null)
      .map((row) => ({ bidId: row.bidId, ref: row.pdfPath })),
  ];
  if (
    references.some((row) =>
      protectsTarget(
        row.ref,
        storageIdentity(row.ref, classifyStoragePath(row.ref, row.bidId)),
        ref,
        target,
      ),
    )
  ) {
    return false;
  }
  await deleteStoragePath(ref, bidId);
  return true;
}

export async function deleteMeetingStorageIfUnreferenced(
  ref: string,
  bidId: number,
  meetingId: number,
): Promise<boolean> {
  const target = storageIdentity(
    ref,
    classifyMeetingStoragePath(ref, bidId, meetingId),
  );
  if (!target) return false;
  const references = await prisma.meeting.findMany({
    where: { audioStorageKey: { not: null } },
    select: { id: true, bidId: true, audioStorageKey: true },
  });
  if (
    references.some((row) =>
      row.audioStorageKey !== null &&
      protectsTarget(
        row.audioStorageKey,
        storageIdentity(
          row.audioStorageKey,
          classifyMeetingStoragePath(row.audioStorageKey, row.bidId, row.id),
        ),
        ref,
        target,
      ),
    )
  ) {
    return false;
  }
  await deleteMeetingStoragePath(ref, bidId, meetingId);
  return true;
}
