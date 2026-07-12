// Module OPS3 (Phase 1A) — reinstate a dismissed observation.
//
// POST …/observations/[observationId]/reinstate
//
// DISMISSED → ENTERED only, audited. The row returns to the workbench as
// an open observation; its dismissal remains in the audit trail.

import { auth } from "@/lib/auth";
import { reinstateObservation } from "@/lib/services/consultantReports/observations";

export async function POST(
  _request: Request,
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

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await reinstateObservation(bidId, rid, oid, {
    name: user?.name ?? null,
    email: user?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
