import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/addendums
// Returns all addendum uploads for a bid, sorted by addendumNumber asc.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const addendums = await prisma.addendumUpload.findMany({
    where: { bidId },
    orderBy: { addendumNumber: "asc" },
    select: {
      id: true,
      addendumNumber: true,
      addendumDate: true,
      fileName: true,
      uploadedAt: true,
      status: true,
      deltaJson: true,
      deltaGeneratedAt: true,
      summary: true,
    },
  });

  return Response.json(addendums);
}
