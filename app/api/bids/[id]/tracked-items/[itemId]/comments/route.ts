// Module OPS1 (Slice 1) — append-only comment thread (no edit/delete routes
// by design; the thread is an honest trail).
//
// GET  /api/bids/[id]/tracked-items/[itemId]/comments
// POST /api/bids/[id]/tracked-items/[itemId]/comments   body: { body }

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { addComment, listComments } from "@/lib/services/trackedItems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const comments = await listComments(bidId, tid);
  if (comments === null) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    comments: comments.map((c) => ({
      id: c.id,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: { body?: unknown };
  try {
    body = (await request.json()) as { body?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.body !== "string") {
    return Response.json({ error: "body is required" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await addComment(
    bidId,
    tid,
    { name: user?.name ?? null, email: user?.email ?? null },
    body.body
  );
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ id: result.value.id }, { status: 201 });
}
