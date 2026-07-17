// lib/services/meetings/designLog.ts
//
// Module OPS5 — human review of meeting-extracted design intent changes.
// The extractor's ceiling is a PROPOSED row; everything here is a human
// action: confirm (optionally creating a Register Item citing the
// meeting), dismiss (kept on record, reinstatable), reinstate. Any
// authenticated user may confirm/dismiss (operator decision 2026-07-13 —
// meeting review is a coordination act, not a pm-gated judgment).

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import { TRACKED_ITEM_SOURCE_KIND } from "@/lib/services/trackedItems/sourceKinds";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Actor {
  name?: string | null;
  email?: string | null;
}

function actorLabel(actor: Actor | null | undefined): string | null {
  const label = actor?.email?.trim() || actor?.name?.trim();
  return label || null;
}

async function audit(
  action: string,
  bidId: number,
  changeId: number,
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
      subject: { kind: "DesignIntentChange", id: String(changeId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      // ids/counts only — never changeText/quote content.
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[design-log] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

async function findChange(bidId: number, meetingId: number, changeId: number) {
  return prisma.designIntentChange.findFirst({
    where: { id: changeId, meetingId, bidId },
  });
}

export interface ConfirmInput {
  /** When true, a TrackedItem is created citing this meeting and linked. */
  createItem?: boolean;
  /** Required when createItem — human-provided/edited title. */
  title?: string | null;
}

export async function confirmDesignChange(
  bidId: number,
  meetingId: number,
  changeId: number,
  input: ConfirmInput,
  actor: Actor
): Promise<ServiceResult<{ id: number; linkedTrackedItemId: number | null }>> {
  const change = await findChange(bidId, meetingId, changeId);
  if (!change) return { ok: false, error: "Not found" };
  if (change.state !== "PROPOSED") {
    return { ok: false, error: `Cannot confirm from state ${change.state}` };
  }
  const confirmedBy = actorLabel(actor);
  if (!confirmedBy) {
    return { ok: false, error: "A session actor is required to confirm" };
  }

  let linkedTrackedItemId: number | null = null;
  if (input.createItem) {
    const title = input.title?.trim();
    if (!title) return { ok: false, error: "title is required when creating an item" };
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.trackedItem.create({
        data: {
          bidId,
          kind: "OAC_ACTION",
          title: title.slice(0, 300),
          description: change.priorIntent
            ? `Design change — was: ${change.priorIntent.slice(0, 1500)}`
            : null,
          priority: change.severity === "CRITICAL" ? "CRITICAL" : "MEDIUM",
          // Canonical value (legacy rows carry "meeting" — readable forever,
          // never rewritten; see lib/services/trackedItems/sourceKinds.ts).
          sourceKind: TRACKED_ITEM_SOURCE_KIND.MEETING_DESIGN_CHANGE,
          sourceMeetingId: meetingId,
          evidenceExcerpt: change.sourceQuote ?? change.changeText,
          sourceLocator: change.affectedSpec,
          extractionMethod: "meeting_analysis",
          citationVerified: false,
        },
        select: { id: true },
      });
      await tx.designIntentChange.update({
        where: { id: changeId },
        data: { state: "CONFIRMED", confirmedBy, linkedTrackedItemId: item.id },
      });
      return item;
    });
    linkedTrackedItemId = created.id;
  } else {
    await prisma.designIntentChange.update({
      where: { id: changeId },
      data: { state: "CONFIRMED", confirmedBy },
    });
  }

  await audit("design_change_confirmed", bidId, changeId, actor, "confirmed", {
    meetingId,
    linkedTrackedItemId,
    severity: change.severity,
  });
  return { ok: true, value: { id: changeId, linkedTrackedItemId } };
}

export async function dismissDesignChange(
  bidId: number,
  meetingId: number,
  changeId: number,
  reason: string | null,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const change = await findChange(bidId, meetingId, changeId);
  if (!change) return { ok: false, error: "Not found" };
  if (change.state !== "PROPOSED") {
    return { ok: false, error: `Cannot dismiss from state ${change.state}` };
  }

  await prisma.designIntentChange.update({
    where: { id: changeId },
    data: { state: "DISMISSED", dismissedReason: reason?.trim().slice(0, 500) || null },
  });
  await audit("design_change_dismissed", bidId, changeId, actor, "dismissed", {
    meetingId,
    hasReason: Boolean(reason?.trim()),
  });
  return { ok: true, value: { id: changeId } };
}

export async function reinstateDesignChange(
  bidId: number,
  meetingId: number,
  changeId: number,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const change = await findChange(bidId, meetingId, changeId);
  if (!change) return { ok: false, error: "Not found" };
  if (change.state !== "DISMISSED") {
    return { ok: false, error: `Cannot reinstate from state ${change.state}` };
  }

  await prisma.designIntentChange.update({
    where: { id: changeId },
    data: { state: "PROPOSED", dismissedReason: null },
  });
  await audit("design_change_reinstated", bidId, changeId, actor, "reinstated", {
    meetingId,
  });
  return { ok: true, value: { id: changeId } };
}
