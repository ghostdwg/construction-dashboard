// lib/services/consultantReports/index.ts
//
// Module OPS3 (Phase 1A) — Consultant Reports service: report/revision
// identity, upload transaction with content-hash duplicate detection, void
// (status flip), and listing. Reports received FROM consultants are
// EVIDENCE — items created from their observations land on the shared
// TrackedItem spine (see ./observations.ts). This module NEVER: parses,
// extracts, OCRs, calls a provider, auto-creates items, hard-deletes
// anything, or accepts a client-supplied storage key. Every consequential
// mutation emits a DB-persisted "consultant_report" AuditEvent (best-effort:
// an audit failure is logged, never allowed to fail the user's action).

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import { consultantReportStorageKey } from "./storagePath";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Actor {
  name?: string | null;
  email?: string | null;
}

export function actorLabel(actor: Actor | null | undefined): string | null {
  const label = actor?.email?.trim() || actor?.name?.trim();
  return label || null;
}

// Fixed category vocabulary — consultant's own titles stay metadata only.
export const CONSULTANT_REPORT_TYPES = [
  "ARCHITECT_FIELD_REPORT",
  "ENGINEER_FIELD_REPORT",
  "COMMISSIONING_REPORT",
  "TESTING_INSPECTION_REPORT",
  "OTHER_CONSULTANT_REPORT",
] as const;
export type ConsultantReportType = (typeof CONSULTANT_REPORT_TYPES)[number];

export function isConsultantReportType(value: unknown): value is ConsultantReportType {
  return (
    typeof value === "string" &&
    (CONSULTANT_REPORT_TYPES as readonly string[]).includes(value)
  );
}

const MAX_TEXT_FIELD = 300;

export async function audit(
  action: string,
  bidId: number,
  subject: { kind: string; id: string },
  actor: Actor | null | undefined,
  decision: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await emitAuditEvent({
      category: "consultant_report",
      action,
      severity: "NOTICE",
      decision,
      subject,
      actor: {
        kind: "operator",
        userId: null,
        email: actor?.email ?? null,
      },
      // ids/hashes/sizes/bounded metadata ONLY — never report text, PDF
      // bytes, or formal-response text (see ./formalResponse.ts for the
      // stdout-safe variant that carries bounded prior/new values).
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[consultant-reports] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ── Upload (new report identity + revision 0) ────────────────────────────────

export interface UploadConsultantReportInput {
  vendorName: string;
  title?: string | null;
  reportNumber?: string | null;
  reportType: string;
  reportDate?: Date | null;
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
}

export type UploadOutcome =
  | { kind: "created"; reportId: number; revisionId: number }
  | { kind: "duplicate"; reportId: number; revisionId: number };

/** Caller (route) has already validated MIME + magic bytes + size. Order:
 *  duplicate check → blob write (content-addressed, pre-metadata) →
 *  transaction inserting report + revision 0. A failed metadata write
 *  leaves only a content-addressed orphan blob, which the next attempt of
 *  the same bytes reuses — retriable, never a dangling metadata row. */
export async function uploadConsultantReport(
  bidId: number,
  input: UploadConsultantReportInput,
  actor: Actor,
  putBlob: (key: string, bytes: Buffer) => Promise<void>
): Promise<ServiceResult<UploadOutcome>> {
  const vendorName = input.vendorName?.trim();
  if (!vendorName) return { ok: false, error: "vendorName is required" };
  if (!isConsultantReportType(input.reportType)) {
    return {
      ok: false,
      error: `Unknown reportType — allowed: ${CONSULTANT_REPORT_TYPES.join(", ")}`,
    };
  }

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return { ok: false, error: "Not found" };

  const checksum = sha256Hex(input.bytes);

  // Same bytes in the same bid → the existing report, never a silent
  // re-store, never an unexplained block.
  const existing = await prisma.consultantReportRevision.findFirst({
    where: { bidId, checksum },
    select: { id: true, reportId: true },
  });
  if (existing) {
    await audit(
      "report_duplicate_detected",
      bidId,
      { kind: "ConsultantReport", id: String(existing.reportId) },
      actor,
      "duplicate_returned",
      { checksum, revisionId: existing.id, byteSize: input.bytes.byteLength }
    );
    return {
      ok: true,
      value: { kind: "duplicate", reportId: existing.reportId, revisionId: existing.id },
    };
  }

  const storedKey = consultantReportStorageKey(bidId, checksum);
  await putBlob(storedKey, input.bytes);

  const reportNumber = input.reportNumber?.trim() || null;
  const created = await prisma.$transaction(async (tx) => {
    const report = await tx.consultantReport.create({
      data: {
        bidId,
        vendorName: vendorName.slice(0, MAX_TEXT_FIELD),
        title: input.title?.trim().slice(0, MAX_TEXT_FIELD) || null,
        reportNumber,
        reportNumberNormalized: reportNumber ? reportNumber.toLowerCase() : null,
        reportType: input.reportType,
        reportDate: input.reportDate ?? null,
        uploadedBy: actorLabel(actor),
      },
      select: { id: true },
    });
    const revision = await tx.consultantReportRevision.create({
      data: {
        reportId: report.id,
        bidId,
        revisionIndex: 0,
        storedKey,
        originalFilename: input.originalFilename.slice(0, MAX_TEXT_FIELD),
        fileSizeBytes: input.bytes.byteLength,
        mimeType: input.mimeType,
        checksum,
        uploadedBy: actorLabel(actor),
      },
      select: { id: true },
    });
    return { reportId: report.id, revisionId: revision.id };
  });

  await audit(
    "report_uploaded",
    bidId,
    { kind: "ConsultantReport", id: String(created.reportId) },
    actor,
    "created",
    {
      checksum,
      revisionId: created.revisionId,
      byteSize: input.bytes.byteLength,
      reportType: input.reportType,
    }
  );

  return { ok: true, value: { kind: "created", ...created } };
}

// ── Corrected revision (same report identity, new file) ─────────────────────

export interface UploadRevisionInput {
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
  replacementReason?: string | null;
}

export async function uploadCorrectedRevision(
  bidId: number,
  reportId: number,
  input: UploadRevisionInput,
  actor: Actor,
  putBlob: (key: string, bytes: Buffer) => Promise<void>
): Promise<ServiceResult<UploadOutcome>> {
  const report = await prisma.consultantReport.findFirst({
    where: { id: reportId, bidId },
    select: { id: true, status: true },
  });
  if (!report) return { ok: false, error: "Not found" };
  if (report.status === "VOIDED") {
    return { ok: false, error: "Report is voided — corrected files cannot be added" };
  }

  const checksum = sha256Hex(input.bytes);
  const existing = await prisma.consultantReportRevision.findFirst({
    where: { bidId, checksum },
    select: { id: true, reportId: true },
  });
  if (existing) {
    await audit(
      "report_duplicate_detected",
      bidId,
      { kind: "ConsultantReport", id: String(existing.reportId) },
      actor,
      "duplicate_returned",
      { checksum, revisionId: existing.id, byteSize: input.bytes.byteLength }
    );
    return {
      ok: true,
      value: { kind: "duplicate", reportId: existing.reportId, revisionId: existing.id },
    };
  }

  const latest = await prisma.consultantReportRevision.findFirst({
    where: { reportId, bidId },
    orderBy: { revisionIndex: "desc" },
    select: { id: true, revisionIndex: true },
  });
  if (!latest) return { ok: false, error: "Report has no revisions" };

  const storedKey = consultantReportStorageKey(bidId, checksum);
  await putBlob(storedKey, input.bytes);

  const revision = await prisma.consultantReportRevision.create({
    data: {
      reportId,
      bidId,
      revisionIndex: latest.revisionIndex + 1,
      storedKey,
      originalFilename: input.originalFilename.slice(0, MAX_TEXT_FIELD),
      fileSizeBytes: input.bytes.byteLength,
      mimeType: input.mimeType,
      checksum,
      uploadedBy: actorLabel(actor),
      replacementReason: input.replacementReason?.trim().slice(0, MAX_TEXT_FIELD) || null,
      supersedesRevisionId: latest.id, // set-once; @unique guards a second superseder
    },
    select: { id: true },
  });

  await audit(
    "revision_superseded",
    bidId,
    { kind: "ConsultantReport", id: String(reportId) },
    actor,
    "revision_added",
    {
      checksum,
      revisionId: revision.id,
      supersedesRevisionId: latest.id,
      byteSize: input.bytes.byteLength,
    }
  );

  return { ok: true, value: { kind: "created", reportId, revisionId: revision.id } };
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function listConsultantReports(bidId: number) {
  return prisma.consultantReport.findMany({
    where: { bidId },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    include: {
      revisions: {
        orderBy: { revisionIndex: "desc" },
        select: {
          id: true,
          revisionIndex: true,
          originalFilename: true,
          fileSizeBytes: true,
          uploadedAt: true,
        },
      },
      _count: { select: { observations: true } },
    },
  });
}

export async function getConsultantReport(bidId: number, reportId: number) {
  return prisma.consultantReport.findFirst({
    where: { id: reportId, bidId },
    include: {
      revisions: {
        orderBy: { revisionIndex: "desc" },
        select: {
          id: true,
          revisionIndex: true,
          originalFilename: true,
          fileSizeBytes: true,
          uploadedAt: true,
          uploadedBy: true,
          replacementReason: true,
          supersedesRevisionId: true,
        },
      },
      observations: {
        orderBy: { createdAt: "asc" },
        include: {
          registerItem: {
            select: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
              formalResponse: true,
              formalResponseBy: true,
              formalResponseAt: true,
            },
          },
        },
      },
    },
  });
}

/** Resolve the revision to serve — the latest by default, or an explicit
 *  revision that MUST belong to this report and bid (ids only; the storage
 *  key always comes from the tenancy-checked DB row, never the client). */
export async function resolveServableRevision(
  bidId: number,
  reportId: number,
  revisionId?: number | null
) {
  const report = await prisma.consultantReport.findFirst({
    where: { id: reportId, bidId },
    select: { id: true },
  });
  if (!report) return null;
  return prisma.consultantReportRevision.findFirst({
    where: {
      reportId,
      bidId,
      ...(revisionId != null ? { id: revisionId } : {}),
    },
    orderBy: { revisionIndex: "desc" },
    select: {
      id: true,
      storedKey: true,
      originalFilename: true,
      mimeType: true,
      fileSizeBytes: true,
    },
  });
}

// ── Void (status flip — never a delete) ──────────────────────────────────────

export async function voidConsultantReport(
  bidId: number,
  reportId: number,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const report = await prisma.consultantReport.findFirst({
    where: { id: reportId, bidId },
    select: { id: true, status: true },
  });
  if (!report) return { ok: false, error: "Not found" };
  if (report.status === "VOIDED") return { ok: false, error: "Report is already voided" };

  await prisma.consultantReport.update({
    where: { id: reportId },
    data: { status: "VOIDED", voidedBy: actorLabel(actor), voidedAt: new Date() },
  });
  await audit(
    "report_voided",
    bidId,
    { kind: "ConsultantReport", id: String(reportId) },
    actor,
    "voided",
    {}
  );
  return { ok: true, value: { id: reportId } };
}
