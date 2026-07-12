// Module OPS3 (Phase 1A) — dismiss an observation (kept on record).
//
// POST …/observations/[observationId]/dismiss   Body: { reason? }
//
// ENTERED → DISMISSED only. Reason optional; actor + timestamp always
// audited. A dismissed observation stays listed ("Dismissed — kept on
// record") and can be reinstated — never deleted.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { dismissObservation } from "@/lib/services/consultantReports/observations";

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

  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    // body optional
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await dismissObservation(bidId, rid, oid, reason, {
    name: user?.name ?? null,
    email: user?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
