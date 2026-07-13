// Module OPS5 — dismiss a proposed design intent change (kept on record).
//
// POST …/design-changes/[dcId]/dismiss   Body: { reason? }
// PROPOSED → DISMISSED only; reinstatable; audited; never deleted.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { dismissDesignChange } from "@/lib/services/meetings/designLog";

export async function POST(
  request: Request,
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

  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    // body optional
  }

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await dismissDesignChange(bidId, mId, changeId, reason, {
    name: su?.name ?? null,
    email: su?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
