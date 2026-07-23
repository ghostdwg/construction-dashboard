import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  extractDraftRequirementCandidates,
  listRequirementCandidates,
} from "@/lib/services/specEvidence/candidates";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bidId = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;
  return Response.json({ candidates: await listRequirementCandidates(bidId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bidId = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let requestedId: number | null = null;
  try {
    const body = (await request.json()) as { effectiveSetId?: unknown };
    if (body.effectiveSetId !== undefined && !Number.isInteger(body.effectiveSetId)) {
      return Response.json({ error: "effectiveSetId must be an integer" }, { status: 400 });
    }
    requestedId = (body.effectiveSetId as number | undefined) ?? null;
  } catch {
    // An empty request body means "current published set".
  }
  const effectiveSet =
    requestedId !== null
      ? await prisma.specificationEffectiveSet.findFirst({
          where: { id: requestedId, bidId, status: "PUBLISHED" },
          select: { id: true },
        })
      : await prisma.specificationEffectiveSet.findFirst({
          where: { bidId, activeSlot: 1, status: "PUBLISHED" },
          select: { id: true },
        });
  if (!effectiveSet) {
    return Response.json({ error: "Published effective set not found" }, { status: 404 });
  }
  const result = await extractDraftRequirementCandidates({
    bidId,
    effectiveSetId: effectiveSet.id,
  });
  return Response.json(result, { status: 201 });
}
