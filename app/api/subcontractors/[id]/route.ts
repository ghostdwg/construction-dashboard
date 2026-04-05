import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subId = parseInt(id, 10);

  if (isNaN(subId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const sub = await prisma.subcontractor.findUnique({
    where: { id: subId },
    include: {
      subTrades: { include: { trade: true }, orderBy: { id: "asc" } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
    },
  });

  if (!sub) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(sub);
}
