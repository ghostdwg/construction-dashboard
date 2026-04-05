import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const groups = await prisma.bid.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    const result = groups.map((g) => ({
      status: g.status,
      count: g._count.id,
    }));

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/reports/bids-by-status] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
