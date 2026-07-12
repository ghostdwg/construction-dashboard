// Module OPS3 (Phase 1A) — pre-resolution edit of one observation.
//
// PATCH …/[reportId]/observations/[observationId]
//
// Allowed ONLY while state === ENTERED. The instant an observation is
// accepted or dismissed, its source-verbatim fields (observationText,
// sourcePage, consultantTargetDate) FREEZE — a PATCH against a resolved
// row returns 400 with zero mutation; corrections then belong on the
// TrackedItem, never on the source row.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { editObservation } from "@/lib/services/consultantReports/observations";

export async function PATCH(
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
    observationText?: unknown;
    sourcePage?: unknown;
    consultantTargetDate?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: {
    observationText?: string;
    sourcePage?: string | null;
    consultantTargetDate?: Date | null;
  } = {};
  if (body.observationText !== undefined) {
    if (typeof body.observationText !== "string") {
      return Response.json({ error: "Invalid observationText" }, { status: 400 });
    }
    patch.observationText = body.observationText;
  }
  if (body.sourcePage !== undefined) {
    if (body.sourcePage !== null && typeof body.sourcePage !== "string") {
      return Response.json({ error: "Invalid sourcePage" }, { status: 400 });
    }
    patch.sourcePage = body.sourcePage;
  }
  if (body.consultantTargetDate !== undefined) {
    if (body.consultantTargetDate === null) {
      patch.consultantTargetDate = null;
    } else if (typeof body.consultantTargetDate === "string") {
      const d = new Date(body.consultantTargetDate);
      if (isNaN(d.getTime())) {
        return Response.json({ error: "Invalid consultantTargetDate" }, { status: 400 });
      }
      patch.consultantTargetDate = d;
    } else {
      return Response.json({ error: "Invalid consultantTargetDate" }, { status: 400 });
    }
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await editObservation(bidId, rid, oid, patch, {
    name: user?.name ?? null,
    email: user?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
