// Module H3 — Submittal Register service layer (CRUD + list helpers)
//
// The seeder lives in seedSubmittalRegister.ts. This file handles:
// - Loading + filtering submittals for a bid
// - Computing rollup counts (by status, by trade, by type)
// - Validating + applying updates (with contract-status-style checks)

import { prisma } from "@/lib/prisma";
import {
  isValidSubmittalType,
  isValidSubmittalStatus,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
  type SubmittalStatus,
  type SubmittalType,
} from "./seedSubmittalRegister";

// ── Types ───────────────────────────────────────────────────────────────────

export type SubmittalRow = {
  id: number;
  bidTradeId: number | null;
  tradeName: string | null;
  tradeCsiCode: string | null;
  specSectionId: number | null;
  specSectionNumber: string | null;

  submittalNumber: string | null;
  title: string;
  description: string | null;
  type: SubmittalType;

  status: SubmittalStatus;
  requiredBy: string | null;
  requestedAt: string | null;
  receivedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;

  responsibleSubId: number | null;
  responsibleSubName: string | null;
  reviewer: string | null;

  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // Derived at load time (avoids Date.now() in React render)
  isOverdue: boolean;

  // Risk severity inherited from the linked SpecSection's AI analysis
  // (CRITICAL | HIGH | MODERATE | LOW | INFO). Null if no analysis ran
  // for the section, or the submittal is manual / not linked to a section.
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "INFO" | null;
};

export type SubmittalRollup = {
  total: number;
  byStatus: Record<SubmittalStatus, number>;
  byType: Record<SubmittalType, number>;
  overdue: number; // requiredBy in the past AND not APPROVED/APPROVED_AS_NOTED
};

// ── Loaders ─────────────────────────────────────────────────────────────────

export type SubmittalFilter = {
  status?: string;
  type?: string;
  bidTradeId?: number;
};

export async function loadSubmittalsForBid(
  bidId: number,
  filter: SubmittalFilter = {}
): Promise<SubmittalRow[]> {
  const where: Record<string, unknown> = { bidId };
  if (filter.status && isValidSubmittalStatus(filter.status)) where.status = filter.status;
  if (filter.type && isValidSubmittalType(filter.type)) where.type = filter.type;
  if (filter.bidTradeId != null) where.bidTradeId = filter.bidTradeId;

  const items = await prisma.submittalItem.findMany({
    where,
    include: {
      bidTrade: { include: { trade: true } },
      specSection: { select: { id: true, csiNumber: true, aiExtractions: true } },
      responsibleSub: { select: { id: true, company: true } },
    },
    orderBy: [{ submittalNumber: "asc" }, { id: "asc" }],
  });

  const VALID_SEVERITY = new Set(["CRITICAL", "HIGH", "MODERATE", "LOW", "INFO"]);
  function severityFromSection(
    aiExtractions: string | null | undefined
  ): SubmittalRow["severity"] {
    if (!aiExtractions) return null;
    try {
      const parsed = JSON.parse(aiExtractions) as { severity?: string };
      const sev = (parsed.severity ?? "").toUpperCase();
      return VALID_SEVERITY.has(sev) ? (sev as SubmittalRow["severity"]) : null;
    } catch {
      return null;
    }
  }

  const now = Date.now();
  const isTerminal = (s: string) => s === "APPROVED" || s === "APPROVED_AS_NOTED";

  return items.map((it) => ({
    id: it.id,
    bidTradeId: it.bidTradeId,
    tradeName: it.bidTrade?.trade.name ?? null,
    tradeCsiCode: it.bidTrade?.trade.csiCode ?? null,
    specSectionId: it.specSectionId,
    specSectionNumber: it.specSection?.csiNumber ?? null,
    submittalNumber: it.submittalNumber,
    title: it.title,
    description: it.description,
    type: (isValidSubmittalType(it.type) ? it.type : "OTHER") as SubmittalType,
    status: (isValidSubmittalStatus(it.status) ? it.status : "PENDING") as SubmittalStatus,
    requiredBy: it.requiredBy?.toISOString() ?? null,
    requestedAt: it.requestedAt?.toISOString() ?? null,
    receivedAt: it.receivedAt?.toISOString() ?? null,
    reviewedAt: it.reviewedAt?.toISOString() ?? null,
    approvedAt: it.approvedAt?.toISOString() ?? null,
    responsibleSubId: it.responsibleSubId,
    responsibleSubName: it.responsibleSub?.company ?? null,
    reviewer: it.reviewer,
    notes: it.notes,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
    isOverdue:
      it.requiredBy != null &&
      it.requiredBy.getTime() < now &&
      !isTerminal(it.status),
    severity: severityFromSection(it.specSection?.aiExtractions),
  }));
}

// ── Rollup ──────────────────────────────────────────────────────────────────

export function computeSubmittalRollup(items: SubmittalRow[]): SubmittalRollup {
  const byStatus = Object.fromEntries(SUBMITTAL_STATUSES.map((s) => [s, 0])) as Record<SubmittalStatus, number>;
  const byType = Object.fromEntries(SUBMITTAL_TYPES.map((t) => [t, 0])) as Record<SubmittalType, number>;

  let overdue = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    if (item.isOverdue) overdue += 1;
  }

  return {
    total: items.length,
    byStatus,
    byType,
    overdue,
  };
}

// ── Create / Update / Delete ───────────────────────────────────────────────

export type SubmittalCreateInput = {
  title: string;
  description?: string | null;
  type?: string;
  status?: string;
  submittalNumber?: string | null;
  bidTradeId?: number | null;
  specSectionId?: number | null;
  responsibleSubId?: number | null;
  reviewer?: string | null;
  requiredBy?: string | null;
  notes?: string | null;
};

export type SubmittalUpdateInput = Partial<
  SubmittalCreateInput & {
    requestedAt: string | null;
    receivedAt: string | null;
    reviewedAt: string | null;
    approvedAt: string | null;
  }
>;

export type MutationResult = { ok: true; id?: number } | { ok: false; error: string };

function validateEnums(input: {
  type?: string;
  status?: string;
}): string | null {
  if (input.type !== undefined && !isValidSubmittalType(input.type)) {
    return `Invalid type. Must be one of: ${SUBMITTAL_TYPES.join(", ")}`;
  }
  if (input.status !== undefined && !isValidSubmittalStatus(input.status)) {
    return `Invalid status. Must be one of: ${SUBMITTAL_STATUSES.join(", ")}`;
  }
  return null;
}

export async function createSubmittal(
  bidId: number,
  input: SubmittalCreateInput
): Promise<MutationResult> {
  if (!input.title || input.title.trim().length < 2) {
    return { ok: false, error: "title is required" };
  }
  const enumError = validateEnums(input);
  if (enumError) return { ok: false, error: enumError };

  const created = await prisma.submittalItem.create({
    data: {
      bidId,
      title: input.title.trim().slice(0, 200),
      description: input.description?.slice(0, 1000) ?? null,
      type: input.type ?? "OTHER",
      status: input.status ?? "PENDING",
      submittalNumber: input.submittalNumber ?? null,
      bidTradeId: input.bidTradeId ?? null,
      specSectionId: input.specSectionId ?? null,
      responsibleSubId: input.responsibleSubId ?? null,
      reviewer: input.reviewer ?? null,
      requiredBy: input.requiredBy ? new Date(input.requiredBy) : null,
      notes: input.notes ?? null,
    },
  });
  return { ok: true, id: created.id };
}

export async function updateSubmittal(
  bidId: number,
  itemId: number,
  input: SubmittalUpdateInput
): Promise<MutationResult> {
  const existing = await prisma.submittalItem.findUnique({
    where: { id: itemId },
    select: { id: true, bidId: true, status: true },
  });
  if (!existing) return { ok: false, error: "Submittal not found" };
  if (existing.bidId !== bidId) return { ok: false, error: "Submittal does not belong to this bid" };

  const enumError = validateEnums(input);
  if (enumError) return { ok: false, error: enumError };

  const data: Record<string, unknown> = {};
  if ("title" in input && input.title != null) data.title = input.title.trim().slice(0, 200);
  if ("description" in input) data.description = input.description?.slice(0, 1000) ?? null;
  if ("type" in input && input.type != null) data.type = input.type;
  if ("status" in input && input.status != null) data.status = input.status;
  if ("submittalNumber" in input) data.submittalNumber = input.submittalNumber;
  if ("bidTradeId" in input) data.bidTradeId = input.bidTradeId;
  if ("specSectionId" in input) data.specSectionId = input.specSectionId;
  if ("responsibleSubId" in input) data.responsibleSubId = input.responsibleSubId;
  if ("reviewer" in input) data.reviewer = input.reviewer;
  if ("notes" in input) data.notes = input.notes;

  // Date fields
  for (const key of ["requiredBy", "requestedAt", "receivedAt", "reviewedAt", "approvedAt"] as const) {
    if (key in input) {
      const val = input[key];
      data[key] = val ? new Date(val) : null;
    }
  }

  // Auto-advance timestamps when status changes
  if (input.status) {
    const now = new Date();
    if (input.status === "REQUESTED" && !("requestedAt" in input)) data.requestedAt = now;
    if (input.status === "RECEIVED" && !("receivedAt" in input)) data.receivedAt = now;
    if (input.status === "UNDER_REVIEW" && !("reviewedAt" in input)) data.reviewedAt = now;
    if (
      (input.status === "APPROVED" || input.status === "APPROVED_AS_NOTED") &&
      !("approvedAt" in input)
    ) {
      data.approvedAt = now;
    }
  }

  await prisma.submittalItem.update({ where: { id: itemId }, data });
  return { ok: true };
}

export async function deleteSubmittal(
  bidId: number,
  itemId: number
): Promise<MutationResult> {
  const existing = await prisma.submittalItem.findUnique({
    where: { id: itemId },
    select: { id: true, bidId: true },
  });
  if (!existing) return { ok: false, error: "Submittal not found" };
  if (existing.bidId !== bidId) return { ok: false, error: "Submittal does not belong to this bid" };

  await prisma.submittalItem.delete({ where: { id: itemId } });
  return { ok: true };
}
