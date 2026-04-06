import { prisma } from "@/lib/prisma";
import { logOutreachEvent } from "@/lib/logging/outreachLogger";
import { Prisma } from "@prisma/client";

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

  let question;
  try {
    question = await prisma.generatedQuestion.update({
      where: { id: questionId },
      data,
      include: {
        gapFinding: { select: { bidId: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return Response.json({ error: "Question not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }

  // Log outreach event for both gapFinding questions and direct leveling questions
  if (status === "queued") {
    const effectiveBidId = question.gapFinding?.bidId ?? question.bidId ?? undefined;
    if (effectiveBidId !== undefined) {
      try {
        await logOutreachEvent({
          bidId: effectiveBidId,
          questionId: question.id,
          channel: "question",
          status: "queued",
        });
      } catch (err) {
        console.error("[outreachLogger] question queued log failed:", err);
      }
    }
  }

  return Response.json(question);
}
