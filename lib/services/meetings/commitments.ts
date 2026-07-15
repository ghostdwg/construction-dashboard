// lib/services/meetings/commitments.ts
//
// Module OPS7 — human review of extracted verbal commitments. The
// extractor's ceiling is a PROPOSED row; everything here is a human
// action: confirm (→ OPEN, optionally spawning a linked MeetingActionItem
// atomically), dismiss (kept on record, reinstatable), fulfill (records
// the actor). Any authenticated user (operator decision 2026-07-15).
// OVERDUE is derived at read — see isOverdue(); nothing stores it.

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Actor {
  name?: string | null;
  email?: string | null;
}

function actorLabel(actor: Actor | null | undefined): string | null {
  const label = actor?.email?.trim() || actor?.name?.trim();
  return label || null;
}

export function isOverdue(commitment: { status: string; dueDate: Date | null }): boolean {
  return (
    commitment.status === "OPEN" &&
    commitment.dueDate != null &&
    commitment.dueDate.getTime() < Date.now()
  );
}

async function audit(
  action: string,
  bidId: number,
  commitmentId: number,
  actor: Actor,
  decision: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await emitAuditEvent({
      category: "register_action",
      action,
      severity: "NOTICE",
      decision,
      subject: { kind: "MeetingCommitment", id: String(commitmentId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      // ids/counts only — never commitment text or quotes.
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[commitments] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

async function findCommitment(bidId: number, meetingId: number, commitmentId: number) {
  return prisma.meetingCommitment.findFirst({
    where: { id: commitmentId, meetingId, bidId },
  });
}

export interface ConfirmCommitmentInput {
  /** When true, a MeetingActionItem is created and linked atomically. */
  spawnActionItem?: boolean;
}

export async function confirmCommitment(
  bidId: number,
  meetingId: number,
  commitmentId: number,
  input: ConfirmCommitmentInput,
  actor: Actor
): Promise<ServiceResult<{ id: number; linkedActionItemId: number | null }>> {
  const commitment = await findCommitment(bidId, meetingId, commitmentId);
  if (!commitment) return { ok: false, error: "Not found" };
  if (commitment.status !== "PROPOSED") {
    return { ok: false, error: `Cannot confirm from status ${commitment.status}` };
  }
  const confirmedBy = actorLabel(actor);
  if (!confirmedBy) return { ok: false, error: "A session actor is required to confirm" };

  let linkedActionItemId: number | null = null;
  if (input.spawnActionItem) {
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.meetingActionItem.create({
        data: {
          bidId,
          meetingId,
          description: commitment.commitmentText,
          assignedToName: commitment.committedBy,
          dueDate: commitment.dueDate,
          sourceText: commitment.sourceQuote,
          isGcTask: false,
          priority: "MEDIUM",
          status: "OPEN",
        },
        select: { id: true },
      });
      await tx.meetingCommitment.update({
        where: { id: commitmentId },
        data: { status: "OPEN", confirmedBy, linkedActionItemId: item.id },
      });
      return item;
    });
    linkedActionItemId = created.id;
  } else {
    await prisma.meetingCommitment.update({
      where: { id: commitmentId },
      data: { status: "OPEN", confirmedBy },
    });
  }

  await audit("commitment_confirmed", bidId, commitmentId, actor, "confirmed", {
    meetingId,
    linkedActionItemId,
    hasDueDate: commitment.dueDate != null,
  });
  return { ok: true, value: { id: commitmentId, linkedActionItemId } };
}

export async function dismissCommitment(
  bidId: number,
  meetingId: number,
  commitmentId: number,
  reason: string | null,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const commitment = await findCommitment(bidId, meetingId, commitmentId);
  if (!commitment) return { ok: false, error: "Not found" };
  if (commitment.status !== "PROPOSED") {
    return { ok: false, error: `Cannot dismiss from status ${commitment.status}` };
  }
  await prisma.meetingCommitment.update({
    where: { id: commitmentId },
    data: { status: "DISMISSED", dismissedReason: reason?.trim().slice(0, 500) || null },
  });
  await audit("commitment_dismissed", bidId, commitmentId, actor, "dismissed", {
    meetingId,
    hasReason: Boolean(reason?.trim()),
  });
  return { ok: true, value: { id: commitmentId } };
}

export async function reinstateCommitment(
  bidId: number,
  meetingId: number,
  commitmentId: number,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const commitment = await findCommitment(bidId, meetingId, commitmentId);
  if (!commitment) return { ok: false, error: "Not found" };
  if (commitment.status !== "DISMISSED") {
    return { ok: false, error: `Cannot reinstate from status ${commitment.status}` };
  }
  await prisma.meetingCommitment.update({
    where: { id: commitmentId },
    data: { status: "PROPOSED", dismissedReason: null },
  });
  await audit("commitment_reinstated", bidId, commitmentId, actor, "reinstated", {
    meetingId,
  });
  return { ok: true, value: { id: commitmentId } };
}

export async function fulfillCommitment(
  bidId: number,
  meetingId: number,
  commitmentId: number,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const commitment = await findCommitment(bidId, meetingId, commitmentId);
  if (!commitment) return { ok: false, error: "Not found" };
  if (commitment.status !== "OPEN") {
    return { ok: false, error: `Cannot fulfill from status ${commitment.status}` };
  }
  const fulfilledBy = actorLabel(actor);
  if (!fulfilledBy) return { ok: false, error: "A session actor is required to fulfill" };
  await prisma.meetingCommitment.update({
    where: { id: commitmentId },
    data: { status: "FULFILLED", fulfilledBy },
  });
  await audit("commitment_fulfilled", bidId, commitmentId, actor, "fulfilled", {
    meetingId,
    wasOverdue: isOverdue({ status: "OPEN", dueDate: commitment.dueDate }),
  });
  return { ok: true, value: { id: commitmentId } };
}
