// Module OPS3 (Phase 1A) — the audited formal-response PATCH.
//
// PATCH …/tracked-items/[itemId]/formal-response   Body: { formalResponse }
//
// ONE stored value per item (TrackedItem.formalResponse); both edit
// surfaces (Register Item detail, Consultant Report detail) call THIS
// route. Explicit save only — no autosave. Every edit records the prior
// value on the item (formalResponsePrior). The mandatory AuditEvent is
// transactional and carries lengths only; no generic audit/stdout carries response text (see
// lib/services/consultantReports/formalResponse.ts for the split
// fan-out). TrackedItemComment is untouched — a comment thread is not a
// formal response.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { setFormalResponse } from "@/lib/services/consultantReports/formalResponse";

export async function PATCH(
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

  let body: { formalResponse?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.formalResponse !== "string") {
    return Response.json({ error: "formalResponse is required" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await setFormalResponse(bidId, tid, body.formalResponse, {
    id: access.user.id,
    name: user?.name ?? null,
    email: user?.email ?? null,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
