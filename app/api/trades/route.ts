import { prisma } from "@/lib/prisma";

export async function GET() {
  const trades = await prisma.trade.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return Response.json(trades);
}
