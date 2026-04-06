import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["unreviewed", "included", "excluded", "clarification_needed"];

// PATCH /api/bids/[id]/leveling/[rowId]
// Updates status and/or note on a LevelingRow.
// Verifies the row belongs to this bid's session before updating.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const { id, rowId } = await params;
  const bidId = parseInt(id, 10);
  const rowIdNum = parseInt(rowId, 10);

  if (isNaN(bidId) || isNaN(rowIdNum)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { status, note } = body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  if (status === undefined && note === undefined) {
    return Response.json(
      { error: "Provide at least one of: status, note" },
      { status: 400 }
    );
  }

  // Verify row belongs to this bid's session
  const row = await prisma.levelingRow.findFirst({
    where: {
      id: rowIdNum,
      session: { bidId },
    },
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.levelingRow.update({
    where: { id: rowIdNum },
    data: {
      ...(status !== undefined && { status }),
      ...(note !== undefined && { note }),
    },
    select: {
      id: true,
      estimateUploadId: true,
      division: true,
      scopeText: true,
      status: true,
      note: true,
    },
  });

  return Response.json(updated);
}
