import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bidId = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const effectiveSet = await prisma.specificationEffectiveSet.findFirst({
    where: { bidId, activeSlot: 1, status: "PUBLISHED" },
    include: {
      baseSpecBook: {
        select: {
          id: true,
          fileName: true,
          revisionIndex: true,
          sha256: true,
          byteSize: true,
          sections: {
            orderBy: [{ csiNumber: "asc" }, { id: "asc" }],
            select: {
              id: true,
              csiNumber: true,
              csiTitle: true,
              evidenceRevisions: {
                orderBy: { revisionIndex: "desc" },
                take: 1,
                select: {
                  id: true,
                  revisionIndex: true,
                  textSha256: true,
                  pageStart: true,
                  pageEnd: true,
                  paragraphs: {
                    orderBy: { ordinal: "asc" },
                    select: {
                      id: true,
                      ordinal: true,
                      paragraphLabel: true,
                      text: true,
                      pageNumber: true,
                      pageEnd: true,
                      textSha256: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return Response.json({ effectiveSet });
}
