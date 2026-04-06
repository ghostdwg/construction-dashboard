import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// PATCH /api/bids/[id]/specbook/sections/[sectionId]
// Body: { tradeId: number | null }
// Manually assigns (or clears) a trade for a spec section.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id, sectionId } = await params;
  const bidId = parseInt(id, 10);
  const secId = parseInt(sectionId, 10);

  if (isNaN(bidId) || isNaN(secId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { tradeId } = body as { tradeId: number | null };

  if (tradeId !== null && tradeId !== undefined && typeof tradeId !== "number") {
    return Response.json({ error: "tradeId must be a number or null" }, { status: 400 });
  }

  try {
    const section = await prisma.specSection.update({
      where: { id: secId },
      data: {
        tradeId: tradeId ?? null,
        covered: tradeId != null,
      },
      include: { trade: { select: { id: true, name: true } } },
    });

    return Response.json(section);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return Response.json({ error: "Section not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
