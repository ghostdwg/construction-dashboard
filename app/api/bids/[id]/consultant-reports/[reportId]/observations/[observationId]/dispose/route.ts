// Module OPS4 (Phase 1B) — record a consultant disposition (append-only).
//
// POST …/observations/[observationId]/dispose
//   Body: { dispositionType: APPROVE|REJECT|DEFER|VOID, dispositionText? }
//   Roles: pm | admin ONLY (403 otherwise) — extends the void-authority
//   precedent to the second judgment surface.
//
// APPEND-ONLY at every layer: this file answers PATCH/PUT/DELETE with an
// explicit 405 (a deliberate handler, not a framework default); the
// service exports no mutating function; lib/prisma.ts's client extension
// throws on update/upsert/delete for this model. Corrections are made by
// appending another record. GET returns the chronological log.

import { auth } from "@/lib/auth";
import { getUser, requireBidAccess, ROLES } from "@/lib/auth-helpers";
import {
  listDispositions,
  recordDisposition,
} from "@/lib/services/consultantReports/dispositions";

type Params = { params: Promise<{ id: string; reportId: string; observationId: string }> };

function parseIds(id: string, reportId: string, observationId: string) {
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  const oid = parseInt(observationId, 10);
  return isNaN(bidId) || isNaN(rid) || isNaN(oid) ? null : { bidId, rid, oid };
}

const METHOD_NOT_ALLOWED = () =>
  Response.json(
    { error: "Disposition records are append-only — correct by appending a new record" },
    { status: 405 }
  );

export async function POST(request: Request, { params }: Params) {
  const { id, reportId, observationId } = await params;
  const ids = parseIds(id, reportId, observationId);
  if (!ids) return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(ids.bidId);
  if (!access.ok) return access.response;

  const user = await getUser();
  if (!user || (user.role !== ROLES.ADMIN && user.role !== ROLES.PM)) {
    return Response.json(
      { error: "Recording a disposition requires admin or pm" },
      { status: 403 }
    );
  }

  let body: { dispositionType?: unknown; dispositionText?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.dispositionType !== "string") {
    return Response.json({ error: "dispositionType is required" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await recordDisposition(
    ids.bidId,
    ids.rid,
    ids.oid,
    {
      dispositionType: body.dispositionType,
      dispositionText: typeof body.dispositionText === "string" ? body.dispositionText : null,
    },
    { name: su?.name ?? null, email: su?.email ?? null }
  );
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, dispositionId: result.value.id }, { status: 201 });
}

export async function GET(_request: Request, { params }: Params) {
  const { id, reportId, observationId } = await params;
  const ids = parseIds(id, reportId, observationId);
  if (!ids) return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(ids.bidId);
  if (!access.ok) return access.response;

  const dispositions = await listDispositions(ids.bidId, ids.rid, ids.oid);
  if (dispositions === null) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ dispositions });
}

export async function PATCH() {
  return METHOD_NOT_ALLOWED();
}
export async function PUT() {
  return METHOD_NOT_ALLOWED();
}
export async function DELETE() {
  return METHOD_NOT_ALLOWED();
}
