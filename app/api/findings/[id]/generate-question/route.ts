import { prisma } from "@/lib/prisma";

const PREFIX_RE = /^(Missing|Gap):\s*/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const findingId = parseInt(id, 10);
  if (isNaN(findingId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const finding = await prisma.aiGapFinding.findUnique({ where: { id: findingId } });
  if (!finding) return Response.json({ error: "Finding not found" }, { status: 404 });
  if (finding.status !== "approved") {
    return Response.json(
      { error: "Finding must be approved before generating a question" },
      { status: 400 }
    );
  }

  const cleanText = finding.findingText.replace(PREFIX_RE, "").trim();
  const questionText =
    `Please confirm whether your scope includes: ${cleanText}. ` +
    `If included, please confirm it is in your base bid. ` +
    `If excluded, please advise.`;

  const [question] = await prisma.$transaction([
    prisma.generatedQuestion.create({
      data: {
        gapFindingId: finding.id,
        tradeName: finding.tradeName,
        questionText,
        isInternal: false,
        status: "draft",
      },
    }),
    prisma.aiGapFinding.update({
      where: { id: findingId },
      data: { status: "converted_to_question" },
    }),
  ]);

  return Response.json(question, { status: 201 });
}
