import { prisma } from "@/lib/prisma";
import type { Actor, ServiceResult } from "./types";
import { emitTradeAudits, writeTradeAuditTx } from "./txAudit";
import { authorizeTokenTx } from "./packages";

export async function getInternalAttachmentTarget(
  bidId: number,
  packageId: number,
  packageItemId: number,
  revisionId: number
) {
  return prisma.tradeResponseRevision.findFirst({
    where: {
      id: revisionId,
      bidId,
      packageItemId,
      packageItem: { packageId, bidId, package: { bidId } },
    },
    select: { id: true },
  });
}

export async function preflightExternalAttachmentTarget(
  rawToken: string,
  packageItemId: number,
  revisionId: number
): Promise<ServiceResult<{ bidId: number; packageId: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const auth = await authorizeTokenTx(tx, rawToken, "response_access_token_attachment_preflight");
    if (!auth) return null;
    const revision = await tx.tradeResponseRevision.findFirst({
      where: {
        id: revisionId,
        bidId: auth.token.bidId,
        packageItemId,
        packageItem: {
          packageId: auth.token.packageId,
          bidId: auth.token.bidId,
          package: { bidId: auth.token.bidId, status: { in: ["ISSUED", "RESPONSES_IN", "GC_REVIEW"] } },
        },
      },
      select: { id: true },
    });
    return revision ? { auth } : null;
  });
  if (!committed) return { ok: false, error: "Not found" };
  emitTradeAudits(committed.auth.audit);
  return {
    ok: true,
    value: { bidId: committed.auth.token.bidId, packageId: committed.auth.token.packageId },
  };
}

type AttachmentMeta = { storageKey: string; fileName: string; mimeType: string; byteSize: number };

export async function recordInternalResponseAttachment(
  bidId: number,
  packageId: number,
  packageItemId: number,
  revisionId: number,
  meta: AttachmentMeta,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const revision = await tx.tradeResponseRevision.findFirst({
      where: {
        id: revisionId,
        bidId,
        packageItemId,
        packageItem: { packageId, bidId, package: { bidId } },
      },
      select: { id: true },
    });
    if (!revision) return { error: "Not found" as const };
    const attachment = await tx.tradeResponseAttachment.create({
      data: { responseRevisionId: revisionId, bidId, ...meta },
      select: { id: true },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: "trade_response_attachment_create",
      subjectKind: "TradeResponseAttachment",
      subjectId: attachment.id,
      bidId,
      actor,
      payload: { packageId, packageItemId, revisionId, mimeType: meta.mimeType, byteSize: meta.byteSize },
    });
    return { attachment, audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: committed.attachment };
}

export async function recordExternalResponseAttachment(
  rawToken: string,
  packageItemId: number,
  revisionId: number,
  meta: AttachmentMeta
): Promise<ServiceResult<{ id: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const auth = await authorizeTokenTx(tx, rawToken, "response_access_token_attachment_upload");
    if (!auth) return null;
    const revision = await tx.tradeResponseRevision.findFirst({
      where: {
        id: revisionId,
        bidId: auth.token.bidId,
        packageItemId,
        packageItem: {
          packageId: auth.token.packageId,
          bidId: auth.token.bidId,
          // Repeat the active-package predicate after blob write so a state
          // transition between preflight and metadata commit fails closed.
          package: { bidId: auth.token.bidId, status: { in: ["ISSUED", "RESPONSES_IN", "GC_REVIEW"] } },
        },
      },
      select: { id: true },
    });
    if (!revision) return { auth, attachment: null, audit: null };
    const attachment = await tx.tradeResponseAttachment.create({
      data: { responseRevisionId: revisionId, bidId: auth.token.bidId, ...meta },
      select: { id: true },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: "trade_response_attachment_create",
      subjectKind: "TradeResponseAttachment",
      subjectId: attachment.id,
      bidId: auth.token.bidId,
      actor: null,
      payload: {
        packageId: auth.token.packageId,
        packageItemId,
        revisionId,
        mimeType: meta.mimeType,
        byteSize: meta.byteSize,
      },
    });
    return { auth, attachment, audit };
  });
  if (!committed) return { ok: false, error: "Not found" };
  if (!committed.attachment || !committed.audit) {
    emitTradeAudits(committed.auth.audit);
    return { ok: false, error: "Not found" };
  }
  emitTradeAudits([committed.auth.audit, committed.audit]);
  return { ok: true, value: committed.attachment };
}

export async function findInternalResponseAttachment(
  bidId: number,
  packageId: number,
  packageItemId: number,
  revisionId: number,
  attachmentId: number
) {
  return prisma.tradeResponseAttachment.findFirst({
    where: {
      id: attachmentId,
      bidId,
      responseRevisionId: revisionId,
      responseRevision: {
        bidId,
        packageItemId,
        packageItem: { packageId, bidId, package: { bidId } },
      },
    },
  });
}

export async function findExternalResponseAttachment(
  rawToken: string,
  attachmentId: number
): Promise<ServiceResult<{ storageKey: string; fileName: string; mimeType: string; byteSize: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const auth = await authorizeTokenTx(tx, rawToken, "response_access_token_attachment_download");
    if (!auth) return null;
    const attachment = await tx.tradeResponseAttachment.findFirst({
      where: {
        id: attachmentId,
        bidId: auth.token.bidId,
        responseRevision: {
          bidId: auth.token.bidId,
          packageItem: {
            bidId: auth.token.bidId,
            packageId: auth.token.packageId,
            package: { bidId: auth.token.bidId },
          },
        },
      },
      select: { storageKey: true, fileName: true, mimeType: true, byteSize: true },
    });
    return { auth, attachment };
  });
  if (!committed) return { ok: false, error: "Not found" };
  emitTradeAudits(committed.auth.audit);
  return committed.attachment
    ? { ok: true, value: committed.attachment }
    : { ok: false, error: "Not found" };
}
