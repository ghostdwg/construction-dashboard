import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { storagePathExists } from "@/lib/services/specbook/storagePath";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; citationId: string }> },
) {
  const resolved = await params;
  const bidId = Number.parseInt(resolved.id, 10);
  const citationId = Number.parseInt(resolved.citationId, 10);
  if (!Number.isInteger(bidId) || !Number.isInteger(citationId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const citation = await prisma.specCitation.findFirst({
    where: { id: citationId, bidId },
    include: {
      effectiveSet: {
        select: {
          versionNumber: true,
          status: true,
          baseSpecBook: {
            select: {
              id: true,
              revisionIndex: true,
              fileName: true,
              filePath: true,
              sha256: true,
            },
          },
        },
      },
      sectionEvidenceRevision: {
        include: {
          specSection: {
            select: { id: true, csiNumber: true, csiTitle: true },
          },
        },
      },
      specParagraph: true,
    },
  });
  if (!citation) return Response.json({ error: "Citation not found" }, { status: 404 });

  const sourceRef =
    citation.sectionEvidenceRevision.pdfPath ??
    citation.effectiveSet.baseSpecBook.filePath;
  const sourceAvailable = await storagePathExists(sourceRef, bidId);
  return Response.json({
    citation,
    sourceAvailable,
    sourceUrl: sourceAvailable
      ? `/api/bids/${bidId}/spec-evidence/citations/${citationId}/source`
      : null,
  });
}
