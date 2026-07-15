// Module OPS5 — confirm a proposed design intent change (human-only).
//
// POST …/design-changes/[dcId]/confirm
//   Body: { createItem?: boolean, title?: string }
//
// Any authenticated user (session wall + requireBidAccess); PROPOSED-only.
// With createItem, a TrackedItem is created citing the meeting (verbatim
// quote as evidence, affectedSpec as locator) and linked — atomically.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { confirmDesignChange } from "@/lib/services/meetings/designLog";

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

  let body: { createItem?: unknown; title?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await confirmDesignChange(
    bidId,
    mId,
    changeId,
    {
      createItem: body.createItem === true,
      title: typeof body.title === "string" ? body.title : null,
    },
    { name: su?.name ?? null, email: su?.email ?? null }
  );
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, ...result.value });
}
