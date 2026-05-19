// POST /api/market-intelligence/workspace/watchlists/[id]/items
//   body: { subjectKind, subjectId, projectId?, parcelId?, entityId?,
//           displayLabel?, displayContext?, priority?, notes? }
//
// DELETE /api/market-intelligence/workspace/watchlists/[id]/items
//   body: { watchlistItemId, reason? }
//
// Auth required. Returns { ok, id|alreadyAttached?|error? }.

import { auth } from "@/lib/auth";
import { addWatchlistItem, removeWatchlistItem } from "@/lib/services/operatorWorkspace";

async function requireUser() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string } | undefined;
  if (!user) return { ok: false as const, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true as const, actor: { userId: user.id ?? null, email: user.email ?? null } };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireUser();
  if (!a.ok) return a.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    subjectKind?: string;
    subjectId?: string;
    projectId?: string | null;
    parcelId?: string | null;
    entityId?: string | null;
    displayLabel?: string;
    displayContext?: string;
    priority?: number;
    notes?: string;
  };

  if (!body.subjectKind || !body.subjectId) {
    return Response.json({ ok: false, error: "subjectKind and subjectId are required" }, { status: 400 });
  }

  const result = await addWatchlistItem({
    watchlistId: id,
    subjectKind: body.subjectKind,
    subjectId: body.subjectId,
    projectId: body.projectId ?? null,
    parcelId: body.parcelId ?? null,
    entityId: body.entityId ?? null,
    displayLabel: body.displayLabel,
    displayContext: body.displayContext,
    priority: body.priority,
    notes: body.notes,
    actor: a.actor,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(request: Request) {
  const a = await requireUser();
  if (!a.ok) return a.response;

  const body = (await request.json().catch(() => ({}))) as {
    watchlistItemId?: string;
    reason?: string;
  };
  if (!body.watchlistItemId) {
    return Response.json({ ok: false, error: "watchlistItemId is required" }, { status: 400 });
  }

  const result = await removeWatchlistItem({
    watchlistItemId: body.watchlistItemId,
    reason: body.reason,
    actor: a.actor,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
