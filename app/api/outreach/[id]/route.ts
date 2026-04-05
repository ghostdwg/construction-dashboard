import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["exported", "sent", "responded", "declined", "needs_follow_up"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const logId = parseInt(id, 10);
  if (isNaN(logId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body = await request.json();
    const { status, responseNotes, followUpDue } = body as {
      status?: string;
      responseNotes?: string;
      followUpDue?: string | null;
    };

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (responseNotes !== undefined) data.responseNotes = responseNotes;
    if (followUpDue !== undefined)
      data.followUpDue = followUpDue ? new Date(followUpDue) : null;
    if (status === "responded" || status === "declined")
      data.respondedAt = new Date();

    if (Object.keys(data).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }

    const log = await prisma.outreachLog.update({
      where: { id: logId },
      data,
    });
    return Response.json(log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/outreach/:id] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
