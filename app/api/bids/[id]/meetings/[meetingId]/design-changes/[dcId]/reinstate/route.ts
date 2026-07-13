// Module OPS5 — reinstate a dismissed design intent change.
//
// POST …/design-changes/[dcId]/reinstate
// DISMISSED → PROPOSED only, audited.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { reinstateDesignChange } from "@/lib/services/meetings/designLog";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; dcId: string }> }
) {
  const { id, meetingId, dcId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  const changeId = parseInt(dcId, 10);
  if (isNaN(bidId) || isNaN(mId) || isNaN(changeId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await reinstateDesignChange(bidId, mId, changeId, {
    name: su?.name ?? null,
    email: su?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
