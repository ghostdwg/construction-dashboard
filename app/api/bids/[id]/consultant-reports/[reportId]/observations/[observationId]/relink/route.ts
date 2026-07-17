// Module OPS3 (Phase 1A) — relink a linked observation to a different item.
//
// POST …/observations/[observationId]/relink
//   Body: { trackedItemId }
//
// ACCEPTED_LINKED_ITEM only: corrects an erroneous link without going through
// dismiss + reinstate + re-link. The prior item ID is recorded in the audit
// trail. Only the registerItemId changes; the observation state stays
// ACCEPTED_LINKED_ITEM. Same-bid linkage enforced (cross-project → 404).
// relinkObservation() is the service function; this is its missing HTTP surface.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { relinkObservation } from "@/lib/services/consultantReports/observations";

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; reportId: string; observationId: string }> }
) {
  const { id, reportId, observationId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  const oid = parseInt(observationId, 10);
  if (isNaN(bidId) || isNaN(rid) || isNaN(oid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: { trackedItemId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const newItemId =
    typeof body.trackedItemId === "number" ? body.trackedItemId : NaN;
  if (isNaN(newItemId))
    return Response.json({ error: "trackedItemId is required" }, { status: 400 });

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await relinkObservation(bidId, rid, oid, newItemId, {
    name: user?.name ?? null,
    email: user?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, trackedItemId: result.value.trackedItemId });
}
