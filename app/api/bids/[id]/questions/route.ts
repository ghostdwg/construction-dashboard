import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["OPEN", "SENT", "ANSWERED", "CLOSED", "NO_RESPONSE"] as const;
const VALID_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
type RfiPriority = (typeof VALID_PRIORITIES)[number];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const priorityParam = url.searchParams.get("priority");

  const where: Record<string, unknown> = {
    OR: [
      { gapFinding: { bidId } },
      { bidId },
    ],
  };
  if (statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)) {
    where.status = statusParam;
  }
  if (priorityParam && (VALID_PRIORITIES as readonly string[]).includes(priorityParam)) {
    where.priority = priorityParam;
  }

  try {
    const questions = await prisma.generatedQuestion.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    // Summary counts
    const total = questions.length;
    const open = questions.filter((q) => q.status === "OPEN").length;
    const sent = questions.filter((q) => q.status === "SENT").length;
    const answered = questions.filter((q) => q.status === "ANSWERED").length;
    const closed = questions.filter((q) => q.status === "CLOSED").length;
    const noResponse = questions.filter((q) => q.status === "NO_RESPONSE").length;
    const criticalOpen = questions.filter(
      (q) => q.priority === "CRITICAL" && ["OPEN", "SENT", "NO_RESPONSE"].includes(q.status)
    ).length;
    const impactFlagged = questions.filter((q) => q.impactFlag).length;

    return Response.json({
      questions,
      summary: { total, open, sent, answered, closed, noResponse, criticalOpen, impactFlagged },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /questions] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST /api/bids/[id]/questions
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
    priority?: string;
    sourceRef?: string;
    dueDate?: string;
  };

  if (!body.questionText?.trim()) {
    return Response.json({ error: "questionText is required" }, { status: 400 });
  }

  const priority: RfiPriority = (VALID_PRIORITIES as readonly string[]).includes(body.priority ?? "")
    ? (body.priority as RfiPriority)
    : "MEDIUM";

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
    // Auto-assign next RFI number for this bid
    const maxRfi = await prisma.generatedQuestion.aggregate({
      where: { OR: [{ bidId }, { gapFinding: { bidId } }] },
      _max: { rfiNumber: true },
    });
    const nextRfiNumber = (maxRfi._max.rfiNumber ?? 0) + 1;

    const question = await prisma.generatedQuestion.create({
      data: {
        bidId,
        rfiNumber: nextRfiNumber,
        gapFindingId: body.gapFindingId ?? null,
        tradeName: body.tradeName?.trim() ?? null,
        questionText: body.questionText.trim(),
        isInternal: true,
        status: "OPEN",
        priority,
        sourceRef: body.sourceRef?.trim() ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
      },
    });
    return Response.json(question, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /questions] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
