import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const findings = await prisma.aiGapFinding.findMany({
      where: { bidId },
      orderBy: { createdAt: "asc" },
    });
    return Response.json(findings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /findings] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const body = await request.json();
  const { findings } = body as {
    findings: { tradeName?: string; findingText: string; confidence?: string }[];
  };

  if (!Array.isArray(findings) || findings.length === 0) {
    return Response.json({ error: "findings array required" }, { status: 400 });
  }

  const created = await prisma.$transaction(
    findings.map((f) =>
      prisma.aiGapFinding.create({
        data: {
          bidId,
          tradeName: f.tradeName?.trim() || null,
          findingText: f.findingText.trim(),
          confidence: f.confidence?.trim() || null,
          status: "pending_review",
        },
      })
    )
  );

  return Response.json(created, { status: 201 });
}
