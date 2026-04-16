// PATCH /api/bids/[id]/submittals/distribution-templates/[templateId]
//   Partial update. Body: { responsibleContractor?, submittalManager?,
//   reviewers?, distribution? }
//
// DELETE /api/bids/[id]/submittals/distribution-templates/[templateId]

import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  const { id, templateId } = await params;
  const bidId = parseInt(id, 10);
  const tmplId = parseInt(templateId, 10);
  if (isNaN(bidId) || isNaN(tmplId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.submittalDistributionTemplate.findFirst({
    where: { id: tmplId, bidId },
    select: { id: true },
  });
  if (!existing)
    return Response.json({ error: "Template not found" }, { status: 404 });

  const body = (await request.json()) as {
    responsibleContractor?: string | null;
    submittalManager?: string | null;
    reviewers?: string[];
    distribution?: string[];
  };

  const data: Record<string, unknown> = {};
  if ("responsibleContractor" in body)
    data.responsibleContractor = body.responsibleContractor?.trim() || null;
  if ("submittalManager" in body)
    data.submittalManager = body.submittalManager?.trim() || null;
  if ("reviewers" in body && Array.isArray(body.reviewers))
    data.reviewers = JSON.stringify(
      body.reviewers.map((r) => String(r).trim()).filter(Boolean)
    );
  if ("distribution" in body && Array.isArray(body.distribution))
    data.distribution = JSON.stringify(
      body.distribution.map((r) => String(r).trim()).filter(Boolean)
    );

  await prisma.submittalDistributionTemplate.update({
    where: { id: tmplId },
    data,
  });

  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  const { id, templateId } = await params;
  const bidId = parseInt(id, 10);
  const tmplId = parseInt(templateId, 10);
  if (isNaN(bidId) || isNaN(tmplId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.submittalDistributionTemplate.findFirst({
    where: { id: tmplId, bidId },
    select: { id: true },
  });
  if (!existing)
    return Response.json({ error: "Template not found" }, { status: 404 });

  await prisma.submittalDistributionTemplate.delete({ where: { id: tmplId } });
  return Response.json({ ok: true });
}
