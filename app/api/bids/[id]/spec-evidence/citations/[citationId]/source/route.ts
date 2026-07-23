import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { readStoragePathBuffer } from "@/lib/services/specbook/storagePath";
import { privateInlineHeaders } from "@/lib/services/storage/downloadHeaders";

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
    select: {
      sectionEvidenceRevision: {
        select: {
          pdfPath: true,
          specSection: { select: { csiNumber: true } },
        },
      },
      effectiveSet: {
        select: {
          baseSpecBook: {
            select: { filePath: true, fileName: true },
          },
        },
      },
    },
  });
  if (!citation) return Response.json({ error: "Citation not found" }, { status: 404 });
  const section = citation.sectionEvidenceRevision;
  const sourceRef = section.pdfPath ?? citation.effectiveSet.baseSpecBook.filePath;
  const fileName = section.pdfPath
    ? `${section.specSection.csiNumber.replaceAll(" ", "_")}.pdf`
    : citation.effectiveSet.baseSpecBook.fileName;
  try {
    const buffer = await readStoragePathBuffer(sourceRef, bidId);
    return new Response(new Uint8Array(buffer), {
      headers: privateInlineHeaders({
        mimeType: "application/pdf",
        fileName,
        byteSize: buffer.byteLength,
      }),
    });
  } catch {
    return Response.json(
      { error: "Source bytes unavailable; frozen citation evidence is retained" },
      { status: 404 },
    );
  }
}
