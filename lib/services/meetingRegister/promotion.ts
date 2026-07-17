// lib/services/meetingRegister/promotion.ts
//
// Module R2-B1 — Operations Register promotion and linking (R2 rules 3,
// 10, 12). TrackedItem remains the single Operations Register; a register
// entry either PROMOTES (creates one TrackedItem with full provenance —
// unique sourceMeetingRegisterEntryId guard) or LINKS to an existing item
// (how one Operations item collects continuity from multiple meetings).
// Promotion NEVER removes or edits the register entry beyond its review
// state — the entry remains the meeting-local record forever.

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import { findEntry } from "./register";
import { actorLabel, bound, type Actor, type ServiceResult } from "./types";

const TRACKED_ITEM_KINDS = new Set([
  "OAC_ACTION",
  "FIELD_ITEM",
  "JSO_ITEM",
  "WARRANTY",
  "CLOSEOUT",
  "TRAINING",
  "OM",
  "TEST_INSPECTION",
  "ATTIC_STOCK",
]);

async function audit(
  action: string,
  bidId: number,
  entryId: number,
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
      subject: { kind: "MeetingRegisterEntry", id: String(entryId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[meetingRegister/promotion] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

export type PromoteInput = {
  kind?: string;
  title?: string;
  priority?: string;
  tradeId?: number;
  dueDate?: string; // overrides entry dueDate when supplied
};

export async function promoteEntry(
  bidId: number,
  meetingId: number,
  entryId: number,
  input: PromoteInput,
  actor: Actor
): Promise<ServiceResult<{ trackedItemId: number }>> {
  const promotedBy = actorLabel(actor);
  if (!promotedBy) return { ok: false, error: "A session actor is required to promote" };

  const entry = await findEntry(bidId, meetingId, entryId);
  if (!entry) return { ok: false, error: "Not found" };
  if (entry.linkedTrackedItemId) {
    return { ok: false, error: "Entry is already linked to an Operations Register item" };
  }

  const kind = input.kind ?? "OAC_ACTION";
  if (!TRACKED_ITEM_KINDS.has(kind)) return { ok: false, error: `Invalid kind ${kind}` };
  const title = (input.title?.trim() || entry.normalizedText).slice(0, 200);
  const priority = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(input.priority ?? "")
    ? (input.priority as string)
    : "MEDIUM";
  const dueDate =
    input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
      ? new Date(`${input.dueDate}T00:00:00.000Z`)
      : entry.dueDate;

  if (input.tradeId != null) {
    const trade = await prisma.trade.findUnique({
      where: { id: input.tradeId },
      select: { id: true },
    });
    if (!trade) return { ok: false, error: "tradeId not found" };
  }

  try {
    const trackedItem = await prisma.$transaction(async (tx) => {
      const created = await tx.trackedItem.create({
        data: {
          bidId,
          kind,
          title,
          description: entry.normalizedText,
          priority,
          assigneeName: bound(entry.responsibleParty, 200),
          tradeId: input.tradeId ?? null,
          dueDate,
          // ── full source provenance (R2 Part C.6) ──
          sourceKind: "meeting_register",
          sourceMeetingId: meetingId,
          sourceMeetingRegisterEntryId: entry.id,
          evidenceExcerpt: bound(entry.rawSourceText, 2000),
          sourceLocator: entry.sourceCitation ?? entry.speakerLabel ?? null,
          // every producer writes extractionMethod EXPLICITLY (repo rule):
          extractionMethod: entry.origin === "manual" ? "manual" : "meeting_analysis",
          extractorVersion: entry.extractionRunId ? `register-run-${entry.extractionRunId}` : null,
          citationVerified: entry.segmentId != null,
        },
        select: { id: true },
      });
      await tx.meetingRegisterEntry.update({
        where: { id: entry.id },
        data: {
          reviewState: "PROMOTED_TO_OPERATIONS",
          linkedTrackedItemId: created.id,
          dispositionBy: promotedBy,
          dispositionAt: new Date(),
        },
      });
      await tx.meetingRegisterEntryRevision.create({
        data: {
          entryId: entry.id,
          bidId,
          changeType: "PROMOTION",
          fromReviewState: entry.reviewState,
          toReviewState: "PROMOTED_TO_OPERATIONS",
          detailJson: JSON.stringify({ trackedItemId: created.id, kind }),
          actor: promotedBy,
        },
      });
      return created;
    });
    await audit("register_entry_promoted", bidId, entry.id, actor, "promoted", {
      meetingId,
      trackedItemId: trackedItem.id,
      kind,
    });
    return { ok: true, value: { trackedItemId: trackedItem.id } };
  } catch (err) {
    // P2002 on sourceMeetingRegisterEntryId — a concurrent promotion won.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return { ok: false, error: "This entry has already been promoted" };
    }
    throw err;
  }
}

/**
 * Link an entry to an EXISTING Operations Register item — the cross-meeting
 * continuity path (rule 10). Counts as the entry's disposition.
 */
export async function linkEntryToItem(
  bidId: number,
  meetingId: number,
  entryId: number,
  trackedItemId: number,
  actor: Actor
): Promise<ServiceResult<{ trackedItemId: number }>> {
  const linkedBy = actorLabel(actor);
  if (!linkedBy) return { ok: false, error: "A session actor is required to link" };

  const entry = await findEntry(bidId, meetingId, entryId);
  if (!entry) return { ok: false, error: "Not found" };
  if (entry.linkedTrackedItemId) {
    return { ok: false, error: "Entry is already linked to an Operations Register item" };
  }
  // Same-bid check — cross-bid links are impossible by construction.
  const item = await prisma.trackedItem.findFirst({
    where: { id: trackedItemId, bidId },
    select: { id: true },
  });
  if (!item) return { ok: false, error: "Tracked item not found" };

  await prisma.$transaction(async (tx) => {
    await tx.meetingRegisterEntry.update({
      where: { id: entry.id },
      data: {
        reviewState: "PROMOTED_TO_OPERATIONS",
        linkedTrackedItemId: item.id,
        dispositionBy: linkedBy,
        dispositionAt: new Date(),
      },
    });
    await tx.meetingRegisterEntryRevision.create({
      data: {
        entryId: entry.id,
        bidId,
        changeType: "LINK",
        fromReviewState: entry.reviewState,
        toReviewState: "PROMOTED_TO_OPERATIONS",
        detailJson: JSON.stringify({ trackedItemId: item.id, linked: true }),
        actor: linkedBy,
      },
    });
  });
  await audit("register_entry_linked", bidId, entry.id, actor, "linked", {
    meetingId,
    trackedItemId: item.id,
  });
  return { ok: true, value: { trackedItemId: item.id } };
}

/**
 * Continuity view for one Operations item: every register entry (across
 * meetings) that feeds it, in meeting-date order (rule 10 chronology).
 */
export async function getItemContinuity(bidId: number, trackedItemId: number) {
  return prisma.meetingRegisterEntry.findMany({
    where: { bidId, linkedTrackedItemId: trackedItemId },
    orderBy: [{ meeting: { meetingDate: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      meetingId: true,
      entryType: true,
      normalizedText: true,
      sourceCitation: true,
      reviewState: true,
      meeting: { select: { title: true, meetingDate: true } },
    },
  });
}
