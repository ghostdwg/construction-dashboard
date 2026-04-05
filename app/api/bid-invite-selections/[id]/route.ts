import { prisma } from "@/lib/prisma";

const VALID_RFQ_STATUSES = [
  "no_response",
  "invited",
  "received",
  "reviewing",
  "accepted",
  "declined",
];

// PATCH /api/bid-invite-selections/[id]
// Body: { rfqStatus: string }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const selId = parseInt(id, 10);
  if (isNaN(selId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { rfqStatus } = body as { rfqStatus?: string };

    if (!rfqStatus || !VALID_RFQ_STATUSES.includes(rfqStatus)) {
      return Response.json(
        { error: `rfqStatus must be one of: ${VALID_RFQ_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const selection = await prisma.bidInviteSelection.update({
      where: { id: selId },
      data: { rfqStatus },
    });

    return Response.json(selection);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/bid-invite-selections/:id] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
