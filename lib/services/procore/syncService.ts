// Tier F F3 — Procore sync service (bidirectional)
//
// pullRfis:              fetch all RFIs from a Procore project, upsert into RfiItem
// syncSubmittalStatuses: fetch Procore submittal statuses, update our SubmittalItem records
// processWebhookEvent:   mark a ProcoreWebhookEvent as processed (called from webhook receiver)
//
// Both pull functions return a SyncResult for display in the UI.
// Procore statuses are mapped to our uppercase status strings before saving.

import { prisma } from "@/lib/prisma";
import { procoreGet } from "@/lib/services/procore/client";

// ── Types ──────────────────────────────────────────────────────────────────

export type SyncResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type ProcoreRfi = {
  id: number;
  number: string | null;
  title: string;
  question: string | null;
  answer: string | null;
  status: string;
  priority: string | null;
  rfi_manager: { name: string } | null;
  assignees: Array<{ name: string }> | null;
  due_date: string | null;
};

type ProcoreSubmittal = {
  id: number;
  title: string;
  status: string;
};

// ── Procore submittal status → our SubmittalItem status ────────────────────
//
// Procore statuses: draft | open | pending_qa | qa_approved |
//                  revise_resubmit | approved | approved_as_noted |
//                  rejected | closed | void
//
// Our statuses (from SubmittalsTab.tsx SUBMITTAL_STATUSES):
//   PENDING | REQUESTED | RECEIVED | UNDER_REVIEW |
//   APPROVED | APPROVED_AS_NOTED | REJECTED | RESUBMIT

function mapProcoreSubmittalStatus(procoreStatus: string): string {
  const s = procoreStatus.toLowerCase().replace(/_/g, " ");
  if (s === "approved") return "APPROVED";
  if (s === "approved as noted") return "APPROVED_AS_NOTED";
  if (s === "rejected") return "REJECTED";
  if (s === "revise resubmit") return "RESUBMIT";
  if (s === "qa approved") return "UNDER_REVIEW";
  if (s === "pending qa") return "RECEIVED";
  if (s === "open") return "REQUESTED";
  return "PENDING";
}

// ── pullRfis ───────────────────────────────────────────────────────────────
//
// Fetches all RFIs from the given Procore project, then upserts each into the
// RfiItem table. Existing rows (matched by procoreRfiId) are updated; new RFIs
// are created. Returns created/updated/skipped/errors counts.

export async function pullRfis(bidId: number, procoreProjectId: string): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  let rfis: ProcoreRfi[];
  try {
    rfis = await procoreGet<ProcoreRfi[]>(
      `/rest/v1.0/projects/${procoreProjectId}/rfis`
    );
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "Failed to fetch RFIs from Procore");
    return result;
  }

  for (const rfi of rfis) {
    try {
      const assigneeName =
        rfi.assignees?.[0]?.name ?? rfi.rfi_manager?.name ?? null;
      const rfiNumber = rfi.number ?? String(rfi.id);

      const data = {
        number: rfiNumber,
        title: rfi.title,
        question: rfi.question ?? null,
        answer: rfi.answer ?? null,
        status: rfi.status,
        priority: rfi.priority ?? null,
        assigneeName,
        dueDate: rfi.due_date ? new Date(rfi.due_date) : null,
        syncedAt: new Date(),
      };

      const existing = await prisma.rfiItem.findUnique({
        where: { bidId_procoreRfiId: { bidId, procoreRfiId: rfi.id } },
        select: { id: true },
      });

      if (existing) {
        await prisma.rfiItem.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        await prisma.rfiItem.create({ data: { bidId, procoreRfiId: rfi.id, ...data } });
        result.created++;
      }
    } catch (err) {
      const label = rfi.number ?? String(rfi.id);
      result.errors.push(
        `RFI ${label}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      if (result.errors.length >= 50) break;
    }
  }

  return result;
}

// ── syncSubmittalStatuses ──────────────────────────────────────────────────
//
// Fetches all submittals from the given Procore project, then matches them to
// our SubmittalItem records by title (case-insensitive). Where the Procore
// status differs from our status, we update our record. Unmatched submittals
// are skipped.

export async function syncSubmittalStatuses(
  bidId: number,
  procoreProjectId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  let procoreSubmittals: ProcoreSubmittal[];
  try {
    procoreSubmittals = await procoreGet<ProcoreSubmittal[]>(
      `/rest/v1.0/projects/${procoreProjectId}/submittals`
    );
  } catch (err) {
    result.errors.push(
      err instanceof Error ? err.message : "Failed to fetch submittals from Procore"
    );
    return result;
  }

  // Build a title → status map for fast lookup
  const procoreStatusByTitle = new Map<string, string>();
  for (const sub of procoreSubmittals) {
    procoreStatusByTitle.set(sub.title.toLowerCase().trim(), sub.status);
  }

  const ourSubmittals = await prisma.submittalItem.findMany({
    where: { bidId },
    select: { id: true, title: true, status: true },
  });

  for (const sub of ourSubmittals) {
    const procoreStatus = procoreStatusByTitle.get(sub.title.toLowerCase().trim());
    if (!procoreStatus) {
      result.skipped++;
      continue;
    }

    const mapped = mapProcoreSubmittalStatus(procoreStatus);
    if (mapped === sub.status) {
      result.skipped++;
      continue;
    }

    try {
      await prisma.submittalItem.update({
        where: { id: sub.id },
        data: { status: mapped },
      });
      result.updated++;
    } catch (err) {
      result.errors.push(
        `"${sub.title}": ${err instanceof Error ? err.message : "Unknown error"}`
      );
      if (result.errors.length >= 50) break;
    }
  }

  return result;
}

// ── processWebhookEvent ────────────────────────────────────────────────────
//
// Called after storing an incoming Procore webhook event. For F3 we mark the
// event as processed immediately — real-time auto-sync is left for F3+.
// Estimators use the manual pull buttons on the Procore tab.

export async function processWebhookEvent(eventId: number): Promise<void> {
  try {
    await prisma.procoreWebhookEvent.update({
      where: { id: eventId },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (err) {
    await prisma.procoreWebhookEvent
      .update({
        where: { id: eventId },
        data: {
          processed: true,
          processedAt: new Date(),
          error: err instanceof Error ? err.message : "Unknown error",
        },
      })
      .catch(() => {
        /* best-effort */
      });
  }
}
