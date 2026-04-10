import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
type UpdateData = Record<string, unknown>;

const VALID_STATUSES = ["OPEN", "SENT", "ANSWERED", "CLOSED", "NO_RESPONSE"] as const;
const VALID_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
type RfiStatus = (typeof VALID_STATUSES)[number];
type RfiPriority = (typeof VALID_PRIORITIES)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  const { id, questionId: qid } = await params;
  const bidId = parseInt(id, 10);
  const questionId = parseInt(qid, 10);
  if (isNaN(bidId) || isNaN(questionId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json() as {
    status?: string;
    priority?: string;
    sentAt?: string | null;
    responseText?: string | null;
    respondedAt?: string | null;
    respondedBy?: string | null;
    impactFlag?: boolean;
    impactNote?: string | null;
    sourceRef?: string | null;
    dueDate?: string | null;
    questionText?: string;
  };

  // Validate enums
  if (body.status !== undefined && !(VALID_STATUSES as readonly string[]).includes(body.status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  if (body.priority !== undefined && !(VALID_PRIORITIES as readonly string[]).includes(body.priority)) {
    return Response.json(
      { error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` },
      { status: 400 }
    );
  }

  const data: UpdateData = {};

  if (body.status !== undefined) {
    data.status = body.status as RfiStatus;
    // Auto-set sentAt when marking SENT
    if (body.status === "SENT" && body.sentAt === undefined) data.sentAt = new Date();
    // Auto-set respondedAt when marking ANSWERED
    if (body.status === "ANSWERED" && body.respondedAt === undefined) data.respondedAt = new Date();
  }
  if (body.priority !== undefined) data.priority = body.priority as RfiPriority;
  if (body.sentAt !== undefined) data.sentAt = body.sentAt ? new Date(body.sentAt) : null;
  if (body.responseText !== undefined) data.responseText = body.responseText;
  if (body.respondedAt !== undefined) data.respondedAt = body.respondedAt ? new Date(body.respondedAt) : null;
  if (body.respondedBy !== undefined) data.respondedBy = body.respondedBy;
  if (body.impactFlag !== undefined) data.impactFlag = body.impactFlag;
  if (body.impactNote !== undefined) data.impactNote = body.impactNote;
  if (body.sourceRef !== undefined) data.sourceRef = body.sourceRef;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.questionText !== undefined) data.questionText = body.questionText.trim();

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Verify ownership before updating
  const existing = await prisma.generatedQuestion.findFirst({
    where: {
      id: questionId,
      OR: [{ bidId }, { gapFinding: { bidId } }],
    },
    select: { id: true },
  });
  if (!existing) {
    return Response.json({ error: "Question not found on this bid" }, { status: 404 });
  }

  try {
    const question = await prisma.generatedQuestion.update({
      where: { id: questionId },
      data,
    });
    return Response.json(question);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return Response.json({ error: "Question not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
