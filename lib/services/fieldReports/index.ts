// lib/services/fieldReports/index.ts
//
// Module OPS2 (Slice 2) — Field Report source-document service. Reports are
// EVIDENCE, not a second tracker: operations items created from a report are
// TrackedItem rows on the shared spine (see createItemFromFieldReport in
// lib/services/trackedItems). This module NEVER: calls a provider, runs
// OCR/AI extraction, auto-creates items on upload, calls Procore, or sends
// anything. parseStatus stays "UNPARSED" in V0 — no code path changes it.

import { prisma } from "@/lib/prisma";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function listFieldReports(bidId: number) {
  return prisma.fieldReport.findMany({
    where: { bidId },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { trackedItems: true } } },
  });
}

export async function getFieldReport(bidId: number, fieldReportId: number) {
  return prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    include: {
      trackedItems: {
        select: { id: true, title: true, status: true, kind: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export interface CreateFieldReportInput {
  title: string;
  reportDate?: Date | null;
  authorName?: string | null;
}

export async function createFieldReport(
  bidId: number,
  input: CreateFieldReportInput
): Promise<ServiceResult<{ id: number }>> {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title is required" };

  const created = await prisma.fieldReport.create({
    data: {
      bidId,
      title: title.slice(0, 300),
      reportDate: input.reportDate ?? null,
      authorName: input.authorName?.trim() || null,
      parseStatus: "UNPARSED",
    },
    select: { id: true },
  });
  return { ok: true, value: created };
}

export interface UpdateFieldReportInput {
  title?: string;
  reportDate?: Date | null;
  authorName?: string | null;
}

export async function updateFieldReport(
  bidId: number,
  fieldReportId: number,
  patch: UpdateFieldReportInput
): Promise<ServiceResult<{ id: number }>> {
  const report = await prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    select: { id: true },
  });
  if (!report) return { ok: false, error: "Not found" };
  if (patch.title !== undefined && !patch.title.trim()) {
    return { ok: false, error: "title cannot be empty" };
  }

  await prisma.fieldReport.update({
    where: { id: fieldReportId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 300) } : {}),
      ...(patch.reportDate !== undefined ? { reportDate: patch.reportDate } : {}),
      ...(patch.authorName !== undefined
        ? { authorName: patch.authorName?.trim() || null }
        : {}),
    },
  });
  return { ok: true, value: { id: fieldReportId } };
}

/** Bid-scoped existence probe — the upload route enforces tenancy BEFORE any
 *  blob byte is written (Slice 1 ordering contract). */
export async function fieldReportExists(bidId: number, fieldReportId: number): Promise<boolean> {
  const report = await prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    select: { id: true },
  });
  return report !== null;
}

export interface ReportFileMetaInput {
  storageKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
}

/** Record the uploaded source file's metadata — called ONLY after the blob
 *  write succeeded (Slice 1 ordering contract; the route cleans up the blob
 *  if this fails). Re-uploading replaces the metadata; the previous blob (if
 *  any, under a different safe filename) is reported back for the route to
 *  clean up. */
export async function recordReportFile(
  bidId: number,
  fieldReportId: number,
  meta: ReportFileMetaInput
): Promise<ServiceResult<{ id: number; previousStorageKey: string | null }>> {
  const report = await prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    select: { id: true, sourceFileStorageKey: true },
  });
  if (!report) return { ok: false, error: "Not found" };

  await prisma.fieldReport.update({
    where: { id: fieldReportId },
    data: {
      sourceFileStorageKey: meta.storageKey,
      originalFileName: meta.fileName,
      mimeType: meta.mimeType,
      byteSize: meta.byteSize,
    },
  });

  const previous =
    report.sourceFileStorageKey && report.sourceFileStorageKey !== meta.storageKey
      ? report.sourceFileStorageKey
      : null;
  return { ok: true, value: { id: fieldReportId, previousStorageKey: previous } };
}
