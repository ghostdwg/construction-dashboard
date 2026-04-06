import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/specbook/gaps
// Returns the most recent SpecBook for this bid and its coverage summary.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const specBook = await prisma.specBook.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        orderBy: { csiNumber: "asc" },
        include: { trade: { select: { id: true, name: true } } },
      },
    },
  });

  if (!specBook) return Response.json(null);

  const total = specBook.sections.length;
  const covered = specBook.sections.filter((s) => s.covered).length;
  const gaps = specBook.sections
    .filter((s) => !s.covered)
    .map((s) => ({
      id: s.id,
      csiNumber: s.csiNumber,
      csiTitle: s.csiTitle,
      tradeId: s.tradeId,
      trade: s.trade,
    }));

  return Response.json({
    specBook: {
      id: specBook.id,
      fileName: specBook.fileName,
      status: specBook.status,
      uploadedAt: specBook.uploadedAt,
    },
    total,
    covered,
    gapCount: total - covered,
    gaps,
  });
}
