import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bidId = searchParams.get("bidId");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const tradeName = searchParams.get("tradeName");

  try {
    const logs = await prisma.outreachLog.findMany({
      where: {
        ...(bidId ? { bidId: parseInt(bidId, 10) } : {}),
        ...(status ? { status } : {}),
        ...(search
          ? { subcontractor: { company: { contains: search } } }
          : {}),
        ...(tradeName
          ? { question: { tradeName: { contains: tradeName } } }
          : {}),
      },
      include: {
        bid: { select: { projectName: true } },
        subcontractor: { select: { company: true } },
        contact: { select: { name: true, email: true } },
        question: { select: { tradeName: true, questionText: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(logs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/outreach] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
