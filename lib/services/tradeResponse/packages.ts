import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  GC_REVIEW_STATES,
  MANUAL_CHANNELS,
  PACKAGE_STATUSES,
  RESPONSE_CHANNELS,
  RESPONSE_TYPES,
  actorLabel,
  cleanText,
  includes,
  isValidOptionalDate,
  type Actor,
  type ServiceResult,
} from "./types";
import { emitTradeAudits, writeTradeAuditTx } from "./txAudit";

export function hashResponseToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function mintRawResponseToken(): string {
  return randomBytes(32).toString("base64url");
}

export const ACTIVE_EXTERNAL_PACKAGE_STATUSES = ["ISSUED", "RESPONSES_IN", "GC_REVIEW"] as const;
const UNIQUE_RETRY_LIMIT = 5;

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "P2002" || (typeof candidate.message === "string" && /unique constraint/i.test(candidate.message));
}

async function withUniqueRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < UNIQUE_RETRY_LIMIT; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isUniqueConflict(error) || attempt === UNIQUE_RETRY_LIMIT - 1) throw error;
      await Promise.resolve();
    }
  }
  throw new Error("Unreachable bounded retry state");
}

function isValidTokenRow(token: { expiresAt: Date; revokedAt: Date | null; package: { status: string } } | null, now: Date): boolean {
  return Boolean(
    token &&
    !token.revokedAt &&
    token.expiresAt.getTime() > now.getTime() &&
    ACTIVE_EXTERNAL_PACKAGE_STATUSES.includes(token.package.status as typeof ACTIVE_EXTERNAL_PACKAGE_STATUSES[number])
  );
}

export function derivePackageDisplayStatus(input: {
  status: string;
  responseDueDate: Date | null;
  itemCount: number;
  respondedItemCount: number;
}, now = new Date()): string {
  if (
    input.status === "ISSUED" &&
    input.responseDueDate &&
    input.responseDueDate.getTime() < now.getTime() &&
    input.respondedItemCount < input.itemCount
  ) {
    return input.respondedItemCount === 0 ? "NO_RESPONSE" : "OVERDUE";
  }
  return input.status;
}

export async function listResponsePackages(bidId: number) {
  const packages = await prisma.responsePackage.findMany({
    where: { bidId },
    orderBy: { packageNumber: "desc" },
    include: {
      contractor: { select: { id: true, company: true } },
      items: { select: { id: true, responses: { select: { id: true }, take: 1 } } },
      tokens: { where: { revokedAt: null }, select: { id: true, expiresAt: true } },
    },
  });
  return packages.map((pkg) => {
    const respondedItemCount = pkg.items.filter((item) => item.responses.length > 0).length;
    return {
      ...pkg,
      displayStatus: derivePackageDisplayStatus({
        status: pkg.status,
        responseDueDate: pkg.responseDueDate,
        itemCount: pkg.items.length,
        respondedItemCount,
      }),
      itemCount: pkg.items.length,
      respondedItemCount,
      hasActiveToken: pkg.tokens.some((token) => token.expiresAt.getTime() > Date.now()),
      items: undefined,
      tokens: undefined,
    };
  });
}

export async function getResponsePackage(bidId: number, packageId: number) {
  const pkg = await prisma.responsePackage.findFirst({
    where: { id: packageId, bidId },
    include: {
      contractor: { select: { id: true, company: true } },
      items: {
        where: { bidId },
        orderBy: { id: "asc" },
        include: {
          trackedItem: {
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              sourceLocator: true,
              dueDate: true,
              consultantDiscipline: true,
              gcInternalResponsibility: true,
            },
          },
          responses: {
            orderBy: { revisionIndex: "asc" },
            include: { attachments: { orderBy: { id: "asc" } } },
          },
        },
      },
      tokens: {
        orderBy: { createdAt: "desc" },
        select: { id: true, contractorEmail: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true },
      },
    },
  });
  if (!pkg) return null;
  const respondedItemCount = pkg.items.filter((item) => item.responses.length > 0).length;
  return {
    ...pkg,
    displayStatus: derivePackageDisplayStatus({
      status: pkg.status,
      responseDueDate: pkg.responseDueDate,
      itemCount: pkg.items.length,
      respondedItemCount,
    }),
  };
}

export async function createResponsePackage(
  bidId: number,
  input: { title: string; contractorId?: number | null; responseDueDate?: Date | null },
  actor: Actor
): Promise<ServiceResult<{ id: number; packageNumber: number }>> {
  const title = cleanText(input.title, 300);
  if (!title) return { ok: false, error: "title is required" };
  if (!isValidOptionalDate(input.responseDueDate)) return { ok: false, error: "Invalid response due date" };
  const committed = await withUniqueRetry(() => prisma.$transaction(async (tx) => {
    if (input.contractorId) {
      const contractor = await tx.bidInviteSelection.findFirst({
        where: { bidId, subcontractorId: input.contractorId },
        select: { id: true },
      });
      if (!contractor) return { error: "Not found" as const };
    }
    const max = await tx.responsePackage.aggregate({ where: { bidId }, _max: { packageNumber: true } });
    const packageNumber = (max._max.packageNumber ?? 0) + 1;
    const pkg = await tx.responsePackage.create({
      data: {
        bidId,
        packageNumber,
        title,
        contractorId: input.contractorId ?? null,
        responseDueDate: input.responseDueDate ?? null,
        createdBy: actorLabel(actor),
      },
      select: { id: true, packageNumber: true },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: "response_package_create",
      subjectKind: "ResponsePackage",
      subjectId: pkg.id,
      bidId,
      actor,
      payload: { packageNumber, contractorId: input.contractorId ?? null, hasDueDate: Boolean(input.responseDueDate) },
    });
    return { pkg, audit };
  }));
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: committed.pkg };
}

export async function changePackageItem(
  bidId: number,
  packageId: number,
  input: { action: string; trackedItemId: number; displayNumber?: string | null },
  actor: Actor
): Promise<ServiceResult<{ packageItemId?: number }>> {
  if (input.action !== "ADD" && input.action !== "REMOVE") {
    return { ok: false, error: "Invalid package item action" };
  }
  const committed = await prisma.$transaction(async (tx) => {
    const pkg = await tx.responsePackage.findFirst({ where: { id: packageId, bidId }, select: { id: true, status: true } });
    if (!pkg) return { error: "Not found" as const };
    if (pkg.status !== "DRAFT") return { error: "Package membership is frozen after issue" as const };
    if (input.action === "ADD") {
      const item = await tx.trackedItem.findFirst({ where: { id: input.trackedItemId, bidId }, select: { id: true } });
      if (!item) return { error: "Not found" as const };
      const packageItem = await tx.responsePackageItem.create({
        data: {
          packageId,
          bidId,
          trackedItemId: item.id,
          displayNumber: cleanText(input.displayNumber, 100),
        },
        select: { id: true },
      });
      const audit = await writeTradeAuditTx(tx, {
        action: "response_package_item_add",
        subjectKind: "ResponsePackage",
        subjectId: packageId,
        bidId,
        actor,
        payload: { packageItemId: packageItem.id, trackedItemId: item.id, hasDisplayNumber: Boolean(input.displayNumber) },
      });
      return { packageItem, audit };
    }
    const packageItem = await tx.responsePackageItem.findFirst({
      where: { packageId, bidId, trackedItemId: input.trackedItemId },
      select: { id: true },
    });
    if (!packageItem) return { error: "Not found" as const };
    await tx.responsePackageItem.delete({ where: { id: packageItem.id } });
    const audit = await writeTradeAuditTx(tx, {
      action: "response_package_item_remove",
      subjectKind: "ResponsePackage",
      subjectId: packageId,
      bidId,
      actor,
      payload: { packageItemId: packageItem.id, trackedItemId: input.trackedItemId },
    });
    return { packageItem: undefined, audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { packageItemId: committed.packageItem?.id } };
}

export async function issueResponsePackage(
  bidId: number,
  packageId: number,
  input: {
    delivery: string;
    contractorEmail?: string | null;
    expiresAt?: Date | null;
    manualChannel?: string | null;
  },
  actor: Actor
): Promise<ServiceResult<{ rawToken?: string; expiresAt?: Date }>> {
  if (input.delivery !== "PORTAL" && input.delivery !== "MANUAL") {
    return { ok: false, error: "Invalid delivery mechanism" };
  }
  if (input.delivery === "PORTAL" && input.manualChannel != null) {
    return { ok: false, error: "Portal delivery cannot record a manual channel" };
  }
  if (input.delivery === "MANUAL" && (input.expiresAt != null || input.contractorEmail != null)) {
    return { ok: false, error: "Manual delivery cannot include portal credential fields" };
  }
  const now = new Date();
  const rawToken = input.delivery === "PORTAL" ? mintRawResponseToken() : undefined;
  const tokenHash = rawToken ? hashResponseToken(rawToken) : undefined;
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (input.delivery === "PORTAL" && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000)) {
    return { ok: false, error: "Token expiry must be within 90 days" };
  }
  if (input.delivery === "MANUAL" && !input.manualChannel) return { ok: false, error: "manualChannel is required" };
  if (input.manualChannel && !includes(MANUAL_CHANNELS, input.manualChannel)) return { ok: false, error: "Invalid manual channel" };

  const committed = await prisma.$transaction(async (tx) => {
    const pkg = await tx.responsePackage.findFirst({
      where: { id: packageId, bidId },
      include: { _count: { select: { items: true } } },
    });
    if (!pkg) return { error: "Not found" as const };
    if (pkg.status !== "DRAFT") return { error: "Only DRAFT packages may be issued" as const };
    if (pkg._count.items < 1) return { error: "Package requires at least one item" as const };
    if (!pkg.contractorId && input.delivery !== "MANUAL") {
      return { error: "Internal package requires a recorded manual channel" as const };
    }
    const audits: AuditEnvelope[] = [];
    let tokenId: string | null = null;
    const claimed = await tx.responsePackage.updateMany({
      where: { id: packageId, bidId, status: "DRAFT" },
      data: {
        status: "ISSUED",
        issuedAt: now,
        issuedBy: actorLabel(actor),
        manualChannel: input.delivery === "MANUAL" ? input.manualChannel : null,
      },
    });
    if (claimed.count !== 1) return { error: "Package state changed; retry" as const };
    if (tokenHash) {
      const token = await tx.responseAccessToken.create({
        data: {
          bidId,
          packageId,
          tokenHash,
          contractorEmail: cleanText(input.contractorEmail, 320),
          expiresAt,
          createdBy: actorLabel(actor),
        },
        select: { id: true },
      });
      tokenId = token.id;
      audits.push(await writeTradeAuditTx(tx, {
        action: "response_access_token_mint",
        subjectKind: "ResponseAccessToken",
        subjectId: token.id,
        bidId,
        actor,
        payload: { packageId, expiresAt: expiresAt.toISOString(), hasContractorEmail: Boolean(input.contractorEmail) },
      }));
    }
    audits.push(await writeTradeAuditTx(tx, {
      action: "response_package_issue",
      subjectKind: "ResponsePackage",
      subjectId: packageId,
      bidId,
      actor,
      decision: "ISSUED",
      payload: { delivery: input.delivery, tokenId, manualChannel: input.delivery === "MANUAL" ? input.manualChannel : null },
    }));
    return { audits };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audits);
  return rawToken
    ? { ok: true, value: { rawToken, expiresAt } }
    : { ok: true, value: {} };
}

export async function rotateResponsePackageToken(
  bidId: number,
  packageId: number,
  input: { contractorEmail?: string | null; expiresAt?: Date | null },
  actor: Actor
): Promise<ServiceResult<{ rawToken: string; expiresAt: Date }>> {
  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: "Token expiry must be within 90 days" };
  }
  const rawToken = mintRawResponseToken();
  const tokenHash = hashResponseToken(rawToken);
  const committed = await prisma.$transaction(async (tx) => {
    const pkg = await tx.responsePackage.findFirst({
      where: { id: packageId, bidId },
      select: { id: true, status: true, contractorId: true },
    });
    if (!pkg || !["ISSUED", "RESPONSES_IN", "GC_REVIEW"].includes(pkg.status)) {
      return { error: "Not found" as const };
    }
    if (!pkg.contractorId) return { error: "Internal package cannot use a portal token" as const };
    const revoked = await tx.responseAccessToken.updateMany({
      where: { packageId, bidId, revokedAt: null },
      data: { revokedAt: now },
    });
    const token = await tx.responseAccessToken.create({
      data: {
        bidId,
        packageId,
        tokenHash,
        contractorEmail: cleanText(input.contractorEmail, 320),
        expiresAt,
        createdBy: actorLabel(actor),
      },
      select: { id: true },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: "response_access_token_rotate",
      subjectKind: "ResponseAccessToken",
      subjectId: token.id,
      bidId,
      actor,
      payload: {
        packageId,
        revokedCount: revoked.count,
        expiresAt: expiresAt.toISOString(),
        hasContractorEmail: Boolean(input.contractorEmail),
      },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  // This is the sole return of the raw credential; only its SHA-256 digest was committed.
  return { ok: true, value: { rawToken, expiresAt } };
}

export async function revokePackageTokens(
  bidId: number,
  packageId: number,
  actor: Actor
): Promise<ServiceResult<{ revokedCount: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const pkg = await tx.responsePackage.findFirst({ where: { id: packageId, bidId }, select: { id: true } });
    if (!pkg) return { error: "Not found" as const };
    const result = await tx.responseAccessToken.updateMany({
      where: { packageId, bidId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: "response_access_token_revoke",
      subjectKind: "ResponsePackage",
      subjectId: packageId,
      bidId,
      actor,
      payload: { revokedCount: result.count },
    });
    return { count: result.count, audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { revokedCount: committed.count } };
}

type ResponseInput = {
  responderName: string;
  responderCompany?: string | null;
  channel: string;
  responseType: string;
  responseText: string;
  proposedCompletionDate?: Date | null;
  actualCompletionDate?: Date | null;
};

function validateResponseInput(input: ResponseInput): string | null {
  if (!includes(RESPONSE_CHANNELS, input.channel)) return "Invalid response channel";
  if (!includes(RESPONSE_TYPES, input.responseType)) return "Invalid response type";
  if (!isValidOptionalDate(input.proposedCompletionDate) || !isValidOptionalDate(input.actualCompletionDate)) return "Invalid response date";
  if (input.responseType === "PROPOSED_DATE" && !input.proposedCompletionDate) return "Proposed completion date is required";
  if (!cleanText(input.responderName, 300) || !cleanText(input.responseText, 20_000)) return "Responder name and response text are required";
  return null;
}

async function appendResponseTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    bidId: number;
    packageId: number;
    packageItemId: number;
    input: ResponseInput;
    enteredBy: string | null;
    actor: Actor | null;
  }
) {
  const packageItem = await tx.responsePackageItem.findFirst({
    where: { id: args.packageItemId, packageId: args.packageId, bidId: args.bidId, package: { bidId: args.bidId } },
    select: { id: true, package: { select: { status: true } } },
  });
  if (!packageItem || !["ISSUED", "RESPONSES_IN", "GC_REVIEW"].includes(packageItem.package.status)) return { error: "Not found" as const };
  const max = await tx.tradeResponseRevision.aggregate({ where: { packageItemId: args.packageItemId }, _max: { revisionIndex: true } });
  const revisionIndex = (max._max.revisionIndex ?? -1) + 1;
  const revision = await tx.tradeResponseRevision.create({
    data: {
      bidId: args.bidId,
      packageItemId: args.packageItemId,
      revisionIndex,
      responderName: cleanText(args.input.responderName, 300)!,
      responderCompany: cleanText(args.input.responderCompany, 300),
      channel: args.input.channel,
      responseType: args.input.responseType,
      responseText: cleanText(args.input.responseText, 20_000)!,
      proposedCompletionDate: args.input.proposedCompletionDate ?? null,
      actualCompletionDate: args.input.actualCompletionDate ?? null,
      enteredBy: args.enteredBy,
    },
    select: { id: true, revisionIndex: true },
  });
  const audit = await writeTradeAuditTx(tx, {
    action: "trade_response_revision_create",
    subjectKind: "TradeResponseRevision",
    subjectId: revision.id,
    bidId: args.bidId,
    actor: args.actor,
    payload: {
      packageId: args.packageId,
      packageItemId: args.packageItemId,
      revisionIndex,
      channel: args.input.channel,
      responseType: args.input.responseType,
      hasProposedDate: Boolean(args.input.proposedCompletionDate),
      hasActualDate: Boolean(args.input.actualCompletionDate),
    },
  });
  return { revision, audit };
}

export async function submitManualResponse(
  bidId: number,
  packageId: number,
  packageItemId: number,
  input: ResponseInput,
  actor: Actor
): Promise<ServiceResult<{ id: number; revisionIndex: number }>> {
  const validation = validateResponseInput(input);
  if (validation) return { ok: false, error: validation };
  if (input.channel === "PORTAL") return { ok: false, error: "Manual entry must preserve a non-portal channel" };
  const committed = await withUniqueRetry(() => prisma.$transaction((tx) => appendResponseTx(tx, {
    bidId,
    packageId,
    packageItemId,
    input,
    enteredBy: actorLabel(actor),
    actor,
  })));
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: committed.revision };
}

async function authorizeTokenTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  rawToken: string,
  action: string,
  now = new Date()
) {
  const token = await tx.responseAccessToken.findUnique({
    where: { tokenHash: hashResponseToken(rawToken) },
    select: {
      id: true,
      bidId: true,
      packageId: true,
      expiresAt: true,
      revokedAt: true,
      package: { select: { status: true } },
    },
  });
  if (!isValidTokenRow(token, now)) return null;
  await tx.responseAccessToken.update({ where: { id: token!.id }, data: { lastUsedAt: now } });
  const audit = await writeTradeAuditTx(tx, {
    action,
    subjectKind: "ResponseAccessToken",
    subjectId: token!.id,
    bidId: token!.bidId,
    actor: null,
    payload: { packageId: token!.packageId },
  });
  return { token: token!, audit };
}

export async function getExternalPackageProjection(rawToken: string): Promise<ServiceResult<Record<string, unknown>>> {
  const committed = await prisma.$transaction(async (tx) => {
    const auth = await authorizeTokenTx(tx, rawToken, "response_access_token_read");
    if (!auth) return null;
    const pkg = await tx.responsePackage.findFirst({
      where: { id: auth.token.packageId, bidId: auth.token.bidId, status: { in: [...ACTIVE_EXTERNAL_PACKAGE_STATUSES] } },
      select: {
        id: true,
        packageNumber: true,
        title: true,
        responseDueDate: true,
        status: true,
        items: {
          where: { bidId: auth.token.bidId },
          orderBy: { id: "asc" },
          select: {
            id: true,
            displayNumber: true,
            trackedItem: { select: { title: true, description: true, sourceLocator: true, dueDate: true } },
            responses: {
              orderBy: { revisionIndex: "asc" },
              select: {
                id: true,
                revisionIndex: true,
                responderName: true,
                responderCompany: true,
                channel: true,
                responseType: true,
                responseText: true,
                proposedCompletionDate: true,
                actualCompletionDate: true,
                submittedAt: true,
                attachments: { select: { id: true, fileName: true, mimeType: true, byteSize: true } },
              },
            },
          },
        },
      },
    });
    return pkg ? { pkg, audit: auth.audit } : null;
  });
  if (!committed) return { ok: false, error: "Not found" };
  emitTradeAudits(committed.audit);
  return { ok: true, value: committed.pkg };
}

export async function submitExternalResponse(
  rawToken: string,
  packageItemId: number,
  input: Omit<ResponseInput, "channel">
): Promise<ServiceResult<{ id: number; revisionIndex: number }>> {
  const portalInput = { ...input, channel: "PORTAL" };
  const validation = validateResponseInput(portalInput);
  if (validation) return { ok: false, error: validation };
  const committed = await withUniqueRetry(() => prisma.$transaction(async (tx) => {
    const auth = await authorizeTokenTx(tx, rawToken, "response_access_token_submit");
    if (!auth) return null;
    const response = await appendResponseTx(tx, {
      bidId: auth.token.bidId,
      packageId: auth.token.packageId,
      packageItemId,
      input: portalInput,
      enteredBy: null,
      actor: null,
    });
    return { auth, response };
  }));
  if (!committed || "error" in committed.response) return { ok: false, error: "Not found" };
  emitTradeAudits([committed.auth.audit, committed.response.audit]);
  return { ok: true, value: committed.response.revision };
}

export async function preflightExternalResponseItem(
  rawToken: string,
  packageItemId: number
): Promise<ServiceResult<{ bidId: number; packageId: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const auth = await authorizeTokenTx(tx, rawToken, "response_access_token_submit_preflight");
    if (!auth) return null;
    const item = await tx.responsePackageItem.findFirst({
      where: {
        id: packageItemId,
        bidId: auth.token.bidId,
        packageId: auth.token.packageId,
        package: { bidId: auth.token.bidId, status: { in: ["ISSUED", "RESPONSES_IN", "GC_REVIEW"] } },
      },
      select: { id: true },
    });
    return item ? { auth } : null;
  });
  if (!committed) return { ok: false, error: "Not found" };
  emitTradeAudits(committed.auth.audit);
  return { ok: true, value: { bidId: committed.auth.token.bidId, packageId: committed.auth.token.packageId } };
}

export async function reviewTradeResponse(
  bidId: number,
  packageId: number,
  packageItemId: number,
  revisionId: number,
  input: { gcReview: string; gcCommentary?: string | null },
  actor: Actor
): Promise<ServiceResult<{ id: number; gcReview: string }>> {
  if (!includes(GC_REVIEW_STATES, input.gcReview)) return { ok: false, error: "Invalid GC review state" };
  const commentary = cleanText(input.gcCommentary, 8_000);
  const committed = await prisma.$transaction(async (tx) => {
    const revision = await tx.tradeResponseRevision.findFirst({
      where: {
        id: revisionId,
        bidId,
        packageItemId,
        packageItem: { packageId, bidId, package: { bidId, status: "GC_REVIEW" } },
      },
      select: { id: true },
    });
    if (!revision) return { error: "Not found" as const };
    const previous = await tx.tradeResponseReviewDecision.findFirst({
      where: { bidId, responseRevisionId: revisionId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const decision = await tx.tradeResponseReviewDecision.create({
      data: {
        bidId,
        responseRevisionId: revisionId,
        decision: input.gcReview,
        commentary,
        reviewedBy: actorLabel(actor),
        correctionOfId: previous?.id ?? null,
      },
      select: { id: true },
    });
    await tx.tradeResponseRevision.update({
      where: { id: revisionId },
      data: {
        gcReview: input.gcReview,
        gcReviewBy: actorLabel(actor),
        gcReviewAt: new Date(),
        gcCommentary: commentary,
      },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: input.gcReview === "RETURNED_FOR_REVISION" ? "trade_response_return_for_revision" : "trade_response_gc_review",
      subjectKind: "TradeResponseRevision",
      subjectId: revisionId,
      bidId,
      actor,
      decision: input.gcReview,
      payload: {
        packageId,
        packageItemId,
        gcReview: input.gcReview,
        decisionId: decision.id,
        correctionOfId: previous?.id ?? null,
        hasCommentary: Boolean(commentary),
      },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { id: revisionId, gcReview: input.gcReview } };
}

export async function transitionResponsePackage(
  bidId: number,
  packageId: number,
  to: string,
  actor: Actor
): Promise<ServiceResult<{ status: string }>> {
  if (!includes(PACKAGE_STATUSES, to) || ["DRAFT", "ISSUED"].includes(to)) {
    return { ok: false, error: "Invalid package transition" };
  }
  const committed = await prisma.$transaction(async (tx) => {
    const pkg = await tx.responsePackage.findFirst({
      where: { id: packageId, bidId },
      include: {
        items: {
          where: { bidId },
          select: {
            id: true,
            responses: { orderBy: { revisionIndex: "desc" }, take: 1, select: { id: true, gcReview: true } },
          },
        },
      },
    });
    if (!pkg) return { error: "Not found" as const };
    const allowed: Record<string, string[]> = {
      DRAFT: ["VOIDED"],
      ISSUED: ["RESPONSES_IN", "VOIDED"],
      RESPONSES_IN: ["GC_REVIEW", "VOIDED"],
      GC_REVIEW: ["READY_TO_TRANSMIT", "VOIDED"],
      READY_TO_TRANSMIT: ["VOIDED"],
    };
    if (!(allowed[pkg.status] ?? []).includes(to)) return { error: "Invalid package transition" as const };
    const everyResponded = pkg.items.length > 0 && pkg.items.every((item) => item.responses.length > 0);
    if (["RESPONSES_IN", "GC_REVIEW", "READY_TO_TRANSMIT"].includes(to) && !everyResponded) {
      return { error: "Every package item requires a response" as const };
    }
    if (to === "READY_TO_TRANSMIT" && !pkg.items.every((item) => item.responses[0]?.gcReview === "ACCEPTED_FOR_TRANSMITTAL")) {
      return { error: "Latest responses must be accepted for transmittal" as const };
    }
    const claimed = await tx.responsePackage.updateMany({
      where: { id: packageId, bidId, status: pkg.status },
      data: {
        status: to,
        ...(to === "VOIDED" ? { voidedBy: actorLabel(actor), voidedAt: new Date() } : {}),
      },
    });
    if (claimed.count !== 1) return { error: "Package state changed; retry" as const };
    let revokedCount = 0;
    if (to === "VOIDED") {
      const revoked = await tx.responseAccessToken.updateMany({
        where: { packageId, bidId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      revokedCount = revoked.count;
    }
    const audit = await writeTradeAuditTx(tx, {
      action: "response_package_transition",
      subjectKind: "ResponsePackage",
      subjectId: packageId,
      bidId,
      actor,
      decision: to,
      payload: { from: pkg.status, to, itemCount: pkg.items.length, revokedTokenCount: revokedCount },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { status: to } };
}

export { authorizeTokenTx };
