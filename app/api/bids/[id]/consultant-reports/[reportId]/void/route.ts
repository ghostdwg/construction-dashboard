// Module OPS3 (Phase 1A) — void a consultant report (status flip).
//
// POST …/consultant-reports/[reportId]/void
//
// THE FIRST ROLE-GATED OPS ROUTE — deliberately precedent-setting: void
// authority is admin|pm ONLY; estimator (or any other role) gets 403.
// Voiding flips status to VOIDED and records actor/timestamp. The file,
// revisions, observations, and any accepted Register history are RETAINED
// — a voided source degrades to a badge, never a hole. There is no
// hard-delete route, by design.

import { auth } from "@/lib/auth";
import { getUser, ROLES } from "@/lib/auth-helpers";
import { voidConsultantReport } from "@/lib/services/consultantReports";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const user = await getUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== ROLES.ADMIN && user.role !== ROLES.PM) {
    return Response.json(
      { error: "Voiding a consultant report requires admin or pm" },
      { status: 403 }
    );
  }

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await voidConsultantReport(bidId, rid, {
    name: su?.name ?? null,
    email: su?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, status: "VOIDED" });
}
