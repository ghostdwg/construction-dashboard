import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["draft", "approved", "queued", "sent", "answered", "unanswered"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const questionId = parseInt(id, 10);
  if (isNaN(questionId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const { status, questionText } = body as { status?: string; questionText?: string };

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;
  if (questionText !== undefined) data.questionText = questionText.trim();
  if (status === "approved") data.approvedAt = new Date();
  if (status === "sent") data.sentAt = new Date();

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const question = await prisma.generatedQuestion.update({
    where: { id: questionId },
    data,
  });

  return Response.json(question);
}
