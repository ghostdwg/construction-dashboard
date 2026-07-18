import { prisma } from "@/lib/prisma";
import { TRACKED_ITEM_SOURCE_KIND } from "@/lib/services/trackedItems/sourceKinds";
import {
  CONSULTANT_DISCIPLINES,
  OBSERVATION_DISPOSITIONS,
  OBSERVATION_SOURCE_KINDS,
  actorLabel,
  cleanText,
  includes,
  isValidOptionalDate,
  type Actor,
  type ServiceResult,
} from "./types";
import { emitTradeAudits, writeTradeAuditTx } from "./txAudit";

class ObservationClaimError extends Error {}

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "P2002" || (typeof candidate.message === "string" && /unique constraint/i.test(candidate.message));
}

type CreateObservationInput = {
  sourceKind: string;
  fieldReportId?: number | null;
  consultantReportId?: number | null;
  observationText: string;
  sourceLocator?: string | null;
  observedAt?: Date | null;
};

async function validateSource(
  tx: typeof prisma,
  bidId: number,
  input: CreateObservationInput
): Promise<boolean> {
  const fieldId = input.fieldReportId ?? null;
  const consultantId = input.consultantReportId ?? null;
  if (input.sourceKind === "field_report") {
    if (!fieldId || consultantId) return false;
    return Boolean(await tx.fieldReport.findFirst({ where: { id: fieldId, bidId }, select: { id: true } }));
  }
  if (input.sourceKind === "consultant_report") {
    if (!consultantId || fieldId) return false;
    return Boolean(await tx.consultantReport.findFirst({ where: { id: consultantId, bidId }, select: { id: true } }));
  }
  return input.sourceKind === "direct_entry" && !fieldId && !consultantId;
}

export async function listReportObservations(bidId: number) {
  return prisma.reportObservation.findMany({
    where: { bidId },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    include: {
      fieldReport: { select: { id: true, title: true } },
      consultantReport: { select: { id: true, title: true, reportNumber: true } },
      registerItem: { select: { id: true, title: true, status: true } },
    },
  });
}

export async function createReportObservation(
  bidId: number,
  input: CreateObservationInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const observationText = cleanText(input.observationText, 8_000);
  if (!includes(OBSERVATION_SOURCE_KINDS, input.sourceKind) || !observationText) {
    return { ok: false, error: "Invalid observation source or text" };
  }
  if (!isValidOptionalDate(input.observedAt)) return { ok: false, error: "Invalid observed date" };
  const committed = await prisma.$transaction(async (tx) => {
    if (!(await validateSource(tx as typeof prisma, bidId, input))) return null;
    const row = await tx.reportObservation.create({
      data: {
        bidId,
        sourceKind: input.sourceKind,
        fieldReportId: input.fieldReportId ?? null,
        consultantReportId: input.consultantReportId ?? null,
        observationText,
        sourceLocator: cleanText(input.sourceLocator, 500),
        observedAt: input.observedAt ?? null,
        createdBy: actorLabel(actor),
      },
      select: { id: true },
    });
    const audit = await writeTradeAuditTx(tx, {
      action: "report_observation_create",
      subjectKind: "ReportObservation",
      subjectId: row.id,
      bidId,
      actor,
      payload: { sourceKind: input.sourceKind, hasLocator: Boolean(input.sourceLocator) },
    });
    return { row, audit };
  });
  if (!committed) return { ok: false, error: "Not found" };
  emitTradeAudits(committed.audit);
  return { ok: true, value: committed.row };
}

export async function updateOpenObservation(
  bidId: number,
  observationId: number,
  input: { observationText?: string; sourceLocator?: string | null; observedAt?: Date | null },
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const text = input.observationText === undefined ? undefined : cleanText(input.observationText, 8_000);
  if (input.observationText !== undefined && !text) return { ok: false, error: "observationText is required" };
  if (!isValidOptionalDate(input.observedAt)) return { ok: false, error: "Invalid observed date" };
  const committed = await prisma.$transaction(async (tx) => {
    const current = await tx.reportObservation.findFirst({ where: { id: observationId, bidId } });
    if (!current) return { error: "Not found" as const };
    if (current.disposition !== "OPEN") return { error: "Verbatim observation fields are frozen" as const };
    const claimed = await tx.reportObservation.updateMany({
      where: { id: observationId, bidId, disposition: "OPEN" },
      data: {
        ...(text !== undefined ? { observationText: text! } : {}),
        ...(input.sourceLocator !== undefined ? { sourceLocator: cleanText(input.sourceLocator, 500) } : {}),
        ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
      },
    });
    if (claimed.count !== 1) return { error: "Verbatim observation fields are frozen" as const };
    const audit = await writeTradeAuditTx(tx, {
      action: "report_observation_update",
      subjectKind: "ReportObservation",
      subjectId: observationId,
      bidId,
      actor,
      payload: { changedFields: Object.keys(input) },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { id: observationId } };
}

export async function dispositionObservation(
  bidId: number,
  observationId: number,
  input: { disposition: string; reason?: string | null },
  actor: Actor
): Promise<ServiceResult<{ id: number; disposition: string }>> {
  if (!includes(OBSERVATION_DISPOSITIONS, input.disposition)) {
    return { ok: false, error: "Invalid disposition" };
  }
  const reason = cleanText(input.reason, 2_000);
  if (input.disposition === "DISMISSED_WITH_REASON" && !reason) {
    return { ok: false, error: "A dismissal reason is required" };
  }
  const committed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.reportObservation.updateMany({
      where: { id: observationId, bidId, disposition: "OPEN" },
      data: {
        disposition: input.disposition,
        dispositionReason: reason,
        dispositionBy: actorLabel(actor),
        dispositionAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      const existing = await tx.reportObservation.findFirst({ where: { id: observationId, bidId }, select: { id: true } });
      return { error: existing ? "Observation is already dispositioned" as const : "Not found" as const };
    }
    const audit = await writeTradeAuditTx(tx, {
      action: "report_observation_disposition",
      subjectKind: "ReportObservation",
      subjectId: observationId,
      bidId,
      actor,
      decision: input.disposition,
      payload: { disposition: input.disposition, hasReason: Boolean(reason) },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { id: observationId, disposition: input.disposition } };
}

export async function promoteObservation(
  bidId: number,
  observationId: number,
  input: { title?: string; description?: string | null; priority?: string; dueDate?: Date | null },
  actor: Actor
): Promise<ServiceResult<{ trackedItemId: number }>> {
  let committed;
  try {
    committed = await prisma.$transaction(async (tx) => {
      const observation = await tx.reportObservation.findFirst({ where: { id: observationId, bidId } });
      if (!observation) return { error: "Not found" as const };
      if (observation.disposition !== "ACCEPTED") return { error: "Observation must be accepted before promotion" as const };
      if (observation.registerItemId) return { item: { id: observation.registerItemId }, audit: null };
      const title = cleanText(input.title, 300) ?? observation.observationText.slice(0, 300);
      const sourceKind = observation.sourceKind === "field_report"
        ? TRACKED_ITEM_SOURCE_KIND.FIELD_REPORT
        : observation.sourceKind === "consultant_report"
          ? TRACKED_ITEM_SOURCE_KIND.CONSULTANT_OBSERVATION
          : TRACKED_ITEM_SOURCE_KIND.MANUAL;
      const item = await tx.trackedItem.create({
        data: {
          bidId,
          kind: observation.sourceKind === "field_report" ? "FIELD_ITEM" : "JSO_ITEM",
          title,
          description: cleanText(input.description, 4_000),
          priority: input.priority ?? "MEDIUM",
          dueDate: input.dueDate ?? null,
          sourceKind,
          sourceFieldReportId: observation.fieldReportId,
          sourceReportObservationId: observation.id,
          evidenceExcerpt: observation.observationText,
          sourceLocator: observation.sourceLocator,
          extractionMethod: "manual",
          citationVerified: true,
        },
        select: { id: true },
      });
      const claimed = await tx.reportObservation.updateMany({
        where: { id: observationId, bidId, disposition: "ACCEPTED", registerItemId: null },
        data: { registerItemId: item.id },
      });
      if (claimed.count !== 1) throw new ObservationClaimError("Observation promotion was already claimed");
      const audit = await writeTradeAuditTx(tx, {
        action: "report_observation_promote",
        subjectKind: "ReportObservation",
        subjectId: observationId,
        bidId,
        actor,
        payload: { trackedItemId: item.id, sourceKind },
      });
      return { item, audit };
    });
  } catch (error) {
    if (error instanceof ObservationClaimError || isUniqueConflict(error)) {
      const existing = await prisma.reportObservation.findFirst({
        where: { id: observationId, bidId, registerItemId: { not: null } },
        select: { registerItemId: true },
      });
      if (existing?.registerItemId) return { ok: true, value: { trackedItemId: existing.registerItemId } };
    }
    throw error;
  }
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  if (committed.audit) emitTradeAudits(committed.audit);
  return { ok: true, value: { trackedItemId: committed.item.id } };
}

export async function linkObservation(
  bidId: number,
  observationId: number,
  trackedItemId: number,
  actor: Actor
): Promise<ServiceResult<{ trackedItemId: number }>> {
  const committed = await prisma.$transaction(async (tx) => {
    const [observation, item] = await Promise.all([
      tx.reportObservation.findFirst({ where: { id: observationId, bidId } }),
      tx.trackedItem.findFirst({ where: { id: trackedItemId, bidId }, select: { id: true } }),
    ]);
    if (!observation || !item) return { error: "Not found" as const };
    if (observation.disposition !== "ACCEPTED") return { error: "Observation must be accepted before linking" as const };
    if (observation.registerItemId) return { error: "Observation is already linked" as const };
    const claimed = await tx.reportObservation.updateMany({
      where: { id: observationId, bidId, disposition: "ACCEPTED", registerItemId: null },
      data: { registerItemId: item.id },
    });
    if (claimed.count !== 1) return { error: "Observation is already linked" as const };
    const audit = await writeTradeAuditTx(tx, {
      action: "report_observation_link",
      subjectKind: "ReportObservation",
      subjectId: observationId,
      bidId,
      actor,
      payload: { trackedItemId: item.id },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { trackedItemId } };
}

export async function assignTrackedItemTrades(
  bidId: number,
  trackedItemId: number,
  input: {
    leadTradeId?: number | null;
    supportingTradeIds?: number[];
    responsibleContractorId?: number | null;
    gcInternalResponsibility?: boolean;
    consultantDiscipline?: string | null;
  },
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  if (input.consultantDiscipline && !includes(CONSULTANT_DISCIPLINES, input.consultantDiscipline)) {
    return { ok: false, error: "Invalid consultant discipline" };
  }
  const supporting = [...new Set(input.supportingTradeIds ?? [])];
  if (input.leadTradeId && supporting.includes(input.leadTradeId)) {
    return { ok: false, error: "Lead trade cannot also be supporting" };
  }
  const committed = await prisma.$transaction(async (tx) => {
    const item = await tx.trackedItem.findFirst({ where: { id: trackedItemId, bidId }, select: { id: true, dueDate: true } });
    if (!item) return { error: "Not found" as const };
    const tradeIds = [...(input.leadTradeId ? [input.leadTradeId] : []), ...supporting];
    if (tradeIds.length) {
      const owned = await tx.bidTrade.count({ where: { bidId, tradeId: { in: tradeIds } } });
      if (owned !== tradeIds.length) return { error: "Not found" as const };
    }
    if (input.responsibleContractorId) {
      const contractor = await tx.bidInviteSelection.findFirst({
        where: { bidId, subcontractorId: input.responsibleContractorId },
        select: { id: true },
      });
      if (!contractor) return { error: "Not found" as const };
    }
    await tx.trackedItem.update({
      where: { id: trackedItemId },
      data: {
        leadTradeId: input.leadTradeId ?? null,
        responsibleContractorId: input.responsibleContractorId ?? null,
        gcInternalResponsibility: input.gcInternalResponsibility ?? false,
        consultantDiscipline: input.consultantDiscipline ?? null,
      },
    });
    await tx.trackedItemTradeAssignment.deleteMany({ where: { trackedItemId } });
    if (input.leadTradeId) {
      await tx.trackedItemTradeAssignment.create({ data: { bidId, trackedItemId, tradeId: input.leadTradeId, role: "LEAD" } });
    }
    for (const tradeId of supporting) {
      await tx.trackedItemTradeAssignment.create({ data: { bidId, trackedItemId, tradeId, role: "SUPPORTING" } });
    }
    const audit = await writeTradeAuditTx(tx, {
      action: "tracked_item_trade_assignment",
      subjectKind: "TrackedItem",
      subjectId: trackedItemId,
      bidId,
      actor,
      payload: {
        leadTradeId: input.leadTradeId ?? null,
        supportingTradeIds: supporting,
        responsibleContractorId: input.responsibleContractorId ?? null,
        gcInternalResponsibility: input.gcInternalResponsibility ?? false,
        consultantDiscipline: input.consultantDiscipline ?? null,
        dueDateUnchanged: item.dueDate?.toISOString() ?? null,
      },
    });
    return { audit };
  });
  if ("error" in committed && committed.error) return { ok: false, error: committed.error };
  emitTradeAudits(committed.audit);
  return { ok: true, value: { id: trackedItemId } };
}
