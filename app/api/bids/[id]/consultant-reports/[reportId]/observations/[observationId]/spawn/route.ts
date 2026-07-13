// Module OPS4 (Phase 1B) — SPAWN a Register Item from an observation.
//
// POST …/observations/[observationId]/spawn
//   Body: { title, description?, kind?, priority?, dueDate?, assigneeName? }
//   Roles: pm | admin ONLY (operator decision 2026-07-13).
//
// One creation path shared with 1A's accept-new: creates the TrackedItem
// (verbatim evidence carried, item-side originating FK), sets the
// observation's spawnedItemId ("this observation CAUSED this item") AND
// registerItemId (it also supports it) and flips state to
// ACCEPTED_NEW_ITEM — atomically. Linking an existing item never sets
// spawnedItemId; that null is what distinguishes linked from spawned.
// dueDate arrives ONLY as explicit human input — never copied from
// consultantTargetDate. Cross-project → 404, zero mutation.

import { auth } from "@/lib/auth";
import { getUser, requireBidAccess, ROLES } from "@/lib/auth-helpers";
import { spawnItemFromObservation } from "@/lib/services/consultantReports/observations";

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

  const user = await getUser();
  if (!user || (user.role !== ROLES.ADMIN && user.role !== ROLES.PM)) {
    return Response.json(
      { error: "Spawning a Register Item requires admin or pm" },
      { status: 403 }
    );
  }

  let body: {
    title?: unknown;
    description?: unknown;
    kind?: unknown;
    priority?: unknown;
    dueDate?: unknown;
    assigneeName?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.title !== "string") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  let dueDate: Date | null = null;
  if (body.dueDate != null) {
    if (typeof body.dueDate !== "string") {
      return Response.json({ error: "Invalid dueDate" }, { status: 400 });
    }
    dueDate = new Date(body.dueDate);
    if (isNaN(dueDate.getTime())) {
      return Response.json({ error: "Invalid dueDate" }, { status: 400 });
    }
  }

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await spawnItemFromObservation(
    bidId,
    rid,
    oid,
    {
      title: body.title,
      description: typeof body.description === "string" ? body.description : null,
      kind: typeof body.kind === "string" ? body.kind : undefined,
      priority: typeof body.priority === "string" ? body.priority : undefined,
      dueDate,
      assigneeName: typeof body.assigneeName === "string" ? body.assigneeName : null,
    },
    { name: su?.name ?? null, email: su?.email ?? null }
  );
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json(
    { ok: true, trackedItemId: result.value.trackedItemId, spawnedItemId: result.value.trackedItemId },
    { status: 201 }
  );
}
