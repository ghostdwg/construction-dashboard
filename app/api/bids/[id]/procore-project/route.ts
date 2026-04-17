// PATCH /api/bids/[id]/procore-project
//
// Tier F F2 — Link (or unlink) a Procore project to this bid.
//
// Body: { procoreProjectId: string | null }
// Returns: { ok: true } on success.

import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  let body: { procoreProjectId?: string | null };
  try {
    body = (await request.json()) as { procoreProjectId?: string | null };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const procoreProjectId =
    typeof body.procoreProjectId === "string"
      ? body.procoreProjectId.trim() || null
      : null;

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  await prisma.bid.update({
    where: { id: bidId },
    data: { procoreProjectId },
  });

  return Response.json({ ok: true });
}
