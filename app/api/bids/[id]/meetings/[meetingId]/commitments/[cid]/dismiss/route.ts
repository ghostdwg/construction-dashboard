// Module OPS7 — dismiss a commitment (PROPOSED → DISMISSED, kept on record).
//
// POST …/commitments/[cid]/dismiss
// Any authenticated user (session wall + requireBidAccess); audited.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { dismissCommitment } from "@/lib/services/meetings/commitments";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; cid: string }> }
) {
  const { id, meetingId, cid } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  const commitmentId = parseInt(cid, 10);
  if (isNaN(bidId) || isNaN(mId) || isNaN(commitmentId))
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

  const result = await dismissCommitment(bidId, mId, commitmentId, reason, {
    name: su?.name ?? null,
    email: su?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, ...result.value });
}
