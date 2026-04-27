import { prisma } from "@/lib/prisma";
import { isAdminAuthorized } from "@/lib/auth";

type Params = Promise<{ id: string; itemId: string }>;

export async function PATCH(
  request: Request,
  { params }: { params: Params }
) {
  const authz = await isAdminAuthorized();
  if (!authz.authorized)
    return Response.json({ error: authz.error }, { status: authz.status });

  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const siId  = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(siId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "increment" && body.action !== "reset")
    return Response.json({ error: "action must be increment or reset" }, { status: 400 });

  const item = await prisma.submittalItem.findFirst({
    where: { id: siId, bidId },
    select: { id: true, reviewRound: true },
  });
  if (!item)
    return Response.json({ error: "Not found" }, { status: 404 });

  const newRound = body.action === "increment" ? item.reviewRound + 1 : 1;

  await prisma.submittalItem.update({
    where: { id: siId },
    data: {
      reviewRound: newRound,
      status: "PENDING",
      receivedAt: null,
      reviewedAt: null,
      approvedAt: null,
    },
  });

  return Response.json({ ok: true, reviewRound: newRound });
}
