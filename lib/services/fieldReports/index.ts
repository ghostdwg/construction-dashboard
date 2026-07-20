// lib/services/fieldReports/index.ts
//
// Module OPS2 (Slice 2) — Field Report source-document service. Reports are
// EVIDENCE, not a second tracker: operations items created from a report are
// TrackedItem rows on the shared spine (see createItemFromFieldReport in
// lib/services/trackedItems). This module NEVER: calls a provider, runs
// OCR/AI extraction, auto-creates items on upload, calls Procore, or sends
// anything. parseStatus stays "UNPARSED" in V0 — no code path changes it.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  emitOperationsAuditPostCommit,
  writeOperationsAuditTx,
} from "@/lib/services/operationsAudit";

type Actor = { id?: string | null; email?: string | null } | null;

async function auditFieldReportTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  action: string,
  bidId: number,
  reportId: number,
  actor: Actor,
  payload: Record<string, unknown>
) {
  return writeOperationsAuditTx(tx, {
    action,
    decision: "committed",
    subjectKind: "FieldReport",
    subjectId: reportId,
    actor,
    payload: { bidId, ...payload },
  });
}

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
  input: CreateFieldReportInput,
  actor: Actor = null
): Promise<ServiceResult<{ id: number }>> {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title is required" };

  let envelope: AuditEnvelope | null = null;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.fieldReport.create({
      data: {
        bidId,
        title: title.slice(0, 300),
        reportDate: input.reportDate ?? null,
        authorName: input.authorName?.trim() || null,
        parseStatus: "UNPARSED",
      },
      select: { id: true },
    });
    envelope = await auditFieldReportTx(tx, "field_report_create", bidId, row.id, actor, {
      hasReportDate: Boolean(input.reportDate),
    });
    return row;
  });
  emitOperationsAuditPostCommit(envelope);
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
  patch: UpdateFieldReportInput,
  actor: Actor = null
): Promise<ServiceResult<{ id: number }>> {
  if (patch.title !== undefined && !patch.title.trim()) {
    return { ok: false, error: "title cannot be empty" };
  }
  const report = await prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    select: { id: true },
  });
  if (!report) return { ok: false, error: "Not found" };

  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.fieldReport.update({
      where: { id: fieldReportId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 300) } : {}),
        ...(patch.reportDate !== undefined ? { reportDate: patch.reportDate } : {}),
        ...(patch.authorName !== undefined
          ? { authorName: patch.authorName?.trim() || null }
          : {}),
      },
    });
    envelope = await auditFieldReportTx(tx, "field_report_update", bidId, fieldReportId, actor, {
      changedFields: Object.keys(patch).sort(),
    });
  });
  emitOperationsAuditPostCommit(envelope);
  return { ok: true, value: { id: fieldReportId } };
}

export const FIELD_REPORT_FILE_REFERENCED_ERROR =
  "Field report evidence is referenced and cannot be replaced";
export const FIELD_REPORT_FILE_CONCURRENT_ERROR =
  "Field report file changed during upload; retry against the current file";

export type FieldReportFileMutationState = {
  expectedStorageKey: string | null;
};

/**
 * Bid-scoped preflight used before multipart parsing or blob writes. This is
 * deliberately repeated transactionally by recordReportFile: the preflight
 * avoids needless byte work, while the compare-and-swap is authoritative.
 * Both Build 1 tracked-item citations and Build 2 observations freeze the
 * pointer because either can carry a durable locator into these bytes.
 */
export async function getFieldReportFileMutationState(
  bidId: number,
  fieldReportId: number,
): Promise<ServiceResult<FieldReportFileMutationState>> {
  const report = await prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    select: {
      sourceFileStorageKey: true,
      _count: { select: { observations: true, trackedItems: true } },
    },
  });
  if (!report) return { ok: false, error: "Not found" };
  if (report._count.observations > 0 || report._count.trackedItems > 0) {
    return { ok: false, error: FIELD_REPORT_FILE_REFERENCED_ERROR };
  }
  return {
    ok: true,
    value: { expectedStorageKey: report.sourceFileStorageKey },
  };
}

export interface ReportFileMetaInput {
  storageKey: string;
  expectedStorageKey: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
}

/** Record the uploaded source file's metadata — called ONLY after the blob
 * write succeeded. The pointer update is a bid-scoped compare-and-swap which
 * succeeds only while no durable citation exists. Metadata, provenance, and
 * mandatory audit commit together. On any non-success the caller may delete
 * only meta.storageKey, which is not referenced by database state. */
export async function recordReportFile(
  bidId: number,
  fieldReportId: number,
  meta: ReportFileMetaInput,
  actor: Actor = null
): Promise<ServiceResult<{ id: number; previousStorageKey: string | null }>> {
  let envelope: AuditEnvelope | null = null;
  const committed = await prisma.$transaction(async (tx) => {
    const report = await tx.fieldReport.findFirst({
      where: { id: fieldReportId, bidId },
      select: {
        sourceFileStorageKey: true,
        _count: { select: { observations: true, trackedItems: true } },
      },
    });
    if (!report) return { ok: false as const, error: "Not found" };
    if (report._count.observations > 0 || report._count.trackedItems > 0) {
      return { ok: false as const, error: FIELD_REPORT_FILE_REFERENCED_ERROR };
    }
    if (report.sourceFileStorageKey !== meta.expectedStorageKey) {
      return { ok: false as const, error: FIELD_REPORT_FILE_CONCURRENT_ERROR };
    }

    const claimed = await tx.fieldReport.updateMany({
      where: {
        id: fieldReportId,
        bidId,
        sourceFileStorageKey: meta.expectedStorageKey,
        observations: { none: {} },
        trackedItems: { none: {} },
      },
      data: {
        sourceFileStorageKey: meta.storageKey,
        originalFileName: meta.fileName,
        mimeType: meta.mimeType,
        byteSize: meta.byteSize,
      },
    });
    if (claimed.count !== 1) {
      const current = await tx.fieldReport.findFirst({
        where: { id: fieldReportId, bidId },
        select: {
          sourceFileStorageKey: true,
          _count: { select: { observations: true, trackedItems: true } },
        },
      });
      if (!current) return { ok: false as const, error: "Not found" };
      if (current._count.observations > 0 || current._count.trackedItems > 0) {
        return { ok: false as const, error: FIELD_REPORT_FILE_REFERENCED_ERROR };
      }
      return { ok: false as const, error: FIELD_REPORT_FILE_CONCURRENT_ERROR };
    }

    envelope = await auditFieldReportTx(
      tx,
      "field_report_file_recorded",
      bidId,
      fieldReportId,
      actor,
      {
        mimeType: meta.mimeType,
        byteSize: meta.byteSize,
        fileName: meta.fileName,
        previousStorageKey: report.sourceFileStorageKey,
        storageKey: meta.storageKey,
        replacement: report.sourceFileStorageKey !== null,
      },
    );
    return {
      ok: true as const,
      value: {
        id: fieldReportId,
        previousStorageKey:
          report.sourceFileStorageKey !== meta.storageKey
            ? report.sourceFileStorageKey
            : null,
      },
    };
  });
  if (!committed.ok) return committed;
  emitOperationsAuditPostCommit(envelope);
  return committed;
}
