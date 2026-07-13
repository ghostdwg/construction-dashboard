// lib/services/consultantReports/observations.ts
//
// Module OPS3 (Phase 1A) — durable consultant observations + the
// human-only state machine:
//
//   ENTERED ──▶ ACCEPTED_NEW_ITEM      (creates TrackedItem, writes citation)
//           ──▶ ACCEPTED_LINKED_ITEM   (links existing TrackedItem, adds citation)
//           ──▶ DISMISSED              (reason optional, audited)
//   DISMISSED ──▶ ENTERED              (reinstate, audited)
//   ACCEPTED_LINKED_ITEM ──▶ ACCEPTED_LINKED_ITEM (relink correction, audited prior/new)
//
// Source-verbatim fields (observationText, sourcePage, consultantTargetDate)
// FREEZE the instant a row leaves ENTERED. consultantTargetDate is NEVER
// copied into TrackedItem.dueDate by this module — a due date arrives only
// as explicit, human-confirmed input.
//
// Same-bid linkage CANNOT be enforced by any SQLite constraint (a FK
// asserts row existence, never a same-value match on another column across
// tables). Every accept/link/relink therefore: (1) fetches the observation
// scoped by the URL's bidId, (2) fetches the target TrackedItem scoped by
// the same bidId, and (3) asserts observation.bidId === item.bidId as a
// defense-in-depth check even though both fetches were already bid-scoped.
// Cross-project attempts return "Not found" — a 404, never a data leak.

import { prisma } from "@/lib/prisma";
import { TRACKED_ITEM_PRIORITIES, isTrackedItemKind } from "@/lib/services/trackedItems/fsm";
import { audit, actorLabel, type Actor, type ServiceResult } from "./index";

export const OBSERVATION_STATES = [
  "ENTERED",
  "ACCEPTED_NEW_ITEM",
  "ACCEPTED_LINKED_ITEM",
  "DISMISSED",
] as const;
export type ObservationState = (typeof OBSERVATION_STATES)[number];

const MAX_OBSERVATION_TEXT = 4000;
const MAX_TITLE_LENGTH = 300;

/** Bid-scoped fetch — reportId AND bidId must both match. */
async function findObservation(bidId: number, reportId: number, observationId: number) {
  return prisma.consultantObservation.findFirst({
    where: { id: observationId, reportId, bidId },
  });
}

// ── Create / edit (pre-resolution only) ──────────────────────────────────────

export interface CreateObservationInput {
  observationText: string;
  sourcePage?: string | null;
  consultantTargetDate?: Date | null;
}

export async function createObservation(
  bidId: number,
  reportId: number,
  input: CreateObservationInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const report = await prisma.consultantReport.findFirst({
    where: { id: reportId, bidId },
    select: { id: true, status: true },
  });
  if (!report) return { ok: false, error: "Not found" };
  if (report.status === "VOIDED") {
    return { ok: false, error: "Report is voided — observations cannot be added" };
  }

  const text = input.observationText?.trim();
  if (!text) return { ok: false, error: "observationText is required" };

  const created = await prisma.consultantObservation.create({
    data: {
      reportId,
      bidId,
      observationText: text.slice(0, MAX_OBSERVATION_TEXT),
      sourcePage: input.sourcePage?.trim().slice(0, 100) || null,
      consultantTargetDate: input.consultantTargetDate ?? null,
      createdBy: actorLabel(actor),
    },
    select: { id: true },
  });

  await audit(
    "observation_created",
    bidId,
    { kind: "ConsultantObservation", id: String(created.id) },
    actor,
    "created",
    { reportId, textLength: text.length }
  );
  return { ok: true, value: created };
}

export interface EditObservationInput {
  observationText?: string;
  sourcePage?: string | null;
  consultantTargetDate?: Date | null;
}

export async function editObservation(
  bidId: number,
  reportId: number,
  observationId: number,
  patch: EditObservationInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const obs = await findObservation(bidId, reportId, observationId);
  if (!obs) return { ok: false, error: "Not found" };
  if (obs.state !== "ENTERED") {
    return {
      ok: false,
      error: "Observation is resolved — source-verbatim fields are frozen",
    };
  }
  if (patch.observationText !== undefined && !patch.observationText.trim()) {
    return { ok: false, error: "observationText cannot be empty" };
  }

  await prisma.consultantObservation.update({
    where: { id: observationId },
    data: {
      ...(patch.observationText !== undefined
        ? { observationText: patch.observationText.trim().slice(0, MAX_OBSERVATION_TEXT) }
        : {}),
      ...(patch.sourcePage !== undefined
        ? { sourcePage: patch.sourcePage?.trim().slice(0, 100) || null }
        : {}),
      ...(patch.consultantTargetDate !== undefined
        ? { consultantTargetDate: patch.consultantTargetDate }
        : {}),
    },
  });
  await audit(
    "observation_edited",
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    "edited_pre_resolution",
    { reportId }
  );
  return { ok: true, value: { id: observationId } };
}

// ── Accept as NEW TrackedItem ────────────────────────────────────────────────

export interface AcceptNewItemInput {
  title: string;
  description?: string | null;
  kind?: string;
  priority?: string;
  /** One-time HUMAN-CONFIRMED pre-fill — the service never copies
   *  consultantTargetDate itself; a due date only ever arrives here. */
  dueDate?: Date | null;
  assigneeName?: string | null;
}

/** ONE creation path for both route names (Phase 1B): spawning an item from
 *  an observation sets the item-side originating FK, the observation-side
 *  spawnedItemId ("this observation CAUSED this item"), AND registerItemId
 *  ("…and trivially supports it") + state ACCEPTED_NEW_ITEM — so every 1A
 *  projection, badge query, and workbench chip keeps working. Linking an
 *  EXISTING item (below) sets registerItemId only; spawnedItemId stays null
 *  there — that null is what distinguishes linked from spawned. */
async function createItemFromObservation(
  bidId: number,
  reportId: number,
  observationId: number,
  input: AcceptNewItemInput,
  actor: Actor,
  auditAction: "observation_accepted_new" | "observation_spawned_item"
): Promise<ServiceResult<{ observationId: number; trackedItemId: number }>> {
  const obs = await findObservation(bidId, reportId, observationId);
  if (!obs) return { ok: false, error: "Not found" };
  if (obs.state !== "ENTERED") {
    return { ok: false, error: `Cannot accept from state ${obs.state}` };
  }

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title is required" };
  const kind = input.kind ?? "JSO_ITEM";
  if (!isTrackedItemKind(kind)) return { ok: false, error: `Unknown kind: ${kind}` };
  const priority = input.priority ?? "MEDIUM";
  if (!(TRACKED_ITEM_PRIORITIES as readonly string[]).includes(priority)) {
    return { ok: false, error: `Unknown priority: ${priority}` };
  }

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.trackedItem.create({
      data: {
        bidId,
        kind,
        title: title.slice(0, MAX_TITLE_LENGTH),
        description: input.description?.trim() || null,
        priority,
        assigneeName: input.assigneeName?.trim() || null,
        dueDate: input.dueDate ?? null,
        sourceKind: "consultant_report",
        sourceConsultantObservationId: observationId,
        evidenceExcerpt: obs.observationText,
        sourceLocator: obs.sourcePage,
        // Human typed/confirmed this acceptance while reading the report.
        extractionMethod: "manual",
        citationVerified: false,
      },
      select: { id: true },
    });
    await tx.consultantObservation.update({
      where: { id: observationId },
      data: {
        state: "ACCEPTED_NEW_ITEM",
        registerItemId: item.id,
        spawnedItemId: item.id,
      },
    });
    return item;
  });

  await audit(
    auditAction,
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    "accepted_new_item",
    { reportId, trackedItemId: result.id, spawnedItemId: result.id, kind }
  );
  return { ok: true, value: { observationId, trackedItemId: result.id } };
}

export async function acceptObservationAsNewItem(
  bidId: number,
  reportId: number,
  observationId: number,
  input: AcceptNewItemInput,
  actor: Actor
): Promise<ServiceResult<{ observationId: number; trackedItemId: number }>> {
  return createItemFromObservation(
    bidId, reportId, observationId, input, actor, "observation_accepted_new"
  );
}

export async function spawnItemFromObservation(
  bidId: number,
  reportId: number,
  observationId: number,
  input: AcceptNewItemInput,
  actor: Actor
): Promise<ServiceResult<{ observationId: number; trackedItemId: number }>> {
  return createItemFromObservation(
    bidId, reportId, observationId, input, actor, "observation_spawned_item"
  );
}

// ── Link / relink to an EXISTING TrackedItem ─────────────────────────────────

async function fetchSameBidItem(bidId: number, itemId: number) {
  return prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true, bidId: true },
  });
}

export async function linkObservationToItem(
  bidId: number,
  reportId: number,
  observationId: number,
  itemId: number,
  actor: Actor
): Promise<ServiceResult<{ observationId: number; trackedItemId: number }>> {
  const obs = await findObservation(bidId, reportId, observationId);
  if (!obs) return { ok: false, error: "Not found" };
  if (obs.state !== "ENTERED") {
    return { ok: false, error: `Cannot link from state ${obs.state}` };
  }

  const item = await fetchSameBidItem(bidId, itemId);
  if (!item) return { ok: false, error: "Not found" };
  // Defense in depth — both rows were bid-scoped-fetched already; assert
  // anyway (SQLite cannot express this constraint; see module header).
  if (obs.bidId !== item.bidId) return { ok: false, error: "Not found" };

  await prisma.consultantObservation.update({
    where: { id: observationId },
    data: { state: "ACCEPTED_LINKED_ITEM", registerItemId: itemId },
  });
  await audit(
    "observation_accepted_linked",
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    "linked",
    { reportId, trackedItemId: itemId }
  );
  return { ok: true, value: { observationId, trackedItemId: itemId } };
}

export async function relinkObservation(
  bidId: number,
  reportId: number,
  observationId: number,
  newItemId: number,
  actor: Actor
): Promise<ServiceResult<{ observationId: number; trackedItemId: number }>> {
  const obs = await findObservation(bidId, reportId, observationId);
  if (!obs) return { ok: false, error: "Not found" };
  if (obs.state !== "ACCEPTED_LINKED_ITEM") {
    return { ok: false, error: `Cannot relink from state ${obs.state}` };
  }

  const item = await fetchSameBidItem(bidId, newItemId);
  if (!item) return { ok: false, error: "Not found" };
  if (obs.bidId !== item.bidId) return { ok: false, error: "Not found" };

  const priorItemId = obs.registerItemId;
  await prisma.consultantObservation.update({
    where: { id: observationId },
    data: { registerItemId: newItemId },
  });
  await audit(
    "observation_link_corrected",
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    "relinked",
    { reportId, priorTrackedItemId: priorItemId, trackedItemId: newItemId }
  );
  return { ok: true, value: { observationId, trackedItemId: newItemId } };
}

// ── Dismiss / reinstate ──────────────────────────────────────────────────────

export async function dismissObservation(
  bidId: number,
  reportId: number,
  observationId: number,
  reason: string | null,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const obs = await findObservation(bidId, reportId, observationId);
  if (!obs) return { ok: false, error: "Not found" };
  if (obs.state !== "ENTERED") {
    return { ok: false, error: `Cannot dismiss from state ${obs.state}` };
  }

  await prisma.consultantObservation.update({
    where: { id: observationId },
    data: { state: "DISMISSED", dismissedReason: reason?.trim().slice(0, 500) || null },
  });
  await audit(
    "observation_dismissed",
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    "dismissed",
    { reportId, hasReason: Boolean(reason?.trim()) }
  );
  return { ok: true, value: { id: observationId } };
}

export async function reinstateObservation(
  bidId: number,
  reportId: number,
  observationId: number,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const obs = await findObservation(bidId, reportId, observationId);
  if (!obs) return { ok: false, error: "Not found" };
  if (obs.state !== "DISMISSED") {
    return { ok: false, error: `Cannot reinstate from state ${obs.state}` };
  }

  await prisma.consultantObservation.update({
    where: { id: observationId },
    data: { state: "ENTERED", dismissedReason: null },
  });
  await audit(
    "observation_reinstated",
    bidId,
    { kind: "ConsultantObservation", id: String(observationId) },
    actor,
    "reinstated",
    { reportId }
  );
  return { ok: true, value: { id: observationId } };
}
