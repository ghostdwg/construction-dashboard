// lib/services/consultantReports/formalResponse.ts
//
// Module OPS3 (Phase 1A) — the ONE formal response per Register Item.
// TrackedItem.formalResponse is the single stored value; both edit
// surfaces (item detail and consultant-report detail) PATCH it through the
// identical route/service. Explicit save only — no autosave.
//
// Audit contract (card §15, verbatim requirements):
//   - the prior value is DB-persisted: on the item itself
//     (formalResponsePrior) AND in the audit row's payloadJson, BOUNDED.
//   - stdout/log projections must NEVER emit formal-response text. The
//     shared emitter fans every payload out to stdout, so this module
//     splits the fan-out: a text-free envelope goes through the emitter
//     (stdout + metrics), and the bounded prior/new text is written
//     directly to the DB AuditEvent row, which is never printed.

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import { actorLabel, type Actor, type ServiceResult } from "./index";

export const MAX_FORMAL_RESPONSE_LENGTH = 4000;
/** Bound on prior/new text captured in the audit row's payloadJson. */
export const AUDIT_VALUE_BOUND = 500;

function bounded(value: string | null): string | null {
  if (value == null) return null;
  return value.length > AUDIT_VALUE_BOUND ? value.slice(0, AUDIT_VALUE_BOUND) : value;
}

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
  await prisma.trackedItem.update({
    where: { id: itemId },
    data: {
      formalResponse: text,
      formalResponseBy: actorLabel(actor),
      formalResponseAt: new Date(),
      formalResponsePrior: prior,
    },
  });

  // Stdout-safe envelope — lengths only, never the text.
  try {
    await emitAuditEvent({
      category: "consultant_report",
      action: "formal_response_edited",
      severity: "NOTICE",
      decision: prior == null ? "first_save" : "edited",
      subject: { kind: "TrackedItem", id: String(itemId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      payload: {
        bidId,
        priorLength: prior?.length ?? 0,
        newLength: text.length,
      },
      // The DB row is written below WITH the bounded text; persisting this
      // text-free envelope too would duplicate the event.
      skipDbPersist: true,
    });
  } catch (err) {
    console.error(
      "[consultant-reports] formal-response audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }

  // DB-persisted row carrying the BOUNDED prior/new values — never printed.
  try {
    await prisma.auditEvent.create({
      data: {
        category: "consultant_report",
        action: "formal_response_edited",
        severity: "NOTICE",
        subjectKind: "TrackedItem",
        subjectId: String(itemId),
        actorEmail: actor?.email ?? null,
        actorKind: "operator",
        decision: prior == null ? "first_save" : "edited",
        payloadJson: JSON.stringify({
          bidId,
          prior: bounded(prior),
          new: bounded(text),
          priorLength: prior?.length ?? 0,
          newLength: text.length,
        }),
      },
    });
  } catch (err) {
    console.error(
      "[consultant-reports] formal-response audit persist failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }

  return { ok: true, value: { id: itemId } };
}
