// Module OPS4 (Phase 1B) — PM review flag.
//
// PATCH …/tracked-items/[itemId]/pm-review-flag   Body: { pmReviewRequired: boolean }
//   Roles: pm | admin ONLY, for BOTH set and clear (operator decision
//   2026-07-13). MANUAL ONLY — nothing sets this flag automatically, not
//   observation links, not dispositions, not status transitions. Audited
//   both directions.

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUser, requireBidAccess, ROLES } from "@/lib/auth-helpers";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  emitOperationsAuditPostCommit,
  writeOperationsAuditTx,
} from "@/lib/services/operationsAudit";

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

  const user = await getUser();
  if (!user || (user.role !== ROLES.ADMIN && user.role !== ROLES.PM)) {
    return Response.json(
      { error: "The PM review flag requires admin or pm" },
      { status: 403 }
    );
  }

  let body: { pmReviewRequired?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.pmReviewRequired !== "boolean") {
    return Response.json({ error: "pmReviewRequired must be a boolean" }, { status: 400 });
  }
  const pmReviewRequired = body.pmReviewRequired;

  const item = await prisma.trackedItem.findFirst({
    where: { id: tid, bidId },
    select: { id: true, pmReviewRequired: true },
  });
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  const session = await auth().catch(() => null);
  const su = session?.user as { email?: string | null } | undefined;
  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.trackedItem.update({
      where: { id: tid },
      data: { pmReviewRequired },
    });
    envelope = await writeOperationsAuditTx(tx, {
      action: pmReviewRequired ? "pm_review_flagged" : "pm_review_cleared",
      decision: pmReviewRequired ? "flagged" : "cleared",
      subjectKind: "TrackedItem",
      subjectId: tid,
      actor: { id: access.user.id, email: su?.email ?? null },
      payload: { bidId, prior: item.pmReviewRequired },
    });
  });
  emitOperationsAuditPostCommit(envelope);

  return Response.json({ ok: true, pmReviewRequired });
}
