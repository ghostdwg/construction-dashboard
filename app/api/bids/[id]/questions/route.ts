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

// POST /api/bids/[id]/questions
// Body: { tradeName, questionText, source, gapFindingId? }
// Creates a GeneratedQuestion linked to this bid.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const body = await request.json() as {
    tradeName?: string;
    questionText?: string;
    source?: string;
    gapFindingId?: number;
  };

  if (!body.questionText?.trim()) {
    return Response.json({ error: "questionText is required" }, { status: 400 });
  }

  // Validate gapFindingId belongs to this bid if provided
  if (body.gapFindingId) {
    const finding = await prisma.aiGapFinding.findFirst({
      where: { id: body.gapFindingId, bidId },
      select: { id: true },
    });
    if (!finding) {
      return Response.json({ error: "Finding not found on this bid" }, { status: 404 });
    }
  }

  try {
    const question = await prisma.generatedQuestion.create({
      data: {
        bidId,
        gapFindingId: body.gapFindingId ?? null,
        tradeName: body.tradeName?.trim() ?? null,
        questionText: body.questionText.trim(),
        isInternal: true,
        status: "draft",
      },
    });
    return Response.json(question, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /questions] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
