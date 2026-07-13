// lib/services/consultantReports/dispositions.ts
//
// Module OPS4 (Phase 1B) — the append-only consultant disposition log.
// A disposition is a pm|admin judgment on one observation
// (APPROVE | REJECT | DEFER | VOID). This module deliberately exports
// CREATE and READ only — no update, no delete, at any layer:
//   1. no mutating export exists here;
//   2. the route answers PATCH/PUT/DELETE with 405;
//   3. lib/prisma.ts's client extension throws on every
//      update/upsert/delete against this model.
// A wrong disposition is corrected by APPENDING a new record; the current
// disposition is the latest by (disposedAt, id).

import { prisma } from "@/lib/prisma";
import { audit, actorLabel, type Actor, type ServiceResult } from "./index";

export const DISPOSITION_TYPES = ["APPROVE", "REJECT", "DEFER", "VOID"] as const;
export type DispositionType = (typeof DISPOSITION_TYPES)[number];

const MAX_DISPOSITION_TEXT = 2000;

export function isDispositionType(value: unknown): value is DispositionType {
  return (
    typeof value === "string" && (DISPOSITION_TYPES as readonly string[]).includes(value)
  );
}

export async function recordDisposition(
  bidId: number,
  reportId: number,
  observationId: number,
  input: { dispositionType: string; dispositionText?: string | null },
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  if (!isDispositionType(input.dispositionType)) {
    return {
      ok: false,
      error: `Unknown dispositionType — allowed: ${DISPOSITION_TYPES.join(", ")}`,
    };
  }
  const text = input.dispositionText?.trim() || null;
  if (text && text.length > MAX_DISPOSITION_TEXT) {
    return {
      ok: false,
      error: `dispositionText is too long (${text.length} chars; max ${MAX_DISPOSITION_TEXT})`,
    };
  }
  const disposedBy = actorLabel(actor);
  if (!disposedBy) {
    return { ok: false, error: "A session actor is required to record a disposition" };
  }

  // Bid-scoped double fetch: the observation must belong to THIS report
  // and THIS bid — cross-project attempts are "Not found", never a leak.
  const observation = await prisma.consultantObservation.findFirst({
    where: { id: observationId, reportId, bidId },
    select: { id: true },
  });
  if (!observation) return { ok: false, error: "Not found" };

  const created = await prisma.consultantDispositionRecord.create({
    data: {
      observationId,
      bidId,
      dispositionType: input.dispositionType,
      dispositionText: text,
      disposedBy,
    },
    select: { id: true },
  });

  await audit(
    "disposition_recorded",
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    input.dispositionType.toLowerCase(),
    { reportId, dispositionId: created.id, textLength: text?.length ?? 0 }
  );
  return { ok: true, value: created };
}

/** Chronological log for one observation (oldest first). */
export async function listDispositions(bidId: number, reportId: number, observationId: number) {
  const observation = await prisma.consultantObservation.findFirst({
    where: { id: observationId, reportId, bidId },
    select: { id: true },
  });
  if (!observation) return null;
  return prisma.consultantDispositionRecord.findMany({
    where: { observationId, bidId },
    orderBy: [{ disposedAt: "asc" }, { id: "asc" }],
  });
}

/** The CURRENT disposition = latest by (disposedAt, id), or null. */
export async function currentDisposition(bidId: number, observationId: number) {
  return prisma.consultantDispositionRecord.findFirst({
    where: { observationId, bidId },
    orderBy: [{ disposedAt: "desc" }, { id: "desc" }],
  });
}
