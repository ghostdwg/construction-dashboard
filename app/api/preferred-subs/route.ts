import { prisma } from "@/lib/prisma";

// GET /api/preferred-subs?tradeId=1
// Returns all preferred subs, optionally filtered by trade
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tradeId = searchParams.get("tradeId");

  try {
    const records = await prisma.preferredSub.findMany({
      where: tradeId ? { tradeId: parseInt(tradeId, 10) } : undefined,
      include: {
        trade: { select: { id: true, name: true, costCode: true } },
        subcontractor: {
          select: {
            id: true,
            company: true,
            tier: true,
            status: true,
            contacts: { where: { isPrimary: true }, take: 1 },
          },
        },
      },
      orderBy: [{ tradeId: "asc" }, { createdAt: "asc" }],
    });

    return Response.json(records);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/preferred-subs] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST /api/preferred-subs
// Body: { tradeId: number, subcontractorId: number }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const tradeId = parseInt(body.tradeId, 10);
    const subcontractorId = parseInt(body.subcontractorId, 10);

    if (isNaN(tradeId) || isNaN(subcontractorId)) {
      return Response.json(
        { error: "tradeId and subcontractorId are required" },
        { status: 400 }
      );
    }

    const record = await prisma.preferredSub.create({
      data: { tradeId, subcontractorId },
      include: {
        trade: { select: { id: true, name: true } },
        subcontractor: { select: { id: true, company: true, tier: true } },
      },
    });

    return Response.json(record, { status: 201 });
  } catch (err: unknown) {
    // Unique constraint = already preferred
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint")
    ) {
      return Response.json(
        { error: "This subcontractor is already preferred for that trade" },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/preferred-subs] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
