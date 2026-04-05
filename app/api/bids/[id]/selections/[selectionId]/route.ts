import { prisma } from "@/lib/prisma";

const VALID_RFQ_STATUSES = ["invited", "received", "reviewing", "accepted", "declined", "no_response"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; selectionId: string }> }
) {
  const { id, selectionId } = await params;
  const bidId = parseInt(id, 10);
  const selId = parseInt(selectionId, 10);
  if (isNaN(bidId) || isNaN(selId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { rfqStatus, selectionNotes, invitedAt, estimateReceivedAt, estimateFileName, followUpCount } =
      body as Record<string, unknown>;

    if (rfqStatus !== undefined && !VALID_RFQ_STATUSES.includes(rfqStatus as string)) {
      return Response.json(
        { error: `rfqStatus must be one of: ${VALID_RFQ_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (rfqStatus !== undefined) data.rfqStatus = String(rfqStatus);
    if (selectionNotes !== undefined) data.selectionNotes = selectionNotes;
    if (invitedAt !== undefined) data.invitedAt = invitedAt ? new Date(String(invitedAt)) : null;
    if (estimateReceivedAt !== undefined)
      data.estimateReceivedAt = estimateReceivedAt ? new Date(String(estimateReceivedAt)) : null;
    if (estimateFileName !== undefined) data.estimateFileName = estimateFileName;
    if (followUpCount !== undefined) data.followUpCount = Number(followUpCount);

    if (Object.keys(data).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }

    const selection = await prisma.bidInviteSelection.update({
      where: { id: selId },
      data,
    });

    return Response.json(selection);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /bids/:id/selections/:selectionId] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; selectionId: string }> }
) {
  const { id, selectionId } = await params;
  const bidId = parseInt(id, 10);
  const selId = parseInt(selectionId, 10);

  if (isNaN(bidId) || isNaN(selId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await prisma.bidInviteSelection.delete({ where: { id: selId } });
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /bids/:id/selections/:selectionId] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
