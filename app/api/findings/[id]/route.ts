import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["pending_review", "approved", "dismissed", "converted_to_question"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const findingId = parseInt(id, 10);
  if (isNaN(findingId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const { status } = body as { status?: string };

  if (!status || !VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const finding = await prisma.aiGapFinding.update({
    where: { id: findingId },
    data: { status },
  });

  return Response.json(finding);
}
