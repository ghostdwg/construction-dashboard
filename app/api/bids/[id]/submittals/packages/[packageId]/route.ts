// PATCH  /api/bids/[id]/submittals/packages/[packageId]
//   Update package fields: name, status, responsibleContractor, submittalManager.
//
// DELETE /api/bids/[id]/submittals/packages/[packageId]
//   Delete the package. Items become unassigned (packageId → null via onDelete: SetNull).

import { prisma } from "@/lib/prisma";

const VALID_PKG_STATUSES = new Set([
  "DRAFT",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
  "CLOSED",
]);

async function loadPackage(bidId: number, pkgId: number) {
  const pkg = await prisma.submittalPackage.findUnique({
    where: { id: pkgId },
    select: { bidId: true },
  });
  if (!pkg || pkg.bidId !== bidId) return null;
  return pkg;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; packageId: string }> }
) {
  const { id, packageId } = await params;
  const bidId = parseInt(id, 10);
  const pkgId = parseInt(packageId, 10);
  if (isNaN(bidId) || isNaN(pkgId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const pkg = await loadPackage(bidId, pkgId);
  if (!pkg) return Response.json({ error: "Package not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    status?: string;
    responsibleContractor?: string | null;
    submittalManager?: string | null;
    linkedActivityId?: string | null;
    defaultLeadTimeDays?: number | null;
    defaultReviewBufferDays?: number | null;
    defaultResubmitBufferDays?: number | null;
    releasePhase?: string | null;
    targetIssueDate?: string | null;
    requiredReturnDate?: string | null;
    readyForExport?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if (body.status && VALID_PKG_STATUSES.has(body.status)) data.status = body.status;
  if ("responsibleContractor" in body)
    data.responsibleContractor = body.responsibleContractor;
  if ("submittalManager" in body)
    data.submittalManager = body.submittalManager;
  if ("linkedActivityId" in body)
    data.linkedActivityId = body.linkedActivityId ?? null;
  if ("defaultLeadTimeDays" in body)
    data.defaultLeadTimeDays = typeof body.defaultLeadTimeDays === "number" ? body.defaultLeadTimeDays : null;
  if ("defaultReviewBufferDays" in body)
    data.defaultReviewBufferDays = typeof body.defaultReviewBufferDays === "number" ? body.defaultReviewBufferDays : null;
  if ("defaultResubmitBufferDays" in body)
    data.defaultResubmitBufferDays = typeof body.defaultResubmitBufferDays === "number" ? body.defaultResubmitBufferDays : null;
  if ("releasePhase" in body)
    data.releasePhase = body.releasePhase?.trim() || null;
  if ("targetIssueDate" in body)
    data.targetIssueDate = body.targetIssueDate ? new Date(body.targetIssueDate) : null;
  if ("requiredReturnDate" in body)
    data.requiredReturnDate = body.requiredReturnDate ? new Date(body.requiredReturnDate) : null;
  if ("readyForExport" in body)
    data.readyForExport = body.readyForExport === true;

  await prisma.submittalPackage.update({ where: { id: pkgId }, data });
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; packageId: string }> }
) {
  const { id, packageId } = await params;
  const bidId = parseInt(id, 10);
  const pkgId = parseInt(packageId, 10);
  if (isNaN(bidId) || isNaN(pkgId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const pkg = await loadPackage(bidId, pkgId);
  if (!pkg) return Response.json({ error: "Package not found" }, { status: 404 });

  await prisma.submittalPackage.delete({ where: { id: pkgId } });
  return Response.json({ ok: true });
}
