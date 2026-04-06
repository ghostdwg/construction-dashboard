import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const questions = await prisma.generatedQuestion.findMany({
      where: {
        OR: [
          { gapFinding: { bidId } },
          { bidId },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    return Response.json(questions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /questions] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
