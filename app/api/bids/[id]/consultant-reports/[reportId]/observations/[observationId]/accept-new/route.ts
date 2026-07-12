// Module OPS3 (Phase 1A) — accept an observation as a NEW Register Item.
//
// POST …/observations/[observationId]/accept-new
//   Body: { title, description?, kind?, priority?, dueDate?, assigneeName? }
//
// HUMAN-ONLY: creates a TrackedItem on the shared spine citing this
// observation (sourceKind consultant_report + originating FK), then flips
// the observation to ACCEPTED_NEW_ITEM and freezes its verbatim fields.
// dueDate arrives ONLY as explicit human-confirmed input (the UI may
// pre-fill it from consultantTargetDate once, at creation — the server
// never copies it). Cross-project attempts are 404 with zero mutation.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { acceptObservationAsNewItem } from "@/lib/services/consultantReports/observations";

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
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await acceptObservationAsNewItem(
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
    { name: user?.name ?? null, email: user?.email ?? null }
  );
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json(
    { ok: true, trackedItemId: result.value.trackedItemId },
    { status: 201 }
  );
}
