import { prisma } from "@/lib/prisma";

// POST /api/bids/[id]/leveling/[rowId]/question
// Creates a GeneratedQuestion from a LevelingRow marked clarification_needed.
// Scoped to the bid via bidId (not through gapFinding).
// Idempotent: returns existing question if one already exists for this row.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const { id, rowId } = await params;
  const bidId = parseInt(id, 10);
  const rowIdNum = parseInt(rowId, 10);

  if (isNaN(bidId) || isNaN(rowIdNum)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  // Verify row belongs to this bid's session
  const row = await prisma.levelingRow.findFirst({
    where: { id: rowIdNum, session: { bidId } },
    include: { trade: { select: { name: true } } },
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  // Idempotent: return existing question if already created for this row
  const existing = await prisma.generatedQuestion.findFirst({
    where: { levelingRowId: rowIdNum },
  });
  if (existing) return Response.json(existing, { status: 200 });

  const question = await prisma.generatedQuestion.create({
    data: {
      bidId,
      levelingRowId: rowIdNum,
      tradeName: row.trade?.name ?? null,
      questionText: `Scope clarification needed: ${row.scopeText}`,
      isInternal: false,
      status: "draft",
    },
  });

  return Response.json(question, { status: 201 });
}
