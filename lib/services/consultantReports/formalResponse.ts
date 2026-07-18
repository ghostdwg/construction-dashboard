// lib/services/consultantReports/formalResponse.ts
//
// Module OPS3 (Phase 1A) — the ONE formal response per Register Item.
// TrackedItem.formalResponse is the single stored value; both edit
// surfaces (item detail and consultant-report detail) PATCH it through the
// identical route/service. Explicit save only — no autosave.
//
// Audit contract: prior text remains in the domain row's formalResponsePrior
// field. Generic AuditEvent payload/stdout contain lengths only, never
// formal-response content. Mutation + mandatory audit are fail-closed in one
// transaction and stdout emission happens only after commit.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  emitOperationsAuditPostCommit,
  writeOperationsAuditTx,
} from "@/lib/services/operationsAudit";
import { actorLabel, type Actor, type ServiceResult } from "./index";

export const MAX_FORMAL_RESPONSE_LENGTH = 4000;

export async function setFormalResponse(
  bidId: number,
  itemId: number,
  formalResponse: string,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const text = formalResponse?.trim();
  if (!text) return { ok: false, error: "formalResponse is required" };
  if (text.length > MAX_FORMAL_RESPONSE_LENGTH) {
    return {
      ok: false,
      error: `formalResponse is too long (${text.length} chars; max ${MAX_FORMAL_RESPONSE_LENGTH})`,
    };
  }

  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true, formalResponse: true },
  });
  if (!item) return { ok: false, error: "Not found" };

  const prior = item.formalResponse ?? null;
  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.trackedItem.update({
      where: { id: itemId },
      data: {
        formalResponse: text,
        formalResponseBy: actorLabel(actor),
        formalResponseAt: new Date(),
        formalResponsePrior: prior,
      },
    });
    envelope = await writeOperationsAuditTx(tx, {
      category: "consultant_report",
      action: "formal_response_edited",
      decision: prior == null ? "first_save" : "edited",
      subjectKind: "TrackedItem",
      subjectId: itemId,
      actor,
      payload: {
        bidId,
        priorLength: prior?.length ?? 0,
        newLength: text.length,
      },
    });
  });
  emitOperationsAuditPostCommit(envelope);

  return { ok: true, value: { id: itemId } };
}
