import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const logs = await prisma.outreachLog.findMany({
      where: { bidId },
      include: {
        subcontractor: { select: { company: true } },
        contact: { select: { name: true, email: true } },
        question: { select: { tradeName: true, questionText: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(logs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /bids/:id/outreach] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
