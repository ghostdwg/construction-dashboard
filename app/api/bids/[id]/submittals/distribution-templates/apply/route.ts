// POST /api/bids/[id]/submittals/distribution-templates/apply
//
// Pushes template values (responsibleContractor, submittalManager,
// defaultReviewers, defaultDistribution) to every SubmittalPackage whose
// bidTradeId matches a template. Returns the count of packages updated.

import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const templates = await prisma.submittalDistributionTemplate.findMany({
    where: { bidId, bidTradeId: { not: null } },
  });

  if (templates.length === 0)
    return Response.json({ ok: true, updated: 0 });

  let updated = 0;
  await Promise.all(
    templates.map(async (t) => {
      const result = await prisma.submittalPackage.updateMany({
        where: { bidId, bidTradeId: t.bidTradeId! },
        data: {
          responsibleContractor: t.responsibleContractor,
          submittalManager: t.submittalManager,
          defaultReviewers: t.reviewers,
          defaultDistribution: t.distribution,
        },
      });
      updated += result.count;
    })
  );

  return Response.json({ ok: true, updated });
}
