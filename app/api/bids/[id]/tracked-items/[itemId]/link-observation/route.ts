// Module OPS3 (Phase 1A) — link/relink a consultant observation to THIS item.
//
// POST …/tracked-items/[itemId]/link-observation
//   Body: { reportId, observationId }
//
// Item-centric entry point for the citation chain: an ENTERED observation
// is LINKED (ACCEPTED_LINKED_ITEM); an already-linked observation is
// RELINKED to this item as an audited correction (prior/new recorded).
// Both paths double-fetch — the observation scoped by this bid AND report,
// the item scoped by this bid — then assert same-bid as defense in depth
// (SQLite cannot express the constraint). A cross-project attempt is a
// 404 with ZERO mutation, never a data leak.

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  linkObservationToItem,
  relinkObservation,
} from "@/lib/services/consultantReports/observations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: { reportId?: unknown; observationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rid = typeof body.reportId === "number" ? body.reportId : NaN;
  const oid = typeof body.observationId === "number" ? body.observationId : NaN;
  if (isNaN(rid) || isNaN(oid)) {
    return Response.json(
      { error: "reportId and observationId are required" },
      { status: 400 }
    );
  }

  // Bid-scoped state probe decides link vs relink; the service re-fetches
  // and re-asserts everything before any write.
  const obs = await prisma.consultantObservation.findFirst({
    where: { id: oid, reportId: rid, bidId },
    select: { state: true },
  });
  if (!obs) return Response.json({ error: "Not found" }, { status: 404 });

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;
  const actor = { name: user?.name ?? null, email: user?.email ?? null };

  const result =
    obs.state === "ACCEPTED_LINKED_ITEM"
      ? await relinkObservation(bidId, rid, oid, tid, actor)
      : await linkObservationToItem(bidId, rid, oid, tid, actor);

  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({
    ok: true,
    trackedItemId: result.value.trackedItemId,
    relinked: obs.state === "ACCEPTED_LINKED_ITEM",
  });
}
